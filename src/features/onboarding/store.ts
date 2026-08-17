// src/features/onboarding/store.ts
// 首启引导流状态机（TASK-SET-04）—— 4 步：欢迎→连接服务商→校验→出第一张图
//
// 门控：onboarded 未置位 且 provider:list 为空时触发（见 OnboardingFlow.tsx）。
// onboarded 只是一个"已引导过"的哨兵，用字符串 '1' 存 localStorage（不是 JSON，
// 与 stores/app.ts 的主题存法一致），绝不写入 Key。

import { create } from 'zustand';
import type { ImageQuality } from '@shared/types/enums';
import { PROVIDER_PRESETS, DEFAULT_PRESET_ID, RATIO_OPTIONS } from '@shared/constants';
import { ACCOUNT_FALLBACK_TEXT_MODEL } from '@shared/constants';
import type { ValidationResult, GenerateImageResult } from '@shared/types/providers';
import type { AiConnectionValidationResult } from '@shared/types/ai';
import { useGenerationStore } from '../generation/store';
import { useAppStore } from '../../stores/app';
import { hatchMotionAllowed, useEmberHatchStore } from '../../stores/emberHatch';
import { useAccountStore } from '../account/store';
import { useAiConnectionStore } from '../settings/ai-connection-store';
import api from '../../lib/ipc';

const ONBOARDED_KEY = 'musefold:onboarded';

/** 首图示例提示词（docs/product/16 §4.1） */
export const EXAMPLE_PROMPT = 'a cozy cabin in snowy forest, cinematic';

export type OnboardingStep = 1 | 2 | 3 | 4;
export type OnboardingTrack = 'doubao' | 'account' | 'byok';
export type AccountOnboardingStage = 'choose' | 'auth' | 'redeem';

function readOnboarded(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOnboarded(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* 存不了就算了，下次仍会显示引导，不影响功能 */
  }
}

/**
 * 是否在 E2E 测试harness 下启动（主进程 MUSEFOLD_E2E=1 时会给渲染层 URL 加 ?musefold_e2e=1，
 * 见 electron/main/window.ts + src/lib/test-hook.ts）。
 *
 * E2E 的 `app` fixture 每个测试函数都起一个全新、零 Provider 的应用实例
 * （tests/e2e/conftest.py），若引导流按普通门控自动弹出，会挡住几乎所有既有
 * 测试。因此 E2E 下默认不自动显示，需要专门测试通过 forceShow() 显式打开。
 * 手动 `npm run dev`（无此 query 参数）不受影响，仍按正常门控显示。
 */
function isE2EHarness(): boolean {
  try {
    return typeof location !== 'undefined' && location.search.includes('musefold_e2e=1');
  } catch {
    return false;
  }
}

interface OnboardingState {
  /** 已完成/跳过过引导（持久化） */
  onboarded: boolean;
  /** 被测试强制显示（覆盖 onboarded/providers 门控，仅 E2E 用，见 test-hook.ts） */
  forced: boolean;
  step: OnboardingStep;
  track: OnboardingTrack | null;
  accountStage: AccountOnboardingStage;
  accountBusy: boolean;
  accountError: string | null;
  accountQuota: number | null;
  textConnectionId: string | null;
  textValidation: AiConnectionValidationResult | null;
  alsoConfigureText: boolean;
  doubaoWindowOpened: boolean;

  // 步骤 2：预设 + Key
  presetId: string;
  apiKey: string;
  /** 步骤 2/3 创建/落库后的 provider id */
  providerId: string | null;
  saving: boolean;

  // 步骤 3：校验
  validating: boolean;
  validation: ValidationResult | null;

  // 步骤 4：出第一张图
  ratioId: string;
  quality: ImageQuality;
  generating: boolean;
  generateError: { code: string; message: string } | null;
  generatedImagePath: string | null;

