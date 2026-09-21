import type { AccountSummary, GenerationJob, RedeemResult } from '@musefold/contracts';
import {
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeQuotaRecovery,
  peekQuotaRecovery,
  rememberQuotaRecovery,
  resetQuotaRecovery,
} from '../../history/spend-recovery-store';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { useRetryAction } from '../../workbench/use-retry-action';
import { AccountPanel } from '../AccountPanel';
import { beginAccountTransition } from '../account-session';
import { useRedeem } from '../hooks';

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@musefold/ui/components/sonner', () => ({ toast: notices }));
const account: AccountSummary = {
  id: 'owner-a',
  username: 'owner-a',
  displayName: null,
  quota: 0,
  quotaUnit: '点',
  canGenerate: false,
};
const credited: RedeemResult = {
  account: { ...account, quota: 500000, canGenerate: true },
  creditedQuota: 500000,
};
const child = { id: 'child-job' } as GenerationJob;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(networkRetry = false) {
  const redemption = deferred<RedeemResult>();
  const generation = deferred<GenerationJob>();
  const redeem = vi.fn(() => redemption.promise);
  const retry = vi.fn(() => generation.promise);
  const create = vi.fn(() => generation.promise);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: networkRetry ? 1 : false, retryDelay: 0 },
    },
  });
  client.setQueryData(queryKeys.account.status(), account);
  const gateway = {
    account: { getStatus: async () => credited.account, redeem },
    generation: { retry, create },
  } as unknown as MusefoldGateway;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  return { redemption, generation, redeem, retry, create, client, Wrapper };
}
beforeEach(() => {
  resetQuotaRecovery();
  notices.success.mockReset();
  notices.error.mockReset();
  useScreenIntent.setState({ intent: null });
});

