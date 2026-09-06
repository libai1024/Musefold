// 首启引导(U01-onboarding)证据:
// - gate 判定矩阵:哨兵 / 账号登录 / 本地 Provider / 豆包登录 / Web vs 桌面能力分叉;
// - 已具备通道且无哨兵时静默补写哨兵(存量用户不被引导层拦一次);
// - 步骤流前进/返回(含 connect 轨内返回)/ 跳过(AlertDialog 确认后写哨兵);
// - first-image 只把提示词送 pendingDraft 并切屏,绝不发起真实生图。

import type {
  AiProvider,
  AiProviderTestResult,
  AppPreferences,
  AppPreferencesPatch,
  DoubaoAccountStatus,
  ProviderOption,
} from '@musefold/contracts';
import { defaultAppPreferences } from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  type PlatformCapabilities,
  PlatformProvider,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveSession } from '../../workbench/session-store';
import { OnboardingFlow } from '../OnboardingFlow';
import { useOnboardingFlow } from '../onboarding-store';

const user = userEvent.setup({ pointerEventsCheck: 0 });

const SIGNED_IN = {
  id: 'u1',
  username: 'xiaomiao',
  displayName: null,
  quota: 3_140_000,
  quotaUnit: '点',
  canGenerate: true,
};

const LOCAL_PROVIDER: ProviderOption = {
  id: 'prov-1',
  label: '自建网关',
  model: 'gemini-2.5-flash-image',
  kind: 'local',
  available: true,
};

function doubaoStatus(patch: Partial<DoubaoAccountStatus> = {}): DoubaoAccountStatus {
  return {
    loggedIn: false,
    accountName: null,
    avatarDataUrl: null,
    verificationRequired: false,
    usage: { date: '2026-09-06', limit: 100, used: 0, remaining: 100 },
    loginState: 'logged-out',
    qrCodeDataUrl: null,
    qrExpiresAt: null,
    errorMessage: null,
    ...patch,
  };
}

interface HarnessOptions {
  capabilities?: PlatformCapabilities;
  /** 完成哨兵;undefined = 未完成引导。 */
  completedAt?: string;
  signedIn?: boolean;
  providers?: ProviderOption[];
  doubao?: DoubaoAccountStatus;
  /** aiProviders.test 的结果(BYOK 轨 validate)。 */
  testResult?: AiProviderTestResult;
  /** 偏好读取失败(宿主未提供 settings 域等):gate 必须 fail-closed 不弹。 */
  preferencesFails?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const preferences: AppPreferences = {
    ...defaultAppPreferences,
    onboardingCompletedAt: options.completedAt ?? null,
  };
  const state = { preferences, signedIn: options.signedIn ?? false };
  const updatePreferences = vi.fn(async (patch: AppPreferencesPatch) => {
    state.preferences = { ...state.preferences, ...patch };
    return state.preferences;
  });
  const getPreferences = vi.fn(async () => {
    if (options.preferencesFails) throw new Error('宿主未提供设置域');
    return state.preferences;
  });
  const getStatus = vi.fn(async () => {
    if (!state.signedIn) throw new Error('AUTH_REQUIRED');
    return SIGNED_IN;
  });
  const login = vi.fn(async (_credentials: { username: string; password: string }) => {
    state.signedIn = true;
    return SIGNED_IN;
  });
  const listProviders = vi.fn(async () => options.providers ?? []);
  const createProvider = vi.fn(
    async (input: { name: string; baseUrl: string; model: string; apiKey?: string }) =>
      ({
        id: 'prov-created',
        name: input.name,
        type: 'openai-compatible',
        baseUrl: input.baseUrl,
        model: input.model,
        hasKey: Boolean(input.apiKey),
        keySuffix: input.apiKey?.slice(-4) ?? null,
        isActive: true,
        managedBy: null,
        createdAt: '2026-09-06T00:00:00+00:00',
        updatedAt: '2026-09-06T00:00:00+00:00',
      }) satisfies AiProvider,
  );
  const testProvider = vi.fn(
    async () => options.testResult ?? { ok: true, message: '连接正常', latencyMs: 120 },
  );
  const doubaoGetStatus = vi.fn(async () => options.doubao ?? doubaoStatus());
  const startDoubaoLogin = vi.fn(async () => doubaoStatus({ loginState: 'qr-ready' }));

