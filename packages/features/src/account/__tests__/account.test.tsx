import type {
  AccountSummary,
  AiProvider,
  DesktopSyncConsent,
  DesktopSyncStatus,
  LoginRequest,
  SyncConflictResolution,
  SyncConflictSummary,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { AccountFooter } from '../AccountFooter';
import { AccountPanel } from '../AccountPanel';
import { AiConnectionsPanel } from '../AiConnectionsPanel';
import { CloudSyncPanel } from '../CloudSyncPanel';
import { formatPoints } from '../hooks';

const SIGNED_IN: AccountSummary = {
  id: 'u1',
  username: 'xiaomiao',
  displayName: null,
  quota: 3_140_000,
  quotaUnit: '点',
  canGenerate: true,
};

const PROVIDER: AiProvider = {
  id: 'prov-1',
  name: '自建网关',
  type: 'openai-compatible',
  baseUrl: 'https://relay.example.com',
  model: 'gemini-2.5-flash-image',
  hasKey: true,
  keySuffix: 'a1b2',
  isActive: true,
  managedBy: null,
  createdAt: '2026-08-01T00:00:00+00:00',
  updatedAt: '2026-08-01T00:00:00+00:00',
};

/** 账号托管行(V05 FR-GW-01 迁移库形态):官方通道的本地生图落点。 */
const ACCOUNT_PROVIDER: AiProvider = {
  ...PROVIDER,
  id: 'prov-account',
  name: 'Musefold 账号',
  managedBy: 'account',
  isActive: false,
};

/** SyncGateway 未从 platform barrel 导出;从 MusefoldGateway 可选槽位推导同一类型。 */
type SyncGateway = NonNullable<MusefoldGateway['sync']>;

interface GatewayOverrides {
  signedIn?: boolean;
  providers?: AiProvider[];
  syncFixture?: SyncFixture;
}

interface SyncFixture {
  status: DesktopSyncStatus;
  conflicts?: SyncConflictSummary[];
}

const SYNC_ACCOUNT = { username: 'xiaomiao', deviceName: 'Musefold Mac' };

function syncStatus(patch: Partial<DesktopSyncStatus> = {}): DesktopSyncStatus {
  return {
    consent: 'enabled',
    phase: 'idle',
    enabled: true,
    state: 'idle',
    account: SYNC_ACCOUNT,
    lastSyncedAt: '2026-08-20T10:00:00+00:00',
    pendingMutations: 0,
    conflicts: 0,
    error: null,
    ...patch,
  };
}

/**
 * 完整实现 SyncGateway(required 方法一个不落),不用类型断言掩盖缺方法。
 * 内部状态可变性模拟主进程:consent/resolve 后的 status 由假实现自行派生。
 */
function createSyncGateway(initial: SyncFixture) {
  const state = {
    status: initial.status,
    conflicts: [...(initial.conflicts ?? [])],
  };
  const derivePhase = (consent: DesktopSyncConsent): DesktopSyncStatus['phase'] =>
    consent === 'enabled'
      ? state.conflicts.length > 0
        ? 'conflict'
        : 'idle'
      : consent === 'paused'
        ? 'paused'
        : 'awaiting_consent';
  const setConsent = vi.fn(async (consent: DesktopSyncConsent) => {
    const phase = derivePhase(consent);
    state.status = {
      ...state.status,
      consent,
      enabled: consent === 'enabled',
      phase,
      state: phase === 'conflict' ? 'conflict' : consent === 'enabled' ? 'idle' : 'disabled',
      conflicts: state.conflicts.length,
    };
    return state.status;
  });
  const listConflicts = vi.fn(async () => state.conflicts);
  const resolveConflict = vi.fn(async (conflictId: string, _resolution: SyncConflictResolution) => {
    state.conflicts = state.conflicts.filter((conflict) => conflict.id !== conflictId);
    state.status = {
      ...state.status,
      conflicts: state.conflicts.length,
      phase: state.conflicts.length > 0 ? 'conflict' : 'idle',
      state: state.conflicts.length > 0 ? 'conflict' : 'idle',
    };
    return state.status;
  });
  const setEnabled = vi.fn(async (enabled: boolean) => {
    state.status = { ...state.status, enabled };
    return state.status;
  });
  const syncNow = vi.fn(async () => {
    state.status = { ...state.status, lastSyncedAt: '2026-08-29T10:00:00+00:00' };
    return state.status;
  });
  const sync: SyncGateway = {
    getStatus: vi.fn(async () => state.status),
    setConsent,
    listConflicts,
    resolveConflict,
    setEnabled,
    syncNow,
  };
  return { sync, state, setConsent, listConflicts, resolveConflict, setEnabled, syncNow };
}

type SyncGatewayHandle = ReturnType<typeof createSyncGateway>;

function requireSyncGateway(handle: SyncGatewayHandle | null): SyncGatewayHandle {
  if (!handle) throw new Error('该用例需要 syncFixture');
  return handle;
}

function createGateway(overrides: GatewayOverrides = {}) {
  let signedIn = overrides.signedIn ?? false;
  const login = vi.fn(async () => {
    signedIn = true;
    return SIGNED_IN;
  });
  const register = vi.fn(async (_input: LoginRequest) => {
    signedIn = true;
    return SIGNED_IN;
  });
  const logout = vi.fn(async () => {
    signedIn = false;
  });
  const redeem = vi.fn(async () => ({
    account: { ...SIGNED_IN, quota: SIGNED_IN.quota + 500_000 },
    creditedQuota: 500_000,
  }));
  const createProvider = vi.fn(async () => PROVIDER);
  const testProvider = vi.fn(async () => ({
    ok: true as const,
    message: '连接正常',
    latencyMs: 128,
  }));
  const setActiveProvider = vi.fn(async (id: string) => ({ ...PROVIDER, id, isActive: true }));
  const syncGateway = overrides.syncFixture ? createSyncGateway(overrides.syncFixture) : null;
  const gateway = {
    account: {
      getStatus: async () => {
        if (!signedIn) throw new Error('桌面端尚未登录');
        return SIGNED_IN;
      },
      login,
      register,
      logout,
      redeem,
    },
    aiProviders: {
      list: async () => overrides.providers ?? [],
      create: createProvider,
      update: vi.fn(),
      remove: vi.fn(),
      setActive: setActiveProvider,
      test: testProvider,
    },
    ...(syncGateway ? { sync: syncGateway.sync } : {}),
  } as unknown as MusefoldGateway;
  return {
    gateway,
    login,
    register,
    logout,
    redeem,
    createProvider,
    testProvider,
    setActiveProvider,
    syncGateway,
  };
}

function renderWith(
  gateway: MusefoldGateway,
  ui: ReactNode,
  capabilities: PlatformCapabilities = WEB_CAPABILITIES,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformProvider runtime={{ gateway, capabilities }}>{ui}</PlatformProvider>
    </QueryClientProvider>,
  );
}

