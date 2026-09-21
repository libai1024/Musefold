import type { AccountSummary, LoginCapacityReview, LoginSessionPage } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanel } from '../AccountPanel';
import { LoginCapacityDialog, LoginSessionsPanel } from '../LoginSessions';
import { beginAccountTransition } from '../account-session';
import { useRememberedUsername } from '../remembered-username';

const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../history/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMediaQuery: () => viewport.desktop,
}));
vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const ACTIVE: AccountSummary = {
  id: 'owner',
  username: 'alice',
  displayName: null,
  quota: 100,
  quotaUnit: 'points',
  canGenerate: true,
};
const error = (code: string) => Object.assign(new Error(code), { code });
const devices = (current = false): LoginSessionPage => ({
  total: 2,
  limit: 2,
  required: 1,
  requiresReauthentication: false,
  items: ['device-a', 'device-b'].map((sessionRef, index) => ({
    sessionRef,
    version: 1,
    current: current && index === 0,
    client: index ? 'Safari' : 'Chrome',
    platform: index ? 'iOS' : 'macOS',
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    lastInteractiveAt: null,
    lastSeenAt: null,
    maskedIp: '192.168.*.*',
  })),
});
const review = (): LoginCapacityReview => ({
  flowRef: 'fa56d38a-c296-4f17-802c-e4e04e5bca6d',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  sessions: devices(),
});

function setup(signedIn = false) {
  const state = { current: signedIn ? ACTIVE : (null as AccountSummary | null) };
  const account = {
    getStatus: vi.fn(async () => {
      if (!state.current) throw error('AUTH_REQUIRED');
      return state.current;
    }),
    login: vi.fn(async () => {
      throw error('AUTH_SESSION_LIMIT');
    }),
    register: vi.fn(async () => ACTIVE),
    logout: vi.fn(async () => {
      state.current = null;
    }),
    redeem: vi.fn(async () => ({ account: ACTIVE, creditedQuota: 0 })),
    getLoginCapacityReview: vi.fn<
      NonNullable<MusefoldGateway['account']['getLoginCapacityReview']>
    >(async () => review()),
    cancelLoginCapacity: vi.fn(async () => {}),
    completeLoginCapacity: vi.fn<NonNullable<MusefoldGateway['account']['completeLoginCapacity']>>(
      async () => {
        state.current = ACTIVE;
        return ACTIVE;
      },
    ),
    listLoginSessions: vi.fn(async () => devices(true)),
    revokeLoginSessions: vi.fn<NonNullable<MusefoldGateway['account']['revokeLoginSessions']>>(
      async () => ({ released: 1 }),
    ),
  } satisfies MusefoldGateway['account'];
  const gateway = { account } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  return { account, client, Wrapper };
}
beforeEach(() => {
  viewport.desktop = true;
  useRememberedUsername.getState().remember('');
});
async function submitLogin() {
  await screen.findByTestId('account-auth-form');
  await userEvent.clear(screen.getByTestId('account-username'));
  await userEvent.type(screen.getByTestId('account-username'), 'alice');
  await userEvent.type(screen.getByTestId('account-password'), 'private-test-password');
  await userEvent.click(screen.getByTestId('account-auth-submit'));
  await screen.findByTestId('account-login-capacity');
  await screen.findByTestId('account-login-session-select-device-a');
}
async function selectAndConfirm() {
  await userEvent.click(screen.getByTestId('account-login-session-select-device-a'));
  await userEvent.click(screen.getByTestId('account-login-capacity-submit'));
  await screen.findByRole('alertdialog');
  await userEvent.click(screen.getByRole('button', { name: '确认释放并登录' }));
}