  const capabilities = options.capabilities ?? DESKTOP_CAPABILITIES;
  const gateway = {
    settings: { getPreferences, updatePreferences },
    account: { getStatus, login, register: login },
    generation: { listProviders },
    ...(capabilities.hasLocalAiProviders
      ? { aiProviders: { create: createProvider, test: testProvider, list: listProviders } }
      : {}),
    ...(capabilities.hasDoubaoWebLogin
      ? {
          doubao: {
            getStatus: doubaoGetStatus,
            startLogin: startDoubaoLogin,
            refreshLogin: startDoubaoLogin,
          },
        }
      : {}),
  } as unknown as MusefoldGateway;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities }}>{children}</PlatformProvider>
      </QueryClientProvider>
    );
  }
  return {
    Providers,
    state,
    spies: {
      getPreferences,
      updatePreferences,
      getStatus,
      login,
      listProviders,
      createProvider,
      testProvider,
      doubaoGetStatus,
      startDoubaoLogin,
    },
  };
}

function renderFlow(options: HarnessOptions = {}, onOpenScreen = vi.fn()) {
  const harness = makeHarness(options);
  render(<OnboardingFlow onOpenScreen={onOpenScreen} />, { wrapper: harness.Providers });
  return { ...harness, onOpenScreen };
}

/** 哨兵写入是 gate/收尾的唯一副作用形状:patch 必须带非空 onboardingCompletedAt。 */
function sentinelWrites(updatePreferences: ReturnType<typeof vi.fn>): AppPreferencesPatch[] {
  return updatePreferences.mock.calls
    .map(([patch]) => patch as AppPreferencesPatch)
    .filter((patch) => patch.onboardingCompletedAt != null);
}

beforeEach(() => {
  useOnboardingFlow.getState().reset();
  useActiveSession.setState({ pendingDraft: null, activeSessionId: null, draftSession: false });
});

afterEach(() => cleanup());

describe('首启引导 gate 判定矩阵', () => {
  it('桌面:未完成哨兵 + 无 Provider + 未登录 + 豆包未登录 → 弹引导', async () => {
    const { spies } = renderFlow();

    expect(await screen.findByTestId('onboarding-flow')).toBeTruthy();
    expect(screen.getByTestId('onboarding-step-welcome')).toBeTruthy();
    // 判定期不写哨兵:用户还没做决定。
    expect(sentinelWrites(spies.updatePreferences)).toHaveLength(0);
  });

  it('哨兵已写 → 不弹,且不再查通道结论后重放', async () => {
    const { spies } = renderFlow({ completedAt: '2026-09-01T00:00:00+00:00' });

    await waitFor(() => expect(spies.getPreferences).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('onboarding-flow')).toBeNull());
    expect(sentinelWrites(spies.updatePreferences)).toHaveLength(0);
  });

  it('桌面:已有可用本地 Provider → 不弹并静默补写哨兵', async () => {
    const { spies } = renderFlow({ providers: [LOCAL_PROVIDER] });

    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });

  it('桌面:Provider 目录全部不可用等价于没有通道 → 弹引导', async () => {
    renderFlow({ providers: [{ ...LOCAL_PROVIDER, available: false }] });

    expect(await screen.findByTestId('onboarding-flow')).toBeTruthy();
  });

  it('账号已登录 → 不弹并静默补写哨兵(存量用户不被拦)', async () => {
    const { spies } = renderFlow({ signedIn: true });

    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });

  it('桌面:豆包已登录 → 不弹并静默补写哨兵', async () => {
    const { spies } = renderFlow({
      doubao: doubaoStatus({ loggedIn: true, loginState: 'logged-in' }),
    });

    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });

  it('Web:未登录即弹,且只显示官方账号轨(不伪造 BYOK/豆包)', async () => {
    const { spies } = renderFlow({ capabilities: WEB_CAPABILITIES });

    expect(await screen.findByTestId('onboarding-flow')).toBeTruthy();
    await user.click(screen.getByTestId('onboarding-next'));

    expect(screen.getByTestId('onboarding-track-account')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-track-byok')).toBeNull();
    expect(screen.queryByTestId('onboarding-track-doubao')).toBeNull();
    // Web 宿主没有本地 Provider / 豆包域,gate 也不该去查。
    expect(spies.listProviders).not.toHaveBeenCalled();
    expect(spies.doubaoGetStatus).not.toHaveBeenCalled();
  });

  it('Web:账号已登录 → 不弹', async () => {
    const { spies } = renderFlow({ capabilities: WEB_CAPABILITIES, signedIn: true });

    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });

  it('偏好读取失败时 fail-closed:不弹引导也不写哨兵', async () => {
    const { spies } = renderFlow({ preferencesFails: true });

    await waitFor(() => expect(spies.getPreferences).toHaveBeenCalled());
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
    expect(spies.updatePreferences).not.toHaveBeenCalled();
  });
});

