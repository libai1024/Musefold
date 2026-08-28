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
import { describe, expect, it, vi } from 'vitest';
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
    },
  } as unknown as MusefoldGateway;
  return { gateway, login, logout, redeem, createProvider };
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
  it('renders sign-in entry when logged out and account chip when logged in', async () => {
    const signedOut = createGateway();
    const onOpen = vi.fn();
    renderWith(signedOut.gateway, <AccountFooter onOpenAccount={onOpen} />);
    await screen.findByTestId('account-footer-signed-out');
    await userEvent.click(screen.getByTestId('account-footer-signed-out'));
    expect(onOpen).toHaveBeenCalled();

    const signedIn = createGateway({ signedIn: true });
    renderWith(signedIn.gateway, <AccountFooter onOpenAccount={vi.fn()} />);
    await screen.findByTestId('account-footer');
    expect(screen.getByTestId('account-footer').textContent).toContain('xiaomiao');
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
});
