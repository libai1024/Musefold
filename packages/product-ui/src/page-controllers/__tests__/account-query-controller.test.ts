import { describe, expect, it, vi } from 'vitest';
import type { GenerationGateway } from '@musefold/domain';
import {
  accountStatusQueryOptions,
  createAccountRefreshScheduler,
  refreshAccountQuery,
} from '../account-query-controller';
import { createGenerationTerminalObserver } from '../generation-terminal-observer';
import { createMusefoldQueryClient, musefoldQueryKeys } from '../query-client';

const account = {
  id: 'account-1',
  username: 'musefold',
  displayName: null,
  quota: 100_000,
  quotaUnit: '点',
  canGenerate: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const job = (id: string, status: string) =>
  ({ id, status }) as Awaited<ReturnType<GenerationGateway['getGeneration']>>;

describe('account query controller', () => {
  it('shares account status through one query key and supports manual refresh', async () => {
    const getAccount = vi
      .fn()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({
        ...account,
        quota: 80_000,
      });
    const gateway = { getAccount };
    const client = createMusefoldQueryClient();

    await client.fetchQuery(accountStatusQueryOptions(gateway));
    expect(client.getQueryData(musefoldQueryKeys.account.status)).toEqual(account);

    await expect(refreshAccountQuery(client, gateway)).resolves.toMatchObject({ quota: 80_000 });
    expect(getAccount).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(musefoldQueryKeys.account.status)).toMatchObject({ quota: 80_000 });
  });
  it('runs one trailing refresh for distinct terminal jobs received in flight', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const scheduler = createAccountRefreshScheduler(refresh);
    let batch: Promise<void> | null = null;
    const observer = createGenerationTerminalObserver(() => {
      batch = scheduler.schedule();
    });

    observer.observe(job('job-1', 'succeeded'));
    observer.observe(job('job-2', 'failed'));
    expect(refresh).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    second.resolve();
    await batch;
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not trail for duplicate terminal snapshots in flight', async () => {
    const current = deferred<void>();
    const refresh = vi.fn<() => Promise<void>>().mockReturnValue(current.promise);
    const scheduler = createAccountRefreshScheduler(refresh);
    let batch: Promise<void> | null = null;
    const observer = createGenerationTerminalObserver(() => {
      batch = scheduler.schedule();
    });

    observer.observe(job('job-1', 'cancelled'));
    observer.observe(job('job-1', 'cancelled'));
    current.resolve();
    await batch;

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('stops after a failed refresh and allows a later terminal to retry', async () => {
    const error = new Error('refresh failed');
    const onError = vi.fn();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce();
    const scheduler = createAccountRefreshScheduler(refresh, onError);
    const observer = createGenerationTerminalObserver(() => void scheduler.schedule());

    observer.observe(job('job-1', 'succeeded'));
    observer.observe(job('job-2', 'failed'));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(refresh).toHaveBeenCalledTimes(1);

    observer.observe(job('job-3', 'cancelled'));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
});

describe('generation terminal observer', () => {
  it('fires once per job for succeeded, failed, or cancelled snapshots', () => {
    const onTerminal = vi.fn();
    const observer = createGenerationTerminalObserver(onTerminal);

    expect(observer.observe(job('job-1', 'running'))).toBe(false);
    expect(observer.observe(job('job-1', 'succeeded'))).toBe(true);
    expect(observer.observe(job('job-1', 'succeeded'))).toBe(false);
    expect(observer.observe(job('job-2', 'failed'))).toBe(true);
    expect(observer.observe(job('job-3', 'cancelled'))).toBe(true);
    expect(onTerminal).toHaveBeenCalledTimes(3);
  });

  it('evicts terminal ids in FIFO order at the configured memory limit', () => {
    const onTerminal = vi.fn();
    const observer = createGenerationTerminalObserver(onTerminal, 2);

    observer.observe(job('job-1', 'succeeded'));
    observer.observe(job('job-2', 'failed'));
    observer.observe(job('job-3', 'cancelled'));

    expect(observer.observe(job('job-2', 'failed'))).toBe(false);
    expect(observer.observe(job('job-1', 'succeeded'))).toBe(true);
    expect(onTerminal).toHaveBeenCalledTimes(4);
  });

  it('clears a terminal marker when the same id is later non-terminal', () => {
    const onTerminal = vi.fn();
    const observer = createGenerationTerminalObserver(onTerminal);

    expect(observer.observe(job('job-1', 'succeeded'))).toBe(true);
    expect(observer.observe(job('job-1', 'running'))).toBe(false);
    expect(observer.observe(job('job-1', 'succeeded'))).toBe(true);
    expect(onTerminal).toHaveBeenCalledTimes(2);
  });
});