describe('formatPoints', () => {
  it('converts quota to points with at most one decimal', () => {
    expect(formatPoints(3_140_000)).toBe('62.8');
    expect(formatPoints(150_000)).toBe('3');
    expect(formatPoints(0)).toBe('0');
  });
});

describe('AccountPanel', () => {
  it('signs in through the gateway and switches to the signed-in view', async () => {
    const { gateway, login } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ username: 'xiaomiao', password: 'secret' });
      expect(screen.getByTestId('account-signed-in')).toBeTruthy();
    });
    expect(screen.getByTestId('account-points').textContent).toBe('62.8 积分');
  });

  it('shows inline error when login fails', async () => {
    const { gateway } = createGateway();
    (gateway.account.login as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('用户名或密码不正确'),
    );
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'wrong');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await screen.findByTestId('account-auth-error');
    expect(screen.getByTestId('account-auth-error').textContent).toContain('用户名或密码不正确');
  });

  it('shows the confirm-password field only in register mode', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    expect(screen.queryByTestId('account-confirm-password')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    const confirm = screen.getByTestId('account-confirm-password');
    expect(confirm.getAttribute('type')).toBe('password');
    expect(confirm.getAttribute('autocomplete')).toBe('new-password');

    await userEvent.click(screen.getByRole('button', { name: '已有账号?登录' }));
    expect(screen.queryByTestId('account-confirm-password')).toBeNull();
  });

  it('blocks register submit with mismatched passwords and shows a field-level error', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'different');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    const error = await screen.findByTestId('account-password-mismatch');
    expect(error.textContent).toContain('不一致');
    expect(screen.getByTestId('account-confirm-password').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(gateway.account.register).not.toHaveBeenCalled();
  });

  it('blocks Enter implicit form submit with mismatched passwords too', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    // Enter 隐式提交走同一个 submit handler,必须同样被拦。
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'different{enter}');

    await screen.findByTestId('account-password-mismatch');
    expect(gateway.account.register).not.toHaveBeenCalled();
  });

  it('registers with exactly { username, password } and no confirmPassword on the wire', async () => {
    const { gateway, register } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'secret');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(1);
    });
    expect(register).toHaveBeenCalledWith({ username: 'xiaomiao', password: 'secret' });
    expect(Object.keys(register.mock.calls[0][0])).toEqual(['username', 'password']);
    await screen.findByTestId('account-signed-in');
  });

  it('clears confirm password and mismatch state when switching modes', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'different');
    await userEvent.click(screen.getByTestId('account-auth-submit'));
    await screen.findByTestId('account-password-mismatch');

    await userEvent.click(screen.getByRole('button', { name: '已有账号?登录' }));
    expect(screen.queryByTestId('account-password-mismatch')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    expect((screen.getByTestId('account-confirm-password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('account-password-mismatch')).toBeNull();
  });

  it('compares passwords raw without trimming and keeps the raw password in the payload', async () => {
    const { gateway, register } = createGateway();
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    // 前后空格是有意义字符:' secret ' 与 'secret' 必须判失配。
    await userEvent.type(screen.getByTestId('account-password'), ' secret ');
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'secret');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await screen.findByTestId('account-password-mismatch');
    expect(register).not.toHaveBeenCalled();

    // 修正确认值为完全一致的原始串后放行,密码原样(含前后空格)进 payload。
    await userEvent.clear(screen.getByTestId('account-confirm-password'));
    expect(screen.queryByTestId('account-password-mismatch')).toBeNull();
    await userEvent.type(screen.getByTestId('account-confirm-password'), ' secret ');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith({ username: 'xiaomiao', password: ' secret ' });
    });
  });

  it('keeps the auth mode locked while a registration request is pending', async () => {
    let resolveRegister: ((account: AccountSummary) => void) | undefined;
    const { gateway } = createGateway();
    (gateway.account.register as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<AccountSummary>((resolve) => {
          resolveRegister = resolve;
        }),
    );
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-auth-form');
    await userEvent.click(screen.getByRole('button', { name: '没有账号?注册' }));
    await userEvent.type(screen.getByTestId('account-username'), 'xiaomiao');
    await userEvent.type(screen.getByTestId('account-password'), 'secret');
    await userEvent.type(screen.getByTestId('account-confirm-password'), 'secret');
    await userEvent.click(screen.getByTestId('account-auth-submit'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已有账号?登录' })).toHaveProperty(
        'disabled',
        true,
      );
    });
    expect(resolveRegister).toBeTypeOf('function');
    resolveRegister?.(SIGNED_IN);
    await waitFor(() => {
      expect(screen.getByTestId('account-auth-submit')).toHaveProperty('disabled', false);
    });
  });

  it('redeems a code and refreshes the balance', async () => {
    const { gateway, redeem } = createGateway({ signedIn: true });
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-signed-in');
    await userEvent.type(screen.getByTestId('account-redeem-input'), 'CODE-123');
    await userEvent.click(screen.getByTestId('account-redeem-submit'));

    await waitFor(() => {
      expect(redeem).toHaveBeenCalledWith('CODE-123');
      expect(screen.getByTestId('account-points').textContent).toBe('72.8 积分');
    });
  });

  it('logs out after confirmation and returns to the auth form', async () => {
    const { gateway, logout } = createGateway({ signedIn: true });
    renderWith(gateway, <AccountPanel />);

    await screen.findByTestId('account-signed-in');
    await userEvent.click(screen.getByTestId('account-logout'));
    await userEvent.click(await screen.findByTestId('account-logout-confirm'));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
      expect(screen.getByTestId('account-auth-form')).toBeTruthy();
    });
  });
});