  isVisible: () => boolean;
  setPresetId: (id: string) => void;
  setApiKey: (v: string) => void;
  selectTrack: (track: OnboardingTrack) => void;
  openDoubaoLogin: () => Promise<void>;
  confirmDoubaoLogin: () => Promise<void>;
  authenticateAccount: (mode: 'login' | 'register', input: { username: string; password: string }) => Promise<void>;
  redeemAccount: (code: string) => Promise<void>;
  continueWithoutRedeem: () => void;
  setAlsoConfigureText: (enabled: boolean) => void;
  setRatioId: (id: string) => void;
  setQuality: (q: ImageQuality) => void;
  goStart: () => void;
  goBack: () => void;
  /** 步骤 2 → 创建/更新 provider + 存 Key，成功后进入步骤 3 */
  connect: () => Promise<void>;
  /** 步骤 3 → provider:validate；成功 setActive 并进入步骤 4，失败留在本步 */
  validate: () => Promise<void>;
  retryValidate: () => Promise<void>;
  /** 步骤 4 → 用示例提示词生成第一张图 */
  generateFirstImage: () => Promise<void>;
  /** 任意步骤：跳过引导，直达 Library */
  skip: () => void;
  /** 步骤 4 完成：置位 onboarded，跳转 Library */
  finish: () => void;
  /** 仅测试用：无视 onboarded/providers 强制显示引导（见 window.__musefold_test） */
  forceShow: () => void;
  /** 仅测试用：清掉 onboarded 标记 + 重置状态机，用于从头跑一遍引导 */
  resetForTest: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  onboarded: readOnboarded(),
  forced: false,
  step: 1,
  track: null,
  accountStage: 'choose',
  accountBusy: false,
  accountError: null,
  accountQuota: null,
  textConnectionId: null,
  textValidation: null,
  alsoConfigureText: true,
  doubaoWindowOpened: false,
  presetId: DEFAULT_PRESET_ID,
  apiKey: '',
  providerId: null,
  saving: false,
  validating: false,
  validation: null,
  ratioId: '1:1',
  quality: 'medium',
  generating: false,
  generateError: null,
  generatedImagePath: null,

  isVisible: () => {
    const s = get();
    if (s.forced) return true;
    if (isE2EHarness()) return false;
    if (s.onboarded) return false;
    // 一旦用户开始首启流程，即使中途创建了 Provider，也保持引导层直到完成或跳过。
    if (s.step > 1) return true;
    const gen = useGenerationStore.getState();
    return gen.providersLoaded && gen.providers.length === 0;
  },

  setPresetId: (presetId) => set({ presetId }),
  setApiKey: (apiKey) => set({ apiKey }),
  selectTrack: (track) => set({
    track,
    accountStage: track === 'account' ? 'auth' : 'choose',
    accountError: null,
    doubaoWindowOpened: false,
    validation: null,
    textValidation: null,
  }),
  setAlsoConfigureText: (alsoConfigureText) => set({ alsoConfigureText }),
  setRatioId: (ratioId) => set({ ratioId }),
  setQuality: (quality) => set({ quality }),

  goStart: () => set({
    step: 2,
    // 旧 E2E 用例直接填写 BYOK 表单；普通用户仍先看双轨选择。
    track: isE2EHarness() ? 'byok' : null,
    accountStage: 'choose',
  }),
  goBack: () => set((s) => ({ step: (Math.max(1, s.step - 1) as OnboardingStep) })),

  openDoubaoLogin: async () => {
    if (get().saving) return;
    set({ saving: true, validation: null });
    try {
      const snapshot = api.provider.webLoginStart
        ? await api.provider.webLoginStart()
        : null;
      if (!snapshot) await api.provider.openWebLogin();
      set({ saving: false, doubaoWindowOpened: true, validation: snapshot?.loggedIn ? { ok: true, message: '豆包已登录' } : null });
    } catch (error) {
      set({
        saving: false,
        validation: {
          ok: false,
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : '无法打开豆包登录窗口',
        },
      });
    }
  },

  confirmDoubaoLogin: async () => {
    if (get().saving) return;
    set({ saving: true, validation: null });
    try {
      const gen = useGenerationStore.getState();
      const existing = gen.providers.find((provider) => provider.type === 'doubao-web');
      let id = get().providerId ?? existing?.id ?? null;
      if (!id) {
        const preset = PROVIDER_PRESETS.find((item) => item.type === 'doubao-web');
        if (!preset) throw new Error('豆包网页预设不存在');
        const created = await gen.createProvider({
          name: preset.name,
          type: preset.type,
          baseUrl: preset.baseUrl,
          model: preset.model,
          isActive: gen.providers.length === 0,
        });
        id = created.id;
      }
      const status = api.provider.webLoginState
        ? await api.provider.webLoginState()
        : null;
      const result = status?.loggedIn
        ? { ok: true, message: `豆包网页已登录，今日剩余 ${status.usage.remaining}/${status.usage.limit} 次`, models: [{ id: 'seedream-4.5', name: 'Seedream 4.5' }] }
        : null;
      const validation = result ?? await gen.validate(id);
      await gen.loadProviders();
      if (validation.ok) await gen.setActive(id);
      set({
        saving: false,
        providerId: id,
        validation,
        ...(validation.ok ? { step: 3 as const } : {}),
      });
    } catch (error) {
      set({
        saving: false,
        validation: {
          ok: false,
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : '豆包登录验证失败',
        },
      });
    }
  },

