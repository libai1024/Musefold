import type { AccountSummary, AiProvider } from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { AccountFooter } from '../AccountFooter';
import { AccountPanel } from '../AccountPanel';
import { AiConnectionsPanel } from '../AiConnectionsPanel';
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
  createdAt: '2026-08-01T00:00:00+00:00',
  updatedAt: '2026-08-01T00:00:00+00:00',
};

interface GatewayOverrides {
  signedIn?: boolean;
  providers?: AiProvider[];
}

function createGateway(overrides: GatewayOverrides = {}) {
  let signedIn = overrides.signedIn ?? false;
  const login = vi.fn(async () => {
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
  const gateway = {
    account: {
      getStatus: async () => {
        if (!signedIn) throw new Error('桌面端尚未登录');
        return SIGNED_IN;
      },
      login,
      register: vi.fn(),
      logout,
      redeem,
    },
    aiProviders: {
      list: async () => overrides.providers ?? [],
      create: createProvider,
      update: vi.fn(),
      remove: vi.fn(),
      setActive: vi.fn(),
      test: testProvider,
    },
  } as unknown as MusefoldGateway;
  return { gateway, login, logout, redeem, createProvider, testProvider };
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

  it('lists relay and doubao access entries on desktop and deep-links to connections', async () => {
    const { gateway } = createGateway({
      signedIn: true,
      providers: [
        PROVIDER,
        { ...PROVIDER, id: 'prov-doubao', name: '豆包网页', type: 'doubao-web' },
      ],
    });
    const onOpenSettings = vi.fn();
    renderWith(gateway, <AccountFooter onOpenSettings={onOpenSettings} />, DESKTOP_CAPABILITIES);

    await screen.findByTestId('account-footer');
    await userEvent.click(screen.getByTestId('account-footer'));

    const relayRow = await screen.findByTestId('account-menu-relay');
    await waitFor(() => {
      expect(relayRow.textContent).toContain('1 个连接');
      expect(screen.getByTestId('account-menu-doubao').textContent).toContain('已接入');
    });

    await userEvent.click(relayRow);
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'settings-connections' });
  });

  it('hides access entries on web where local providers are unavailable', async () => {
    const { gateway } = createGateway();
    renderWith(gateway, <AccountFooter onOpenSettings={vi.fn()} />, WEB_CAPABILITIES);

    await screen.findByTestId('account-footer-signed-out');
    await userEvent.click(screen.getByTestId('account-footer-signed-out'));
    await screen.findByTestId('account-menu-login');
    expect(screen.queryByTestId('account-menu-relay')).toBeNull();
    expect(screen.queryByTestId('account-menu-doubao')).toBeNull();
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
