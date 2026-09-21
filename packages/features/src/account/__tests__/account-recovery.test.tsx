import type { AccountSummary, AccountRecoveryReview } from '@musefold/contracts';
import {
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  peekQuotaRecovery,
  rememberQuotaRecovery,
  resetQuotaRecovery,
} from '../../history/spend-recovery-store';
import { AccountPanel } from '../AccountPanel';
import { AccountFooter, MobileQuotaReadout } from '../AccountFooter';
import { useLogin, useLogout, useRedeem, useAccountStatus } from '../hooks';
import { useAccountRecoveryMutation } from '../recovery-hooks';
import { beginAccountTransition, applyAccountSession } from '../account-session';

const ACTIVE = {
  id: 'owner-a',
  username: 'candidate-a',
  displayName: '账号 A',
  quota: 50_000,
  quotaUnit: 'points',
  canGenerate: true,
  identity: {
    apiIssuer: 'https://api.example.test',
    principalId: 'principal-a',
    identityVersion: 1,
    status: 'active',
  },
  recovery: null,
} satisfies AccountSummary;
const RESTRICTED = {
  ...ACTIVE,
  canGenerate: false,
  quota: 0,
  identity: { ...ACTIVE.identity, status: 'recovery_required' },
  recovery: {
    requestId: 'request-a',
    reason: 'legacy_evidence_missing',
    expiresAt: '2099-01-01T00:00:00.000Z',
    actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
  },
} satisfies AccountSummary;
const REVIEW: AccountRecoveryReview = {
  requestId: 'request-a',
  expiresAt: '2099-01-01T00:00:00.000Z',
  candidate: {
    issuer: 'https://identity.example.test',
    ownerId: 'owner-a',
    username: 'candidate-a',
    displayName: '账号 A',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { resolve, promise };
}

function setup(initial: AccountSummary = RESTRICTED) {
  const state: { current: AccountSummary | null } = { current: initial };
  const account = {
    getStatus: vi.fn(async () => {
      if (!state.current) throw new Error('AUTH_REQUIRED');
      return state.current;
    }),
    login: vi.fn(async () => {
      state.current = ACTIVE;
      return ACTIVE;
    }),
    register: vi.fn(async () => ACTIVE),
    logout: vi.fn(async () => {
      state.current = null;
    }),
    redeem: vi.fn<MusefoldGateway['account']['redeem']>(async () => ({
      account: ACTIVE,
      creditedQuota: 50_000,
    })),
    retryRecovery: vi.fn(async (): Promise<AccountSummary> => RESTRICTED),
    inspectRecovery: vi.fn(async () => REVIEW),
    verifyOriginalSession: vi.fn(async () => ACTIVE),
    createIndependentWorkspace: vi.fn(async () => ({
      ...ACTIVE,
      identity: { ...ACTIVE.identity, principalId: 'independent-a' },
    })),
  } satisfies MusefoldGateway['account'];
  const generation = { create: vi.fn(), retry: vi.fn() };
  const gateway = { account, generation } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.account.status(), initial);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return { state, account, generation, gateway, client, Wrapper };
}

beforeEach(() => {
  resetQuotaRecovery();
});