  authenticateAccount: async (mode, input) => {
    if (get().accountBusy) return;
    set({ accountBusy: true, accountError: null });
    try {
      const account = useAccountStore.getState();
      const status = mode === 'register'
        ? await account.register(input)
        : await account.login(input);
      await Promise.all([
        useGenerationStore.getState().loadProviders(),
        useAiConnectionStore.getState().load(),
      ]);
      const provider = useGenerationStore.getState().providers.find((item) => item.managedBy === 'account');
      const connection = useAiConnectionStore.getState().connections.find((item) => item.managedBy === 'account');
      if (!provider || !connection) throw new Error('账号登录成功，但托管模型配置未就绪');
      const quota = status.quota?.value ?? 0;
      set({
        accountBusy: false,
        accountQuota: quota,
        providerId: provider.id,
        textConnectionId: connection.id,
        accountStage: quota > 0 ? 'auth' : 'redeem',
        ...(quota > 0 ? { step: 3 as const } : {}),
      });
      if (quota > 0) void get().validate();
    } catch (error) {
      set({
        accountBusy: false,
        accountError: error instanceof Error ? error.message : '登录失败，请重试',
      });
    }
  },

  redeemAccount: async (code) => {
    if (get().accountBusy) return;
    set({ accountBusy: true, accountError: null });
    try {
      const result = await useAccountStore.getState().redeem(code);
      set({
        accountBusy: false,
        accountQuota: result.status.quota?.value ?? result.quotaAdded,
        step: 3,
      });
      void get().validate();
    } catch (error) {
      set({
        accountBusy: false,
        accountError: error instanceof Error ? error.message : '兑换失败，请重试',
      });
    }
  },

  continueWithoutRedeem: () => {
    set({ step: 3, accountError: null });
    void get().validate();
  },