describe('redemption and generation recovery are independent outcomes', () => {
  it('shows an accepted failed child as failed instead of pretending that generation is pending', async () => {
    const f = fixture();
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'original' });
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('CODE'));
    await act(async () => f.redemption.resolve(credited));
    await waitFor(() => expect(f.retry).toHaveBeenCalledOnce());
    await act(async () =>
      f.generation.resolve({
        ...child,
        status: 'failed',
        error: { code: 'INTERNAL_ERROR', message: '上游失败' },
      }),
    );
    await waitFor(() =>
      expect(h.result.current.recovery).toMatchObject({ status: 'failed', jobId: child.id }),
    );
    expect(h.result.current.recovery?.message).toContain('上游失败');
    expect(h.result.current.isSuccess).toBe(true);
    expect(notices.success).toHaveBeenCalledTimes(1);
  });
  it('credits immediately, exposes a failed retry separately, and navigates to the original job', async () => {
    const f = fixture();
    const openHistory = vi.fn();
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'original' });
    render(<AccountPanel onOpenHistory={openHistory} />, { wrapper: f.Wrapper });
    fireEvent.change(await screen.findByTestId('account-redeem-input'), {
      target: { value: 'CODE' },
    });
    fireEvent.click(screen.getByTestId('account-redeem-submit'));
    await act(async () => f.redemption.resolve(credited));
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(1));
    expect(notices.success).toHaveBeenCalledWith('兑换成功,到账 10 积分');
    expect(screen.getByTestId('account-points').textContent).toBe('10 积分');
    expect(screen.getByTestId('account-redeem-recovery').getAttribute('data-status')).toBe(
      'pending',
    );
    await act(async () => f.generation.reject(new Error('原任务费用未知，请核对')));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('额度已到账，但生成未恢复'),
    );
    expect(notices.error).toHaveBeenCalledTimes(1);
    expect(notices.success.mock.calls.flat().join()).not.toContain('正在重试');
    fireEvent.click(screen.getByTestId('account-redeem-history'));
    expect(openHistory).toHaveBeenCalledOnce();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'history-select',
      jobId: 'original',
    });
    expect(f.redeem).toHaveBeenCalledTimes(1);
  });

  it.each(['manual-first', 'redemption-first'] as const)(
    'joins one unfinished retry across entrypoints (%s)',
    async (order) => {
      const f = fixture();
      rememberQuotaRecovery({ kind: 'retry-job', jobId: 'original' });
      const h = renderHook(() => ({ redeem: useRedeem(), manual: useRetryAction() }), {
        wrapper: f.Wrapper,
      });
      act(() => h.result.current.redeem.mutate('CODE'));
      await waitFor(() => expect(f.redeem).toHaveBeenCalledOnce());
      if (order === 'manual-first') {
        act(() => {
          void h.result.current.manual.request({ id: 'original' });
        });
        await waitFor(() => expect(f.retry).toHaveBeenCalledOnce());
      }
      await act(async () => f.redemption.resolve(credited));
      await waitFor(() => expect(h.result.current.redeem.recovery?.status).toBe('pending'));
      act(() => {
        void h.result.current.manual.request({ id: 'original' });
      });
      await waitFor(() => expect(h.result.current.manual.isPending('original')).toBe(true));
      expect(f.retry).toHaveBeenCalledTimes(1);
      await act(async () => f.generation.resolve(child));
      await waitFor(() =>
        expect(h.result.current.redeem.recovery).toMatchObject({
          status: 'submitted',
          jobId: child.id,
        }),
      );
      expect(f.retry).toHaveBeenCalledTimes(1);
      expect(notices.error).not.toHaveBeenCalled();
    },
  );

  it('retains the original create input/key through recovery retries and reports failure without re-redeeming', async () => {
    const f = fixture(true);
    const input = { prompt: 'frozen prompt', count: 2 as const, negative: 'no lettering' };
    const intent = [input, 'original-create-key'] as const;
    rememberQuotaRecovery({ kind: 'replay-create', intent });
    f.create.mockRejectedValue(new Error('still unavailable'));
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('CODE'));
    await act(async () => f.redemption.resolve(credited));
    await waitFor(() => expect(h.result.current.recovery?.status).toBe('failed'));
    expect(f.create.mock.calls).toEqual([
      [input, 'original-create-key'],
      [input, 'original-create-key'],
    ]);
    expect(h.result.current.isSuccess).toBe(true);
    expect(f.redeem).toHaveBeenCalledTimes(1);
    expect(notices.success).toHaveBeenCalledTimes(1);
    expect(notices.error).toHaveBeenCalledWith('生成未恢复', { description: 'still unavailable' });
  });

  it.each(['redemption', 'generation'] as const)(
    'suppresses late %s results after an account switch',
    async (point) => {
      const f = fixture();
      rememberQuotaRecovery({ kind: 'retry-job', jobId: 'original' });
      const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
      act(() => h.result.current.mutate('CODE'));
      await waitFor(() => expect(f.redeem).toHaveBeenCalledOnce());
      if (point === 'generation') {
        await act(async () => f.redemption.resolve(credited));
        await waitFor(() => expect(f.retry).toHaveBeenCalledOnce());
        notices.success.mockClear();
      }
      const other = { ...account, id: 'owner-b', username: 'owner-b', quota: 123 };
      act(() => {
        beginAccountTransition(f.client);
        f.client.setQueryData(queryKeys.account.status(), other);
      });
      await act(async () => {
        if (point === 'redemption') f.redemption.resolve(credited);
        else f.generation.reject(new Error('old private failure'));
      });
      await waitFor(() => expect(h.result.current.isPending).toBe(false));
      expect(f.client.getQueryData(queryKeys.account.status())).toEqual(other);
      expect(h.result.current.recovery).toBeNull();
      expect(notices.success).not.toHaveBeenCalled();
      expect(notices.error).not.toHaveBeenCalled();
      expect(f.retry).toHaveBeenCalledTimes(point === 'redemption' ? 0 : 1);
    },
  );

  it('does not consume a newer selected recovery while redemption was pending', async () => {
    const f = fixture();
    rememberQuotaRecovery({ kind: 'retry-job', jobId: 'first' });
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('CODE'));
    await waitFor(() => expect(f.redeem).toHaveBeenCalledOnce());
    const next = { kind: 'retry-job' as const, jobId: 'second' };
    rememberQuotaRecovery(next);
    await act(async () => f.redemption.resolve(credited));
    await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
    expect(f.retry).not.toHaveBeenCalled();
    expect(peekQuotaRecovery()).toBe(next);
    expect(consumeQuotaRecovery(next)?.intent).toBe(next);
  });

  it('keeps the recovery and avoids automatic redemption retries when crediting fails', async () => {
    const f = fixture(true);
    const pending = { kind: 'retry-job' as const, jobId: 'original' };
    rememberQuotaRecovery(pending);
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('CODE'));
    await act(async () => f.redemption.reject(new Error('network unavailable')));
    await waitFor(() => expect(h.result.current.isError).toBe(true));
    expect(f.redeem).toHaveBeenCalledTimes(1);
    expect(f.retry).not.toHaveBeenCalled();
    expect(peekQuotaRecovery()).toBe(pending);
    expect(notices.success).not.toHaveBeenCalled();
  });
});