describe('account recovery controls', () => {
  it('shows the restricted reason and actionable original-device instructions without quota or redeem', () => {
    const { Wrapper } = setup();
    render(
      <>
        <AccountPanel />
        <MobileQuotaReadout />
        <AccountFooter onOpenSettings={vi.fn()} />
      </>,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('account-recovery')).toBeTruthy();
    expect(screen.getByText(/缺少领取旧工作区/)).toBeTruthy();
    expect(screen.getByText(/编号只用于定位申请/)).toBeTruthy();
    expect(screen.queryByTestId('account-redeem-input')).toBeNull();
    expect(screen.queryByTestId('account-points')).toBeNull();
    expect(screen.queryByTestId('mobile-quota')).toBeNull();
    expect(screen.getByTestId('account-footer').textContent).toContain('账号需要恢复');
  });

  it('retries safely and presents a recoverable failure while keeping the request identity', async () => {
    const { Wrapper, account } = setup();
    account.retryRecovery.mockRejectedValueOnce(
      Object.assign(new Error('failed'), { code: 'ACCOUNT_RECOVERY_CONFLICT' }),
    );
    render(<AccountPanel />, { wrapper: Wrapper });
    await userEvent.click(screen.getByTestId('account-recovery-retry'));
    expect((await screen.findByRole('alert')).textContent).toContain('恢复申请与当前账号不匹配');
    expect((screen.getByLabelText('恢复申请编号') as HTMLInputElement).value).toBe('request-a');
    await userEvent.click(screen.getByTestId('account-recovery-retry'));
    await waitFor(() => expect(account.retryRecovery).toHaveBeenCalledTimes(2));
    expect(account.retryRecovery).toHaveBeenLastCalledWith({ requestId: 'request-a' });
  });

  it('requires explicit confirmation before creating a separate workspace and clears old query projections', async () => {
    const { Wrapper, account, client } = setup();
    client.setQueryData(queryKeys.generation.detail('old-job'), { private: 'old history' });
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'old-job' });
    render(<AccountPanel />, { wrapper: Wrapper });
    await userEvent.click(screen.getByTestId('account-recovery-independent'));
    expect(screen.getByRole('alertdialog').textContent).toContain('旧工作区及其历史保持保留');
    expect(account.createIndependentWorkspace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(account.createIndependentWorkspace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('account-recovery-independent'));
    await userEvent.click(screen.getByTestId('account-recovery-independent-confirm'));
    await waitFor(() => expect(screen.queryByTestId('account-recovery')).toBeNull());
    expect(account.createIndependentWorkspace).toHaveBeenCalledExactlyOnceWith({
      requestId: 'request-a',
    });
    expect(client.getQueryData(queryKeys.generation.detail('old-job'))).toBeUndefined();
    expect(peekQuotaRecovery()).toBeNull();
  });

  it('exposes only server-listed actions and disables expired requests', () => {
    const restricted = {
      ...RESTRICTED,
      recovery: {
        ...RESTRICTED.recovery,
        expiresAt: '2000-01-01T00:00:00.000Z',
        actions: ['retry' as const],
      },
    };
    const { Wrapper } = setup(restricted);
    render(<AccountPanel />, { wrapper: Wrapper });
    expect((screen.getByTestId('account-recovery-retry') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('account-recovery-independent')).toBeNull();
    expect(screen.queryByText(/编号只用于定位申请/)).toBeNull();
    expect((screen.getByTestId('account-recovery-refresh') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('inspects before verification and keeps the original device on its own principal', async () => {
    const { Wrapper, account, client } = setup(ACTIVE);
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'original-device-job' });
    render(<AccountPanel />, { wrapper: Wrapper });
    await userEvent.type(screen.getByLabelText('另一台设备的恢复申请编号'), 'request-a');
    expect(screen.queryByTestId('account-original-confirm')).toBeNull();
    await userEvent.click(screen.getByTestId('account-original-inspect'));
    expect(await screen.findByText(/账号服务：https:\/\/identity.example.test/)).toBeTruthy();
    expect(account.verifyOriginalSession).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('account-original-confirm'));
    expect((await screen.findByRole('status')).textContent).toContain('这台设备仍使用原账号');
    expect(account.verifyOriginalSession).toHaveBeenCalledExactlyOnceWith({
      requestId: 'request-a',
    });
    expect(
      client.getQueryData<AccountSummary>(queryKeys.account.status())?.identity?.principalId,
    ).toBe('principal-a');
    expect(peekQuotaRecovery()).toEqual({ kind: 'retry-job', jobId: 'original-device-job' });
  });

  it('does not offer verification after a mismatched or expired review', async () => {
    const { Wrapper, account } = setup(ACTIVE);
    account.inspectRecovery.mockResolvedValueOnce({ ...REVIEW, requestId: 'another-request' });
    render(<AccountPanel />, { wrapper: Wrapper });
    await userEvent.type(screen.getByLabelText('另一台设备的恢复申请编号'), 'request-a');
    await userEvent.click(screen.getByTestId('account-original-inspect'));
    expect((await screen.findByRole('alert')).textContent).toContain('恢复申请不匹配');
    expect(screen.queryByTestId('account-original-confirm')).toBeNull();
    expect(account.verifyOriginalSession).not.toHaveBeenCalled();
  });

  it('removes an inspected candidate when the current identity changes', async () => {
    const { Wrapper, client } = setup(ACTIVE);
    render(<AccountPanel />, { wrapper: Wrapper });
    await userEvent.type(screen.getByLabelText('另一台设备的恢复申请编号'), 'request-a');
    await userEvent.click(screen.getByTestId('account-original-inspect'));
    await screen.findByTestId('account-original-confirm');
    await act(async () => {
      await applyAccountSession(
        client,
        { ...ACTIVE, id: 'owner-b', username: 'candidate-b' },
        beginAccountTransition(client),
      );
    });
    await waitFor(() => expect(screen.queryByTestId('account-original-confirm')).toBeNull());
    expect((screen.getByLabelText('另一台设备的恢复申请编号') as HTMLInputElement).value).toBe('');
  });
});

describe('account session and spend isolation', () => {
  it('rejects recovery redeem at the hook boundary without sending or replaying generation', async () => {
    const { Wrapper, account, generation } = setup();
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'old-job' });
    const { result } = renderHook(() => useRedeem(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync('synthetic-code')).rejects.toThrow('账号恢复');
    });
    expect(account.redeem).not.toHaveBeenCalled();
    expect(generation.retry).not.toHaveBeenCalled();
  });

  it('does not apply a late recovery response after another account has logged in', async () => {
    const { Wrapper, client, account } = setup();
    const pending = deferred<AccountSummary>();
    account.retryRecovery.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(
      () => ({ recovery: useAccountRecoveryMutation('retryRecovery'), login: useLogin() }),
      { wrapper: Wrapper },
    );
    let stale!: Promise<unknown>;
    act(() => {
      stale = result.current.recovery
        .mutateAsync({ requestId: 'request-a' })
        .catch((error: Error) => error);
    });
    await waitFor(() => expect(account.retryRecovery).toHaveBeenCalledTimes(1));
    await act(() =>
      result.current.login.mutateAsync({ username: 'candidate-a', password: 'synthetic' }),
    );
    await act(async () => {
      pending.resolve(RESTRICTED);
      await stale;
    });
    expect(client.getQueryData(queryKeys.account.status())).toEqual(ACTIVE);
    expect(await stale).toBeInstanceOf(Error);
  });

  it('ignores late redemption after logout and clears pending automatic recovery', async () => {
    const { Wrapper, account, generation } = setup(ACTIVE);
    const pending = deferred<{ account: AccountSummary; creditedQuota: number }>();
    account.redeem.mockImplementationOnce(() => pending.promise);
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'old-job' });
    const { result } = renderHook(() => ({ redeem: useRedeem(), logout: useLogout() }), {
      wrapper: Wrapper,
    });
    let redemption!: Promise<unknown>;
    act(() => {
      redemption = result.current.redeem.mutateAsync('synthetic').catch((error: Error) => error);
    });
    await waitFor(() => expect(account.redeem).toHaveBeenCalledTimes(1));
    await act(() => result.current.logout.mutateAsync());
    await act(async () => {
      pending.resolve({ account: ACTIVE, creditedQuota: 1 });
      await redemption;
    });
    expect(peekQuotaRecovery()).toBeNull();
    expect(generation.retry).not.toHaveBeenCalled();
    expect(generation.create).not.toHaveBeenCalled();
  });

  it('drops stale data and recovery intents when a status refresh observes another account', async () => {
    const { Wrapper, client, state } = setup(ACTIVE);
    const { result } = renderHook(() => useAccountStatus(), { wrapper: Wrapper });
    await act(() => result.current.refetch());
    client.setQueryData(queryKeys.generation.detail('old-job'), { owner: 'a' });
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'old-job' });
    state.current = {
      ...ACTIVE,
      id: 'owner-b',
      identity: { ...ACTIVE.identity, principalId: 'principal-b' },
    };
    await act(() => result.current.refetch());
    expect(client.getQueryData(queryKeys.generation.detail('old-job'))).toBeUndefined();
    expect(peekQuotaRecovery()).toBeNull();
  });
});