  connect: async () => {
    const { presetId, apiKey, providerId, alsoConfigureText, textConnectionId } = get();
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0];
    if (!apiKey.trim()) return;
    set({ saving: true });
    try {
      const gen = useGenerationStore.getState();
      let id = providerId;
      if (!id) {
        const created = await gen.createProvider({
          name: preset.name,
          type: preset.type,
          baseUrl: preset.baseUrl,
          model: preset.model,
          isActive: true,
        });
        id = created.id;
      }
      await gen.saveKey(id, apiKey.trim());
      let nextTextConnectionId = textConnectionId;
      let textSetupFailure: AiConnectionValidationResult | null = null;
      if (alsoConfigureText && preset.type === 'openai-compatible') {
        try {
          const ai = useAiConnectionStore.getState();
          const input = {
            name: `${preset.name} · Agent`,
            routeKind: 'gateway' as const,
            presetId: 'custom' as const,
            baseUrl: preset.baseUrl,
            model: ACCOUNT_FALLBACK_TEXT_MODEL,
            isActive: true,
          };
          const connection = nextTextConnectionId
            ? await ai.updateConnection(nextTextConnectionId, input)
            : await ai.createConnection(input);
          await ai.saveKey(connection.id, apiKey.trim());
          nextTextConnectionId = connection.id;
        } catch (error) {
          // 「同时用于 Agent」是增强项：失败不能把已经成功保存的生图连接一起回滚。
          nextTextConnectionId = null;
          textSetupFailure = {
            ok: false,
            message: error instanceof Error ? error.message : 'Agent 模型配置失败，可稍后在设置中重试',
            models: [],
            capabilities: {
              modelDiscovery: 'unknown',
              supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
              preferredStructuredOutputMode: 'json-object',
              cancellation: true,
              streaming: false,
              lastValidatedAt: null,
            },
          };
        }
      }
      set({
        providerId: id,
        textConnectionId: nextTextConnectionId,
        apiKey: '',
        saving: false,
        step: 3,
        validation: null,
        textValidation: textSetupFailure,
      });
      void get().validate();
    } catch (err) {
      set({ saving: false });
      set({
        validation: { ok: false, code: 'UNKNOWN', message: (err as Error)?.message || '保存失败，请重试' },
      });
    }
  },

  validate: async () => {
    const { providerId, textConnectionId, textValidation: priorTextValidation } = get();
    if (!providerId) return;
    set({
      validating: true,
      validation: null,
      textValidation: textConnectionId ? null : priorTextValidation,
    });
    try {
      const [result, textResult] = await Promise.all([
        useGenerationStore.getState().validate(providerId),
        textConnectionId
          ? useAiConnectionStore.getState().validate(textConnectionId)
          : Promise.resolve(priorTextValidation),
      ]);
      set({ validating: false, validation: result, textValidation: textResult });
      if (result.ok) {
        await useGenerationStore.getState().setActive(providerId);
      }
    } catch (err) {
      set({
        validating: false,
        validation: { ok: false, code: 'UNKNOWN', message: (err as Error)?.message || '连接失败' },
      });
    }
  },

  retryValidate: async () => {
    await get().validate();
  },

  generateFirstImage: async () => {
    const { providerId, ratioId, quality } = get();
    if (!providerId || get().generating) return;
    const ratio = RATIO_OPTIONS.find((r) => r.id === ratioId) ?? RATIO_OPTIONS[0];
    set({ generating: true, generateError: null, generatedImagePath: null });
    try {
      const result: GenerateImageResult = await api.image.generate({
        providerId,
        prompt: EXAMPLE_PROMPT,
        size: ratio.size,
        aspectRatio: ratio.ratio,
        quality,
        n: 1,
      });
      if (result.status === 'success' && result.imagePath) {
        set({ generating: false, generatedImagePath: result.imagePath });
      } else {
        const code = result.error?.code ?? 'UNKNOWN';
        const message = result.error?.message ?? '生成失败';
        set({ generating: false, generateError: { code, message } });
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? 'UNKNOWN';
      const message = (err as Error)?.message || '生成失败';
      set({ generating: false, generateError: { code, message } });
    }
  },

  skip: () => {
    writeOnboarded();
    set({ onboarded: true, forced: false });
    useAppStore.getState().setView('library');
  },

  finish: () => {
    // 引首落印（v0.3.3 §7）：卸载引导层前记下 logo 圆点坐标；减少动效时朱点直接就位。
    try {
      if (hatchMotionAllowed()) {
        const dot = document.querySelector('[data-testid="onboarding-flow"] [data-logo-dot]');
        const rect = dot?.getBoundingClientRect();
        if (rect) {
          // 入场未完成时 rect 可能塌缩为原点（scale 0），此时中心点仍有效，取名义尺寸起飞。
          const size = Math.max(rect.width, 8);
          useEmberHatchStore.getState().requestHatch({
            x: rect.x + rect.width / 2 - size / 2,
            y: rect.y + rect.height / 2 - size / 2,
            width: size,
            height: size,
          });
        }
      }
    } catch {
      /* 落印是仪式不是功能：任何异常都不阻塞完成引导 */
    }
    writeOnboarded();
    set({ onboarded: true, forced: false });
    // 完成引导进入工作台开卷（skip 仍去提示词库，行为不变）
    useAppStore.getState().setView('generate');
  },

  forceShow: () =>
    set({
      forced: true,
      onboarded: false,
      step: 1,
      // forceShow 仅 E2E 使用：保持 v0.3 既有测试直接进入 BYOK 表单，不让新增轨道选择破坏旧用例。
      track: 'byok',
      accountStage: 'choose',
      accountBusy: false,
      accountError: null,
      accountQuota: null,
      textConnectionId: null,
      textValidation: null,
      // 旧 E2E 覆盖的是单 Provider 路径；普通用户初始值仍为 true。
      alsoConfigureText: false,
      doubaoWindowOpened: false,
      presetId: DEFAULT_PRESET_ID,
      apiKey: '',
      providerId: null,
      saving: false,
      validating: false,
      validation: null,
      ratioId: '1:1',
      quality: 'medium',
      generating: false,
      generateError: null,
      generatedImagePath: null,
    }),

  resetForTest: () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(ONBOARDED_KEY);
      } catch {
        /* noop */
      }
    }
    get().forceShow();
    set({ onboarded: false });
  },
}));
