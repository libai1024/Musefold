import type { GenerationJob } from '@musefold/contracts';
import { PlatformProvider, type MusefoldGateway, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { beginAccountTransition } from '../../account/account-session';
import { useRetryAction } from '../use-retry-action';
const errors = vi.hoisted(() => vi.fn());
vi.mock('@musefold/ui/components/sonner', () => ({ toast: { error: errors } }));
function deferred() {
  let resolve!: (job: GenerationJob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<GenerationJob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const job = { id: 'source', recovery: { requestId: 'local-request' } } as GenerationJob;
function fixture(retry = vi.fn(), networkRetry = false) {
  errors.mockReset();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: networkRetry ? 1 : false, retryDelay: 0 } },
  });
  const gateway = { generation: { retry } } as unknown as MusefoldGateway;
  const openSettings = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  const hooks = renderHook(
    () => ({ first: useRetryAction(openSettings), second: useRetryAction(openSettings) }),
    { wrapper },
  );
  return { ...hooks, client, retry, openSettings };
}
describe('shared unfinished retry interaction', () => {
  it('coalesces synchronous clicks and two controls, then permits a fresh completed interaction', async () => {
    const pending = deferred();
    const f = fixture(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(job));
    act(() => {
      f.result.current.first.request(job);
      f.result.current.first.request(job);
      f.result.current.second.request(job);
    });
    await waitFor(() => {
      expect(f.retry).toHaveBeenCalledTimes(1);
      expect(f.result.current.first.isPending(job.id)).toBe(true);
      expect(f.result.current.second.isPending(job.id)).toBe(true);
    });
    await act(async () => pending.resolve(job));
    await waitFor(() => expect(f.result.current.second.isPending(job.id)).toBe(false));
    act(() => f.result.current.second.request(job));
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(2));
    expect(f.retry.mock.calls[0][1]).not.toBe(f.retry.mock.calls[1][1]);
    expect(errors).not.toHaveBeenCalled();
  });
  it('retains the first key through automatic network retries and repeated clicks', async () => {
    const pending = deferred();
    const f = fixture(
      vi.fn().mockRejectedValueOnce(new TypeError('network')).mockReturnValueOnce(pending.promise),
      true,
    );
    act(() => f.result.current.first.request(job));
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(2));
    act(() => f.result.current.second.request(job));
    expect(f.retry.mock.calls[0]).toEqual(f.retry.mock.calls[1]);
    await act(async () => pending.resolve(job));
    await waitFor(() => expect(f.result.current.first.isPending(job.id)).toBe(false));
    expect(f.retry).toHaveBeenCalledTimes(2);
  });
  it('reports a failure once with a recovery action, releases admission, and does not reuse its key', async () => {
    const pending = deferred();
    const f = fixture(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(job));
    act(() => {
      f.result.current.first.request(job);
      f.result.current.second.request(job);
    });
    await act(async () => pending.reject(new Error('原任务费用未知，请先核对')));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(errors).toHaveBeenCalledWith(
      '重试未完成',
      expect.objectContaining({
        description: '原任务费用未知，请先核对',
        action: expect.objectContaining({ label: '核对原任务' }),
      }),
    );
    act(() => errors.mock.calls[0][1].action.onClick());
    expect(f.openSettings).toHaveBeenCalledOnce();
    act(() => f.result.current.second.request(job));
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(2));
    expect(f.retry.mock.calls[0][1]).not.toBe(f.retry.mock.calls[1][1]);
  });
  it('allows another source independently and never shares an old account interaction or its late error', async () => {
    const a = deferred();
    const b = deferred();
    const fresh = deferred();
    const f = fixture(
      vi
        .fn()
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise)
        .mockReturnValueOnce(fresh.promise),
    );
    act(() => {
      f.result.current.first.request(job);
      f.result.current.second.request({ ...job, id: 'other' });
    });
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(2));
    act(() => {
      beginAccountTransition(f.client);
      f.result.current.second.request(job);
    });
    await waitFor(() => expect(f.retry).toHaveBeenCalledTimes(3));
    await act(async () => {
      a.reject(new Error('old private message'));
      b.resolve(job);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(f.result.current.second.isPending(job.id)).toBe(true);
    await act(async () => fresh.resolve(job));
    await waitFor(() => expect(f.result.current.second.isPending(job.id)).toBe(false));
  });
});