describe('reference retention during redemption recovery', () => {
  function retainedIntent() {
    const image = {
      id: 'reference-recovery',
      url: 'https://example.test/ref.png',
      name: 'original.png',
      mimeType: 'image/png' as const,
      byteSize: 4,
    };
    const input = { prompt: 'original prompt', count: 1 as const, referenceImages: [image] };
    const intent = [input, 'original-reference-key'] as const;
    let available = true;
    const release = vi.fn(() => {
      available = false;
    });
    const pending = { kind: 'replay-create' as const, intent };
    rememberQuotaRecovery(pending, release);
    return { intent, pending, release, available: () => available };
  }

  it.each(['success', 'failure', 'unmount', 'account-change', 'replacement'] as const)(
    'retains original reference bytes until replay settles (%s)',
    async (exit) => {
      const f = fixture();
      const held = retainedIntent();
      const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
      act(() => h.result.current.mutate('CODE'));
      await waitFor(() => expect(f.redeem).toHaveBeenCalledOnce());
      expect(held.available()).toBe(true);
      await act(async () => f.redemption.resolve(credited));
      await waitFor(() => expect(f.create).toHaveBeenCalledOnce());
      expect(f.create.mock.calls[0]).toEqual(held.intent);
      expect(peekQuotaRecovery()).toBeNull();
      if (exit === 'unmount') h.unmount();
      if (exit === 'account-change')
        act(() => {
          beginAccountTransition(f.client);
        });
      const nextRelease = vi.fn();
      const next = { kind: 'retry-job' as const, jobId: 'new-job' };
      if (exit === 'replacement') rememberQuotaRecovery(next, nextRelease);
      expect(held.available()).toBe(true);
      expect(held.release).not.toHaveBeenCalled();
      await act(async () => {
        if (exit === 'failure' || exit === 'account-change')
          f.generation.reject(new Error('old replay unavailable'));
        else f.generation.resolve(child);
      });
      await waitFor(() => expect(held.available()).toBe(false));
      expect(held.release).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledOnce();
      expect(f.redeem).toHaveBeenCalledOnce();
      if (exit === 'replacement') {
        expect(peekQuotaRecovery()).toBe(next);
        expect(nextRelease).not.toHaveBeenCalled();
        resetQuotaRecovery();
        expect(nextRelease).toHaveBeenCalledOnce();
      }
      if (exit !== 'unmount') h.unmount();
      f.client.clear();
    },
  );

  it.each(['replacement', 'account-change'] as const)(
    'releases unconsumed references when %s happens during crediting',
    async (exit) => {
      const f = fixture();
      const held = retainedIntent();
      const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
      act(() => h.result.current.mutate('CODE'));
      await waitFor(() => expect(f.redeem).toHaveBeenCalledOnce());
      if (exit === 'replacement') rememberQuotaRecovery({ kind: 'retry-job', jobId: 'new-job' });
      else
        act(() => {
          beginAccountTransition(f.client);
        });
      expect(held.available()).toBe(false);
      expect(held.release).toHaveBeenCalledOnce();
      await act(async () => f.redemption.resolve(credited));
      await waitFor(() => expect(h.result.current.isPending).toBe(false));
      expect(f.create).not.toHaveBeenCalled();
      expect(f.retry).not.toHaveBeenCalled();
      expect(held.release).toHaveBeenCalledOnce();
      h.unmount();
      f.client.clear();
    },
  );

  it('retains references after failed crediting so an explicit later redemption can replay them', async () => {
    const f = fixture();
    const held = retainedIntent();
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('BAD-CODE'));
    await act(async () => f.redemption.reject(new Error('crediting unavailable')));
    await waitFor(() => expect(h.result.current.isError).toBe(true));
    expect(held.available()).toBe(true);
    expect(peekQuotaRecovery()).toBe(held.pending);
    f.redeem.mockResolvedValueOnce(credited);
    act(() => h.result.current.mutate('GOOD-CODE'));
    await waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    expect(held.available()).toBe(true);
    expect(f.create.mock.calls[0]).toEqual(held.intent);
    await act(async () => f.generation.resolve(child));
    await waitFor(() => expect(held.release).toHaveBeenCalledOnce());
    expect(f.redeem).toHaveBeenCalledTimes(2);
    h.unmount();
    f.client.clear();
  });

  it('keeps cleanup errors separate from credited quota and never resubmits', async () => {
    const f = fixture(true);
    const held = retainedIntent();
    held.release.mockImplementation(() => {
      throw new Error('cleanup unavailable');
    });
    const h = renderHook(() => useRedeem(), { wrapper: f.Wrapper });
    act(() => h.result.current.mutate('CODE'));
    await act(async () => f.redemption.resolve(credited));
    await waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    await act(async () => f.generation.resolve(child));
    await waitFor(() => expect(held.release).toHaveBeenCalledOnce());
    await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
    expect(h.result.current.recovery?.status).toBe('submitted');
    expect(f.redeem).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledOnce();
    expect(notices.error).not.toHaveBeenCalled();
    h.unmount();
    f.client.clear();
  });
});
