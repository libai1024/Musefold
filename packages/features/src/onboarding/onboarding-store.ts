'use client';

import type { AppPreferences } from '@musefold/contracts';
import { queryKeys, useCapabilities, useGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * 首启引导(U01-onboarding,承 v2.1 四步流)。
 *
 * 步骤流:welcome → connect(三轨:官方账号 / 桌面 BYOK / 豆包免费试用)→ validate → first-image。
 * 完成哨兵是契约偏好 `AppPreferences.onboardingCompletedAt`(双宿主各自本地持久化),
 * 跳过与完成写同一个哨兵,再次启动不重放。
 *
 * 纪律:
 * - 这里只存 UI 状态机(步骤/轨道/草稿提示词/落地连接 id);**API Key 绝不进本 store**,
 *   密钥只随 `useCreateAiProvider` 的入参经 gateway 送宿主安全存储。
 * - 宿主差异只经 `PlatformCapabilities` 表达(BYOK 与豆包轨的门控),不做 UA/isElectron 探测。
 */

export const ONBOARDING_STEPS = ['welcome', 'connect', 'validate', 'first-image'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** 三轨连接方式:官方账号(推荐主通道)/ 桌面自备网关 / 豆包免费试用。 */
export type OnboardingTrack = 'account' | 'byok' | 'doubao';

/** 首图示例提示词(承 v2.1 `EXAMPLE_PROMPT`,扩为三条 chips 供挑选)。 */
export const ONBOARDING_EXAMPLE_PROMPTS = [
  'a cozy cabin in snowy forest, cinematic',
  '清晨的城市街角,水彩晕染,通透光线',
  'studio portrait of a calico cat, soft rim light',
] as const;

interface OnboardingFlowState {
  step: OnboardingStep;
  track: OnboardingTrack | null;
  /**
   * 引导层本次运行已放行:一旦进入流程,即使中途拿到了可用通道(如 BYOK 刚建好连接),
   * 也保持引导层直到用户完成或跳过——承 v2.1「step > 1 即保持可见」。
   */
  active: boolean;
  /** first-image 步的提示词草稿(纯 UI 态)。 */
  draftPrompt: string;
  /** BYOK 轨落地的本地生图连接 id;validate 步据此发测试请求。 */
  providerId: string | null;
  markActive(): void;
  selectTrack(track: OnboardingTrack | null): void;
  setDraftPrompt(prompt: string): void;
  setProviderId(providerId: string | null): void;
  goTo(step: OnboardingStep): void;
  goNext(): void;
  goBack(): void;
  reset(): void;
}

const INITIAL_FLOW = {
  step: 'welcome',
  track: null,
  active: false,
  draftPrompt: '',
  providerId: null,
} satisfies Pick<OnboardingFlowState, 'step' | 'track' | 'active' | 'draftPrompt' | 'providerId'>;

function stepAt(offset: number, from: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(from) + offset;
  return ONBOARDING_STEPS[Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1)] ?? from;
}

export const useOnboardingFlow = create<OnboardingFlowState>((set) => ({
  ...INITIAL_FLOW,
  markActive: () => set({ active: true }),
  // 换轨会作废上一轨的落地物:providerId 只对 BYOK 轨有意义,留着会让 validate 测错通道。
  selectTrack: (track) => set({ track, providerId: null }),
  setDraftPrompt: (draftPrompt) => set({ draftPrompt }),
  setProviderId: (providerId) => set({ providerId }),
  goTo: (step) => set({ step }),
  goNext: () => set((state) => ({ step: stepAt(1, state.step) })),
  // connect 步选中轨道后,「返回」先退回轨道选择(承 v2.1),再退才回 welcome。
  goBack: () =>
    set((state) =>
      state.step === 'connect' && state.track !== null
        ? { track: null, providerId: null }
        : { step: stepAt(-1, state.step) },
    ),
  reset: () => set({ ...INITIAL_FLOW }),
}));

export interface OnboardingGate {
  /** 前置查询都有结论前为 false:避免引导层在首帧闪现又撤走。 */
  resolved: boolean;
  /** 应显示引导层。 */
  open: boolean;
  /** 已具备任一可用生图通道(账号已登录 / 本地 Provider 可用 / 豆包已登录)。 */
  hasUsableChannel: boolean;
  /** 完成哨兵;非 null 即永不重放。 */
  completedAt: string | null;
}

/**
 * 判定是否要弹首启引导,并在「已具备可用通道但没有哨兵」时静默补写哨兵
 * ——存量用户升级到本版本后不该被引导层拦一次。
 *
 * 通道判定按宿主能力分叉(不是按宿主名):
 * - `hasLocalAiProviders`(桌面)才查本地 Provider 目录;
 * - `hasDoubaoWebLogin`(桌面)才查豆包登录态;
 * - 账号登录态两端都查。
 */
export function useOnboardingGate(): OnboardingGate {
  const gateway = useGateway();
  const capabilities = useCapabilities();
  const complete = useCompleteOnboarding();
  const flowActive = useOnboardingFlow((state) => state.active);
  const markActive = useOnboardingFlow((state) => state.markActive);

  const preferences = useQuery({
    queryKey: queryKeys.settings.preferences(),
    queryFn: () => gateway.settings.getPreferences(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  // 未登录时 getStatus 结构化失败(401),是「无账号通道」的正常分支,不重试。
  const account = useQuery({
    queryKey: queryKeys.account.status(),
    queryFn: () => gateway.account.getStatus(),
    retry: false,
  });
  const providersEnabled = capabilities.hasLocalAiProviders;
  const providers = useQuery({
    queryKey: queryKeys.generation.providers(),
    queryFn: () => gateway.generation.listProviders(),
    enabled: providersEnabled,
    retry: false,
  });
  const doubaoEnabled = capabilities.hasDoubaoWebLogin && gateway.doubao !== undefined;
  const doubao = useQuery({
    queryKey: queryKeys.doubao.status(),
    queryFn: () => {
      const domain = gateway.doubao;
      if (!domain) throw new Error('当前宿主不提供豆包网页登录');
      return domain.getStatus();
    },
    enabled: doubaoEnabled,
    retry: false,
  });

  const settled = (query: { isSuccess: boolean; isError: boolean }, enabled = true) =>
    !enabled || query.isSuccess || query.isError;
  const resolved =
    preferences.isSuccess &&
    settled(account) &&
    settled(providers, providersEnabled) &&
    settled(doubao, doubaoEnabled);
  const completedAt = preferences.data?.onboardingCompletedAt ?? null;
  const hasUsableChannel =
    account.isSuccess ||
    (providersEnabled && (providers.data ?? []).some((option) => option.available)) ||
    (doubaoEnabled && doubao.data?.loggedIn === true);
  const open = resolved && completedAt === null && (flowActive || !hasUsableChannel);

  useEffect(() => {
    if (open && !flowActive) markActive();
  }, [open, flowActive, markActive]);

  // 静默补写:存量用户(有通道、无哨兵)不进流程,直接落哨兵。只尝试一次,失败不重试
  // ——写不进去最坏是下次启动再判一遍,不该反复打宿主。
  const silentWriteTried = useRef(false);
  const writeSentinel = complete.mutate;
  useEffect(() => {
    if (silentWriteTried.current) return;
    if (!resolved || completedAt !== null || !hasUsableChannel || flowActive) return;
    silentWriteTried.current = true;
    writeSentinel();
  }, [resolved, completedAt, hasUsableChannel, flowActive, writeSentinel]);

  return { resolved, open, hasUsableChannel, completedAt };
}

/**
 * 写完成哨兵(完成与跳过同一个动作)。
 * 送完整偏好而不是单字段 patch:`appPreferencesPatchSchema` 会给缺席的带默认值字段
 * 重新套上默认值,单字段 patch 会把置顶会话/画幅/密度等偏好一起打回默认。
 */
export function useCompleteOnboarding() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AppPreferences> => {
      const current =
        queryClient.getQueryData<AppPreferences>(queryKeys.settings.preferences()) ??
        (await gateway.settings.getPreferences());
      return gateway.settings.updatePreferences({
        ...current,
        onboardingCompletedAt: new Date().toISOString(),
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.settings.preferences(), next);
    },
  });
}