describe('AccountFooter', () => {
  beforeEach(() => {
    useScreenIntent.setState({ intent: null });
  });

  it('opens the identity menu when signed out and deep-links login to settings', async () => {
    const { gateway } = createGateway();
    const onOpenSettings = vi.fn();
    renderWith(gateway, <AccountFooter onOpenSettings={onOpenSettings} />);

    await screen.findByTestId('account-footer-signed-out');
    await userEvent.click(screen.getByTestId('account-footer-signed-out'));
    await userEvent.click(await screen.findByTestId('account-menu-login'));

    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'settings-account' });
  });

  it('shows identity summary and logs out after confirmation when signed in', async () => {
    const { gateway, logout } = createGateway({ signedIn: true });
    renderWith(gateway, <AccountFooter onOpenSettings={vi.fn()} />);

    const trigger = await screen.findByTestId('account-footer');
    expect(trigger.textContent).toContain('xiaomiao');
    expect(trigger.textContent).toContain('62.8 积分');

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId('account-menu-logout'));
    await userEvent.click(await screen.findByTestId('account-menu-logout-confirm'));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });
  });

  it('switches the active connection through the more-connections submenu on desktop', async () => {
    const { gateway, setActiveProvider } = createGateway({
      signedIn: true,
      providers: [
        PROVIDER,
        { ...PROVIDER, id: 'prov-doubao', name: '豆包网页', type: 'doubao-web', isActive: false },
      ],
    });
    renderWith(gateway, <AccountFooter onOpenSettings={vi.fn()} />, DESKTOP_CAPABILITIES);

    // 触发钮显示当前通道:活跃行是中转站 → 显示连接名 + 中转站通道。
    const trigger = await screen.findByTestId('account-footer');
    await waitFor(() => {
      expect(trigger.dataset.channel).toBe('relay');
      expect(trigger.textContent).toContain('自建网关');
      expect(trigger.textContent).toContain('中转站通道');
    });
    await userEvent.click(trigger);

    const more = await screen.findByTestId('account-menu-more');
    fireEvent.keyDown(more, { key: 'ArrowRight' });

    // 中转站行:PROVIDER 是活跃连接 → 当前使用勾;豆包行:已配置 → 免费试用提示。
    const relayRow = await screen.findByTestId('account-menu-relay');
    await waitFor(() => {
      expect(relayRow.querySelector('[aria-label="当前使用"]')).toBeTruthy();
      expect(screen.getByTestId('account-menu-doubao').textContent).toContain('免费试用');
    });

    await userEvent.click(screen.getByTestId('account-menu-doubao'));
    await waitFor(() => {
      expect(setActiveProvider).toHaveBeenCalledWith('prov-doubao');
    });
  });

  it('displays doubao as the current channel and switches back to the official account', async () => {
    const { gateway, setActiveProvider } = createGateway({
      signedIn: true,
      providers: [
        ACCOUNT_PROVIDER,
        { ...PROVIDER, isActive: false },
        { ...PROVIDER, id: 'prov-doubao', name: '豆包网页', type: 'doubao-web', isActive: true },
      ],
    });
    renderWith(gateway, <AccountFooter onOpenSettings={vi.fn()} />, DESKTOP_CAPABILITIES);

    // 豆包是活跃行 → 触发钮显示豆包通道。
    const trigger = await screen.findByTestId('account-footer');
    await waitFor(() => {
      expect(trigger.dataset.channel).toBe('doubao');
      expect(trigger.textContent).toContain('豆包');
      expect(trigger.textContent).toContain('免费试用通道');
    });

    await userEvent.click(trigger);
    const more = await screen.findByTestId('account-menu-more');
    fireEvent.keyDown(more, { key: 'ArrowRight' });

    // 官方账号行存在托管行 → 点击切回账号通道。
    const officialRow = await screen.findByTestId('account-menu-official');
    expect(officialRow.textContent).toContain('推荐');
    await userEvent.click(officialRow);
    await waitFor(() => {
      expect(setActiveProvider).toHaveBeenCalledWith('prov-account');
    });
  });

  it('marks the official account as current when no local connection is active', async () => {
    // 无任何本地连接:官方账号即当前通道(触发钮 account 态 + 官方行勾选)。
    const { gateway, setActiveProvider } = createGateway({ signedIn: true, providers: [] });
    const onOpenSettings = vi.fn();
    renderWith(gateway, <AccountFooter onOpenSettings={onOpenSettings} />, DESKTOP_CAPABILITIES);

    const trigger = await screen.findByTestId('account-footer');
    await waitFor(() => {
      expect(trigger.dataset.channel).toBe('account');
      expect(trigger.textContent).toContain('xiaomiao');
    });

    await userEvent.click(trigger);
    const more = await screen.findByTestId('account-menu-more');
    fireEvent.keyDown(more, { key: 'ArrowRight' });

    const officialRow = await screen.findByTestId('account-menu-official');
    await waitFor(() => {
      expect(officialRow.querySelector('[aria-label="当前使用"]')).toBeTruthy();
    });
    // 已是当前通道:点击完全 no-op(不切换、不跳设置)。
    await userEvent.click(officialRow);
    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('jumps to settings connections card when the channel is not configured', async () => {
    // 只有中转站连接、无豆包:点豆包行不切换,深链设置连接区(豆包卡就地扫码登录)。
    const { gateway, setActiveProvider } = createGateway({
      signedIn: true,
      providers: [PROVIDER],
    });
    const onOpenSettings = vi.fn();
    renderWith(gateway, <AccountFooter onOpenSettings={onOpenSettings} />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('account-footer');
    await userEvent.click(screen.getByTestId('account-footer'));
    const more = await screen.findByTestId('account-menu-more');
    fireEvent.keyDown(more, { key: 'ArrowRight' });

    const doubaoRow = await screen.findByTestId('account-menu-doubao');
    await waitFor(() => {
      expect(doubaoRow.textContent).toContain('去登录');
    });
    await userEvent.click(doubaoRow);

    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'settings-connections' });
  });

  it('hides the more-connections submenu on web where local providers are unavailable', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountFooter onOpenSettings={vi.fn()} />, WEB_CAPABILITIES);

    await screen.findByTestId('account-footer-signed-out');
    await userEvent.click(screen.getByTestId('account-footer-signed-out'));
    await screen.findByTestId('account-menu-login');
    expect(screen.queryByTestId('account-menu-more')).toBeNull();
  });
});