describe('full-capacity login', () => {
  it.each([true, false])(
    'automatically prompts, starts unselected, explicitly confirms and continues login (desktop=%s)',
    async (desktop) => {
      viewport.desktop = desktop;
      const { account, Wrapper } = setup();
      render(<AccountPanel />, { wrapper: Wrapper });
      await submitLogin();
      expect(screen.getByTestId('account-password')).toHaveProperty('value', '');
      expect(
        screen.getByTestId('account-login-session-select-device-a').getAttribute('aria-checked'),
      ).toBe('false');
      expect(screen.getByTestId('account-login-capacity-submit')).toHaveProperty('disabled', true);
      expect(account.completeLoginCapacity).not.toHaveBeenCalled();
      await selectAndConfirm();
      await screen.findByTestId('account-signed-in');
      expect(account.completeLoginCapacity).toHaveBeenCalledTimes(1);
      expect(account.completeLoginCapacity.mock.calls[0]?.[0]).toMatchObject({
        selected: [{ sessionRef: 'device-a', version: 1 }],
      });
      expect(JSON.stringify(account.completeLoginCapacity.mock.calls)).not.toContain(
        'private-test-password',
      );
      expect(screen.queryByTestId('account-login-capacity')).toBeNull();
    },
  );
  it('cancel releases nobody and restores the cleared password field focus', async () => {
    const { account, Wrapper } = setup();
    render(<AccountPanel />, { wrapper: Wrapper });
    await submitLogin();
    await userEvent.click(
      within(screen.getByTestId('account-login-capacity')).getByRole('button', { name: '取消' }),
    );
    await waitFor(() => expect(screen.queryByTestId('account-login-capacity')).toBeNull());
    expect(account.cancelLoginCapacity).toHaveBeenCalledTimes(1);
    expect(account.completeLoginCapacity).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('account-password'));
  });
  it('capacity contention refreshes and requires another explicit selection', async () => {
    const { account, Wrapper } = setup();
    account.completeLoginCapacity.mockRejectedValueOnce(error('AUTH_SESSION_REVIEW_CHANGED'));
    render(<AccountPanel />, { wrapper: Wrapper });
    await submitLogin();
    await selectAndConfirm();
    await screen.findByText('设备名额或选择已变化，请重新选择并确认。');
    expect(account.getLoginCapacityReview).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('account-login-session-select-device-a').getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByTestId('account-login-capacity-submit')).toHaveProperty('disabled', true);
    expect(account.completeLoginCapacity).toHaveBeenCalledTimes(1);
    await selectAndConfirm();
    await screen.findByTestId('account-signed-in');
    expect(account.completeLoginCapacity.mock.calls[1]?.[0].operationId).not.toBe(
      account.completeLoginCapacity.mock.calls[0]?.[0].operationId,
    );
  });
  it('unknown completion retries only the identical operation and frozen selection', async () => {
    const { account, Wrapper } = setup();
    account.completeLoginCapacity.mockRejectedValueOnce(error('NETWORK_ERROR'));
    render(<AccountPanel />, { wrapper: Wrapper });
    await submitLogin();
    await selectAndConfirm();
    const retry = await screen.findByRole('button', { name: '核对原登录请求' });
    expect(screen.getByTestId('account-login-session-select-device-b')).toHaveProperty(
      'disabled',
      true,
    );
    await userEvent.click(retry);
    await screen.findByTestId('account-signed-in');
    expect(account.completeLoginCapacity.mock.calls[1]?.[0]).toEqual(
      account.completeLoginCapacity.mock.calls[0]?.[0],
    );
  });
  it('expired verification cannot release or complete', async () => {
    const { account, Wrapper } = setup();
    account.getLoginCapacityReview.mockResolvedValue({
      ...review(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    render(<LoginCapacityDialog onClose={vi.fn()} restoreFocus={vi.fn()} />, { wrapper: Wrapper });
    await screen.findByTestId('account-login-capacity-expired');
    expect(screen.queryByTestId('account-login-capacity-submit')).toBeNull();
    expect(account.completeLoginCapacity).not.toHaveBeenCalled();
  });
  it('rapid duplicate confirmation submits once and an account switch hides old choices', async () => {
    const { account, client, Wrapper } = setup();
    let resolve!: (value: AccountSummary) => void;
    account.completeLoginCapacity.mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    render(<LoginCapacityDialog onClose={vi.fn()} restoreFocus={vi.fn()} />, { wrapper: Wrapper });
    await screen.findByTestId('account-login-session-select-device-a');
    await userEvent.click(screen.getByTestId('account-login-session-select-device-a'));
    await userEvent.click(screen.getByTestId('account-login-capacity-submit'));
    const button = screen.getByRole('button', { name: '确认释放并登录' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(account.completeLoginCapacity).toHaveBeenCalledTimes(1);
    act(() => {
      beginAccountTransition(client);
    });
    expect(screen.queryByTestId('account-login-capacity')).toBeNull();
    await act(async () => {
      resolve(ACTIVE);
    });
    expect(client.getQueryData(['account', 'status'])).toBeUndefined();
  });
});

describe('signed-in device management', () => {
  it('allows fresh verification inside the confirmation and retries the original selection', async () => {
    const { account, Wrapper } = setup(true);
    account.listLoginSessions.mockResolvedValue({
      ...devices(true),
      requiresReauthentication: true,
    });
    account.revokeLoginSessions.mockRejectedValueOnce(error('INTERNAL_ERROR'));
    render(<LoginSessionsPanel />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByTestId('account-login-session-select-device-b'));
    await userEvent.click(screen.getByRole('button', { name: /释放所选/ }));
    const password = screen.getByLabelText('释放前重新验证密码');
    await userEvent.type(password, 'synthetic-first');
    await userEvent.click(screen.getByRole('button', { name: '确认释放' }));
    await screen.findByRole('alert');
    expect(password).toHaveProperty('value', '');
    await userEvent.type(password, 'synthetic-second');
    await userEvent.click(screen.getByRole('button', { name: '确认释放' }));
    await waitFor(() => expect(account.revokeLoginSessions).toHaveBeenCalledTimes(2));
    const [first, second] = account.revokeLoginSessions.mock.calls.map(([input]) => input);
    expect(second?.operationId).toBe(first?.operationId);
    expect(second?.selected).toEqual(first?.selected);
    expect(second?.password).toBe('synthetic-second');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('protects this device and requires explicit selection plus confirmation for another', async () => {
    const { account, Wrapper } = setup(true);
    render(<LoginSessionsPanel />, { wrapper: Wrapper });
    await screen.findByTestId('account-login-session-select-device-a');
    expect(screen.getByTestId('account-login-session-select-device-a')).toHaveProperty(
      'disabled',
      true,
    );
    await userEvent.click(screen.getByTestId('account-login-session-select-device-b'));
    await userEvent.click(screen.getByRole('button', { name: /释放所选/ }));
    expect(account.revokeLoginSessions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认释放' }));
    await waitFor(() => expect(account.revokeLoginSessions).toHaveBeenCalledTimes(1));
    expect(account.revokeLoginSessions.mock.calls[0]?.[0].selected).toEqual([
      { sessionRef: 'device-b', version: 1 },
    ]);
  });
});