describe('首启引导步骤流', () => {
  it('welcome → connect → 轨内返回 → 轨道选择 → 再返回 welcome', async () => {
    renderFlow();
    await screen.findByTestId('onboarding-flow');

    await user.click(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step-connect')).toBeTruthy();
    expect(screen.getByTestId('onboarding-progress-connect').getAttribute('aria-current')).toBe(
      'step',
    );

    await user.click(screen.getByTestId('onboarding-track-byok'));
    expect(screen.getByTestId('onboarding-byok-form')).toBeTruthy();

    // 选中轨道后第一次「返回」退回轨道选择(承 v2.1),不是直接回 welcome。
    await user.click(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-track-byok')).toBeTruthy();
    await user.click(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-step-welcome')).toBeTruthy();
  });

  it('BYOK 轨:建连接经 gateway 落地(Key 只随入参走,不留在 store)→ validate 测连接 → first-image', async () => {
    const { spies } = renderFlow();
    await screen.findByTestId('onboarding-flow');
    await user.click(screen.getByTestId('onboarding-next'));
    await user.click(screen.getByTestId('onboarding-track-byok'));

    await user.clear(screen.getByTestId('onboarding-byok-name'));
    await user.type(screen.getByTestId('onboarding-byok-name'), '回环网关');
    await user.type(screen.getByTestId('onboarding-byok-base-url'), 'https://relay.example.com/v1');
    await user.type(screen.getByTestId('onboarding-byok-model'), 'gemini-2.5-flash-image');
    await user.type(screen.getByTestId('onboarding-byok-api-key'), 'sk-onboarding-test');
    await user.click(screen.getByTestId('onboarding-next'));

    await waitFor(() => expect(spies.createProvider).toHaveBeenCalledTimes(1));
    expect(spies.createProvider.mock.calls[0]?.[0]).toEqual({
      name: '回环网关',
      baseUrl: 'https://relay.example.com/v1',
      model: 'gemini-2.5-flash-image',
      apiKey: 'sk-onboarding-test',
      activate: true,
    });
    // 密钥不落引导 store(红线:只经 gateway 送宿主安全存储)。
    expect(JSON.stringify(useOnboardingFlow.getState())).not.toContain('sk-onboarding-test');

    // validate 自动跑一次,按 id 测已落库连接。
    await screen.findByTestId('onboarding-step-validate');
    await waitFor(() => expect(spies.testProvider).toHaveBeenCalledWith({ id: 'prov-created' }));
    await waitFor(() => expect(screen.getByTestId('onboarding-validate-result')).toBeTruthy());

    await user.click(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step-first-image')).toBeTruthy();
  });

  it('validate 失败:留在本步,可重试、可返回修正,不放行下一步', async () => {
    const { spies } = renderFlow({
      testResult: { ok: false, message: 'API Key 无效或无权限', latencyMs: null },
    });
    await screen.findByTestId('onboarding-flow');
    await user.click(screen.getByTestId('onboarding-next'));
    await user.click(screen.getByTestId('onboarding-track-byok'));
    await user.type(screen.getByTestId('onboarding-byok-base-url'), 'https://relay.example.com/v1');
    await user.type(screen.getByTestId('onboarding-byok-model'), 'm');
    await user.type(screen.getByTestId('onboarding-byok-api-key'), 'bad-key');
    await user.click(screen.getByTestId('onboarding-next'));

    await screen.findByTestId('onboarding-step-validate');
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-validate-result').textContent).toContain(
        'API Key 无效或无权限',
      ),
    );
    // 失败态没有「继续」,只有「重新确认」。
    expect(screen.queryByTestId('onboarding-next')).toBeNull();

    await user.click(screen.getByTestId('onboarding-retry'));
    await waitFor(() => expect(spies.testProvider).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-step-connect')).toBeTruthy();
  });

  it('账号轨:内联登录成功即进 validate,并按账号状态判定通道', async () => {
    const { spies } = renderFlow({ capabilities: WEB_CAPABILITIES });
    await screen.findByTestId('onboarding-flow');
    await user.click(screen.getByTestId('onboarding-next'));
    await user.click(screen.getByTestId('onboarding-track-account'));

    await user.type(screen.getByTestId('onboarding-account-username'), 'xiaomiao');
    await user.type(screen.getByTestId('onboarding-account-password'), '12345678');
    await user.click(screen.getByTestId('onboarding-next'));

    await waitFor(() => expect(spies.login).toHaveBeenCalledTimes(1));
    expect(spies.login.mock.calls[0]?.[0]).toEqual({
      username: 'xiaomiao',
      password: '12345678',
    });
    await screen.findByTestId('onboarding-step-validate');
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-validate-result').textContent).toContain('xiaomiao'),
    );
    // 登录让 gate 也具备通道,但引导层已放行,不得中途撤走。
    expect(screen.getByTestId('onboarding-flow')).toBeTruthy();
  });
});

describe('首启引导收尾', () => {
  it('跳过经 AlertDialog 确认后写哨兵并关闭;取消则留在引导', async () => {
    const { spies } = renderFlow();
    await screen.findByTestId('onboarding-flow');

    await user.click(screen.getByTestId('onboarding-skip'));
    await user.click(await screen.findByTestId('onboarding-skip-cancel'));
    expect(sentinelWrites(spies.updatePreferences)).toHaveLength(0);
    expect(screen.getByTestId('onboarding-flow')).toBeTruthy();

    await user.click(screen.getByTestId('onboarding-skip'));
    await user.click(await screen.findByTestId('onboarding-skip-confirm'));

    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('onboarding-flow')).toBeNull());
    expect(useOnboardingFlow.getState().step).toBe('welcome');
  });

  it('first-image「去生成」只把提示词送 pendingDraft 并切工作台,不发起真实生图', async () => {
    const { spies, onOpenScreen } = renderFlow({ providers: [], signedIn: false });
    await screen.findByTestId('onboarding-flow');
    // 直接落到 first-image(步骤流已在上面覆盖)。
    useOnboardingFlow.getState().goTo('first-image');

    const chip = await screen.findByTestId('onboarding-example-0');
    await user.click(chip);
    await user.click(screen.getByTestId('onboarding-next'));

    expect(useActiveSession.getState().pendingDraft).toEqual({
      prompt: chip.textContent,
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    });
    expect(onOpenScreen).toHaveBeenCalledWith('workbench');
    await waitFor(() => expect(sentinelWrites(spies.updatePreferences)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('onboarding-flow')).toBeNull());
  });

  it('对话框语义齐备:role=dialog + aria-modal,标题可读', async () => {
    renderFlow();

    const flow = await screen.findByTestId('onboarding-flow');
    expect(flow.getAttribute('role')).toBe('dialog');
    expect(flow.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Musefold 首次设置')).toBeTruthy();
  });
});