describe('AiConnectionsPanel', () => {
  it('lists providers with key state and active badge', async () => {
    const { gateway } = createGateway({ providers: [PROVIDER] });
    renderWith(gateway, <AiConnectionsPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('ai-providers-list');
    expect(screen.getByText('自建网关')).toBeTruthy();
    expect(screen.getByTestId('ai-provider-active-badge')).toBeTruthy();
    expect(screen.getByText(/密钥 …a1b2/)).toBeTruthy();
  });

  it('creates a provider through the editor dialog', async () => {
    const { gateway, createProvider } = createGateway();
    renderWith(gateway, <AiConnectionsPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('ai-providers-empty');
    await userEvent.click(screen.getByTestId('ai-provider-new'));
    await screen.findByTestId('ai-provider-editor');
    await userEvent.type(screen.getByTestId('ai-provider-name'), '本地网关');
    await userEvent.type(screen.getByTestId('ai-provider-base-url'), 'https://gw.local/v1');
    await userEvent.type(screen.getByTestId('ai-provider-model'), 'flux-schnell');
    await userEvent.type(screen.getByTestId('ai-provider-key'), 'sk-test-1234');
    await userEvent.click(screen.getByTestId('ai-provider-save'));

    await waitFor(() => {
      expect(createProvider).toHaveBeenCalledWith({
        name: '本地网关',
        baseUrl: 'https://gw.local/v1',
        model: 'flux-schnell',
        apiKey: 'sk-test-1234',
        activate: false,
      });
    });
  });

  it('tests a connection and shows the inline result', async () => {
    const { gateway, testProvider } = createGateway({ providers: [PROVIDER] });
    renderWith(gateway, <AiConnectionsPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('ai-providers-list');
    await userEvent.click(screen.getByTestId('ai-provider-test'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-provider-test-result').textContent).toBe('连接正常 · 128ms');
    });
    expect(testProvider).toHaveBeenCalledWith(PROVIDER.id);
  });
});

// ── CloudSyncPanel(桌面云同步:consent 三态 + runtime phase + 逐条冲突)──────

function promptConflict(id: string, entityId: string, localTitle: string): SyncConflictSummary {
  return {
    id,
    entityId,
    entityType: 'prompt',
    canDuplicate: true,
    localSnapshot: {
      title: localTitle,
      description: null,
      content: 'local content',
      negative: null,
      folderId: null,
      tagIds: [],
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      pinOrder: null,
      source: 'manual',
      sourceUrl: null,
    },
    remoteSnapshot: {
      id: entityId,
      title: `云端 ${localTitle}`,
      description: null,
      content: 'remote content',
      negative: null,
      folderId: null,
      tags: [],
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      pinOrder: null,
      usageCount: 0,
      lastUsedAt: null,
      source: 'manual',
      sourceUrl: null,
      version: 3,
      createdAt: '2026-08-01T00:00:00+00:00',
      updatedAt: '2026-08-21T08:00:00+00:00',
      deletedAt: null,
    },
    createdAt: '2026-08-21T09:30:00+00:00',
  };
}

const FOLDER_CONFLICT: SyncConflictSummary = {
  id: 'conflict-folder-1',
  entityId: 'folder-1',
  entityType: 'folder',
  canDuplicate: false,
  localSnapshot: { name: '本机文件夹', parentId: null, sortOrder: 1 },
  remoteSnapshot: {
    id: 'folder-1',
    name: '云端文件夹',
    parentId: null,
    sortOrder: 1,
    version: 2,
    createdAt: '2026-08-01T00:00:00+00:00',
    updatedAt: '2026-08-21T08:00:00+00:00',
    deletedAt: null,
  },
  createdAt: '2026-08-21T09:30:00+00:00',
};

/** 删除型 tag 冲突没有本地字段:行走 entityId fallback。 */
const TAG_CONFLICT: SyncConflictSummary = {
  id: 'conflict-tag-1',
  entityId: 'tag-1',
  entityType: 'tag',
  canDuplicate: false,
  localSnapshot: {},
  remoteSnapshot: {
    id: 'tag-1',
    name: '云端标签',
    group: null,
    color: null,
    version: 2,
    createdAt: '2026-08-01T00:00:00+00:00',
    updatedAt: '2026-08-21T08:00:00+00:00',
    deletedAt: null,
  },
  createdAt: '2026-08-21T09:30:00+00:00',
};

describe('CloudSyncPanel', () => {
  it('prompts first-run consent with an explicit enable CTA, not a two-state switch', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({
          consent: 'unset',
          phase: 'awaiting_consent',
          enabled: false,
          state: 'disabled',
          lastSyncedAt: null,
        }),
      },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    const enable = await screen.findByTestId('sync-consent-enable');
    expect(enable.textContent).toContain('开启云同步');
    expect(screen.queryByRole('switch')).toBeNull();

    await userEvent.click(enable);
    await waitFor(() => {
      expect(syncGateway.setConsent).toHaveBeenCalledWith('enabled');
    });
    // 同意后进入 enabled 态:出现立即同步 / 暂停同步。
    await screen.findByTestId('sync-now');
    expect(screen.getByTestId('sync-consent-pause')).toBeTruthy();
  });

  it('pauses and resumes syncing through durable consent', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: { status: syncStatus({ pendingMutations: 2 }) },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    await userEvent.click(await screen.findByTestId('sync-consent-pause'));
    await waitFor(() => {
      expect(syncGateway.setConsent).toHaveBeenCalledWith('paused');
    });
    await screen.findByText('同步已暂停');
    expect(screen.getByTestId('sync-subtitle').textContent).toContain('本地仍可正常使用');
    expect(screen.getByTestId('sync-legacy-summary').textContent).toContain('2 项等待同步');

    await userEvent.click(screen.getByTestId('sync-consent-resume'));
    await waitFor(() => {
      expect(syncGateway.setConsent).toHaveBeenCalledWith('enabled');
    });
    await screen.findByTestId('sync-now');
  });

  it('keeps paused conflicts actionable and labels an empty paused queue accurately', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({
          consent: 'paused',
          phase: 'paused',
          enabled: false,
          state: 'disabled',
          conflicts: 1,
          pendingMutations: 0,
        }),
        conflicts: [promptConflict('conflict-paused', 'prompt-paused', '暂停期间冲突')],
      },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    expect((await screen.findByTestId('sync-legacy-summary')).textContent).toBe('同步已暂停');
    const row = await screen.findByTestId('sync-conflict-row-conflict-paused');
    await userEvent.click(within(row).getByRole('button', { name: '保留云端' }));
    await waitFor(() => {
      expect(syncGateway.resolveConflict).toHaveBeenCalledWith('conflict-paused', 'remote');
    });
  });

  it('blocks all transport actions while signed out', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      syncFixture: {
        status: syncStatus({
          consent: 'unset',
          phase: 'signed_out',
          enabled: false,
          state: 'disabled',
          account: null,
          lastSyncedAt: null,
        }),
      },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    await screen.findByText('登录账号后可开启云同步');
    const card = screen.getByTestId('settings-sync-card');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(syncGateway.setConsent).not.toHaveBeenCalled();
    expect(syncGateway.syncNow).not.toHaveBeenCalled();
    expect(syncGateway.setEnabled).not.toHaveBeenCalled();
  });

  it('runs an immediate sync and skips the conflicts query when nothing is pending', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: { status: syncStatus({ lastSyncedAt: null }) },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    expect((await screen.findByTestId('sync-subtitle')).textContent).toContain('尚未同步');
    await userEvent.click(screen.getByTestId('sync-now'));
    await waitFor(() => {
      expect(syncGateway.syncNow).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('sync-subtitle').textContent).toContain('上次同步');
    });
    // 无冲突且 phase 非 conflict:绝不空查冲突列表。
    expect(syncGateway.listConflicts).not.toHaveBeenCalled();
  });

  it('maps each conflict row action to its resolution', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({ phase: 'conflict', state: 'conflict', conflicts: 3 }),
        conflicts: [
          promptConflict('conflict-p1', 'prompt-1', '本机甲'),
          promptConflict('conflict-p2', 'prompt-2', '本机乙'),
          promptConflict('conflict-p3', 'prompt-3', '本机丙'),
        ],
      },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('sync-conflict-list');
    expect(screen.getByText('需要处理的同步冲突')).toBeTruthy();

    const row1 = screen.getByTestId('sync-conflict-row-conflict-p1');
    expect(row1.textContent).toContain('提示词');
    expect(row1.textContent).toContain('本机甲');
    expect(row1.textContent).toContain('云端 本机甲');

    await userEvent.click(within(row1).getByRole('button', { name: '保留云端' }));
    await waitFor(() => {
      expect(syncGateway.resolveConflict).toHaveBeenCalledWith('conflict-p1', 'remote');
    });

    const row2 = await screen.findByTestId('sync-conflict-row-conflict-p2');
    await userEvent.click(within(row2).getByRole('button', { name: '保留本地' }));
    await waitFor(() => {
      expect(syncGateway.resolveConflict).toHaveBeenCalledWith('conflict-p2', 'local');
    });

    const row3 = await screen.findByTestId('sync-conflict-row-conflict-p3');
    await userEvent.click(within(row3).getByRole('button', { name: '另存本地副本' }));
    await waitFor(() => {
      expect(syncGateway.resolveConflict).toHaveBeenCalledWith('conflict-p3', 'duplicate');
    });
  });

  it('hides the duplicate action for folder and tag conflicts', async () => {
    const { gateway } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({ phase: 'conflict', state: 'conflict', conflicts: 2 }),
        conflicts: [FOLDER_CONFLICT, TAG_CONFLICT],
      },
    });
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('sync-conflict-list');
    expect(screen.queryByRole('button', { name: '另存本地副本' })).toBeNull();
    const folderRow = screen.getByTestId('sync-conflict-row-conflict-folder-1');
    expect(folderRow.textContent).toContain('文件夹');
    expect(folderRow.textContent).toContain('本机文件夹');
    expect(within(folderRow).getByRole('button', { name: '保留云端' })).toBeTruthy();
    expect(within(folderRow).getByRole('button', { name: '保留本地' })).toBeTruthy();
    // tag 无 title/name:摘要回退到 entityId。
    const tagRow = screen.getByTestId('sync-conflict-row-conflict-tag-1');
    expect(tagRow.textContent).toContain('tag-1');
  });

  it('refreshes the conflicts query after a successful resolution', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({ phase: 'conflict', state: 'conflict', conflicts: 1 }),
        conflicts: [promptConflict('conflict-p1', 'prompt-1', '本机甲')],
      },
    });
    const syncGateway = requireSyncGateway(handle);
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    const row = await screen.findByTestId('sync-conflict-row-conflict-p1');
    await waitFor(() => {
      expect(syncGateway.listConflicts).toHaveBeenCalled();
    });
    const callsBefore = syncGateway.listConflicts.mock.calls.length;

    await userEvent.click(within(row).getByRole('button', { name: '保留本地' }));
    await waitFor(() => {
      expect(screen.queryByTestId('sync-conflict-row-conflict-p1')).toBeNull();
    });
    // resolve 成功后冲突查询被失效并重新拉取(legacy bug:只更新计数不刷新明细)。
    await waitFor(() => {
      expect(syncGateway.listConflicts.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('keeps a failed resolution retryable with a row-level error', async () => {
    const { gateway, syncGateway: handle } = createGateway({
      signedIn: true,
      syncFixture: {
        status: syncStatus({ phase: 'conflict', state: 'conflict', conflicts: 1 }),
        conflicts: [promptConflict('conflict-p1', 'prompt-1', '本机甲')],
      },
    });
    const syncGateway = requireSyncGateway(handle);
    syncGateway.resolveConflict.mockRejectedValueOnce(new Error('网络抖动'));
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    const row = await screen.findByTestId('sync-conflict-row-conflict-p1');
    await userEvent.click(within(row).getByRole('button', { name: '保留本地' }));

    // 行级错误呈现,行保留可重试。
    await within(screen.getByTestId('sync-conflict-row-conflict-p1')).findByRole('alert');
    expect(screen.getByTestId('sync-conflict-row-conflict-p1').textContent).toContain('网络抖动');

    await userEvent.click(
      within(screen.getByTestId('sync-conflict-row-conflict-p1')).getByRole('button', {
        name: '保留本地',
      }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId('sync-conflict-row-conflict-p1')).toBeNull();
    });
    expect(syncGateway.resolveConflict).toHaveBeenCalledTimes(2);
  });

  it('surfaces a diagnosable auth_blocked state with the gateway error detail', async () => {
    const { gateway } = createGateway({
      syncFixture: {
        status: syncStatus({
          phase: 'auth_blocked',
          state: 'error',
          error: 'AUTH_SESSION_EXPIRED',
        }),
      },
    });
    renderWith(gateway, <CloudSyncPanel />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('sync-error');
    expect(screen.getByTestId('sync-phase').textContent).toContain('登录失效');
    expect(screen.getByTestId('sync-error').textContent).toContain('AUTH_SESSION_EXPIRED');
    expect(screen.getByTestId('sync-error').textContent).toContain('重新登录');
  });
});
