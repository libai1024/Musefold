'use client';

import type { AppPreferences } from '@musefold/contracts';
import { queryKeys, useCapabilities, useGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  selectTrack: (track) => set({ track, providerId: null, active: true }),
  setDraftPrompt: (draftPrompt) => set({ draftPrompt }),
  setProviderId: (providerId) => set({ providerId }),
  // 离开 welcome 即同步放行:不能只靠 useEffect 置 active,否则 BYOK 建连成功的同一拍
  // hasUsableChannel 变 true 时 active 仍是 false,引导层会被卸掉并误触发静默写哨兵。
  goTo: (step) => set({ step, active: true }),
  goNext: () => set((state) => ({ step: stepAt(1, state.step), active: true })),
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
  /** 前置查询都有结论前为 false:避免引导层在首帧闪现又撤走。完成哨兵镜像可同步判「已完成」,直接短路为 true。 */
  resolved: boolean;
  /** 应显示引导层。 */
  open: boolean;
  /** 已具备任一可用生图通道(账号已登录 / 本地 Provider 可用 / 豆包已登录)。 */
  hasUsableChannel: boolean;
  /** 完成哨兵;非 null 即永不重放。 */
  completedAt: string | null;
}

/**
 * 完成哨兵的 localStorage 镜像(2026-09 走查 P2):
 * 契约偏好要等查询 settle,冷启动 ~5s 内 gate 无结论——期间工作台可被点击,
 * 引导层迟到挂载会抢走用户落点。镜像同步可读,让「已完成」用户首帧即得结论,
 * 不再等任何查询。只作正向加速:镜像有值 → 视为完成;镜像缺失仍以契约偏好为准。
 * 哨兵本体永远是契约偏好,镜像丢了只是下次启动多等一次查询。
 */
const ONBOARDING_SENTINEL_MIRROR_KEY = 'musefold.onboarding-completed-at';

export function readOnboardingMirror(): string | null {
  try {
    return window.localStorage.getItem(ONBOARDING_SENTINEL_MIRROR_KEY);
  } catch {
    // SSR / 隐私模式等不可用存储:当作无镜像,回退等查询。
    return null;
  }
}

export function writeOnboardingMirror(completedAt: string): void {
  try {
    window.localStorage.setItem(ONBOARDING_SENTINEL_MIRROR_KEY, completedAt);
  } catch {
    // 写失败不影响正确性,只是下次冷启动回退到等查询。
  }
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
  const step = useOnboardingFlow((state) => state.step);
  const markActive = useOnboardingFlow((state) => state.markActive);
  // v2.1「step > 1 即保持可见」:即使用户已经点进 connect,active 的 effect 还没跑,
  // 也不能在 BYOK 刚落库时把引导层拆掉。
  const flowHeld = flowActive || step !== 'welcome';

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

  // isFetched 在首轮成功/失败后保持为 true:error 态 query 被 invalidate 再取时
  // 会短暂回到 pending,若用 isSuccess||isError 会让 gate 闪关,BYOK validate 的
  // onSuccess 失效 account 就会拆掉引导层再自动重跑,打出 /models 风暴。
  const settled = (query: { isFetched: boolean }, enabled = true) => !enabled || query.isFetched;
  // 完成哨兵镜像同步短路:已完成用户不等查询,首帧即有结论(见 readOnboardingMirror)。
  const [mirror] = useState(() => readOnboardingMirror());
  // 「已知完成」同样短路 resolved:通道查询(account/providers/doubao)只为判断
  // 要不要弹引导,已完成用户永远不弹,不该被慢/挂起的通道查询拖住首帧遮罩
  // (2026-09 走查:web e2e 无 API 环境 account 永不 settle,遮罩挡死整页)。
  const completedKnown =
    mirror !== null || (preferences.data?.onboardingCompletedAt ?? null) !== null;
  // 偏好读取失败 = fail-closed 结论(不弹引导、不写哨兵);对遮罩而言也算「有结论」,
  // 不能让未 resolved 状态在坏宿主上永久遮挡整个应用。
  const preferencesFailed = preferences.isError;
  const baseResolved =
    completedKnown ||
    preferencesFailed ||
    (preferences.isSuccess &&
      settled(account) &&
      settled(providers, providersEnabled) &&
      settled(doubao, doubaoEnabled));
  // 遮罩硬死线:查询既不成功也不失败(悬死/无限退避)时,fail-open 放行应用。
  // 遮罩是体验优化,不是门禁,任何路径都不允许把它变成整页 DoS。
  const [shieldDeadlinePassed, setShieldDeadlinePassed] = useState(false);
  useEffect(() => {
    if (baseResolved) return;
    const timer = setTimeout(() => setShieldDeadlinePassed(true), 8_000);
    return () => clearTimeout(timer);
  }, [baseResolved]);
  const resolved = baseResolved || shieldDeadlinePassed;
  const completedAt = preferences.data?.onboardingCompletedAt ?? mirror;
  const hasUsableChannel =
    account.isSuccess ||
    (providersEnabled && (providers.data ?? []).some((option) => option.available)) ||
    (doubaoEnabled && doubao.data?.loggedIn === true);
  const open =
    resolved && !preferencesFailed && completedAt === null && (flowHeld || !hasUsableChannel);

  useLayoutEffect(() => {
    if (open && !flowActive) markActive();
  }, [open, flowActive, markActive]);

  // 反向补写镜像:契约已有哨兵但本地镜像缺失(老版本完成 / 存储被清)时补齐,
  // 让下一次冷启动走同步短路,不进遮罩也不弹引导。
  useEffect(() => {
    if (resolved && completedAt !== null && mirror === null) {
      writeOnboardingMirror(completedAt);
    }
  }, [resolved, completedAt, mirror]);

  // 静默补写:存量用户(有通道、无哨兵)不进流程,直接落哨兵。只尝试一次,失败不重试
  //——写不进去最坏是下次启动再判一遍,不该反复打宿主。
  const silentWriteTried = useRef(false);
  const writeSentinel = complete.mutate;
  useEffect(() => {
    if (silentWriteTried.current) return;
    if (!resolved || preferencesFailed || completedAt !== null || !hasUsableChannel || flowHeld)
      return;
    silentWriteTried.current = true;
    writeSentinel();
  }, [resolved, preferencesFailed, completedAt, hasUsableChannel, flowHeld, writeSentinel]);

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
      // 同步镜像本地哨兵:下次冷启动 gate 首帧短路,不进遮罩不重判。
      if (next.onboardingCompletedAt) writeOnboardingMirror(next.onboardingCompletedAt);
    },
  });
}
