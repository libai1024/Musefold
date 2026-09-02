import { describe, expect, it, vi } from 'vitest';
import { DesignSchemeExecutionRegistry } from '../execution-registry';

function registerWithController(
  registry: DesignSchemeExecutionRegistry,
  executionId: string,
  senderId = 11,
  kind: 'create' | 'modify' | 'run' = 'create',
) {
  const abortController = new AbortController();
  const outcome = registry.register({ executionId, senderId, kind, abortController });
  expect(outcome.status).toBe('registered');
  return abortController;
}

describe('DesignSchemeExecutionRegistry', () => {
  it('rejects a duplicate active execution id without replacing the original owner or controls', () => {
    const registry = new DesignSchemeExecutionRegistry({ clock: () => 100 });
    const first = new AbortController();
    const replacement = new AbortController();

    expect(
      registry.register({
        executionId: 'exec_duplicate',
        senderId: 11,
        kind: 'create',
        abortController: first,
      }),
    ).toEqual({
      status: 'registered',
      execution: {
        executionId: 'exec_duplicate',
        senderId: 11,
        kind: 'create',
        activeJobIds: [],
        registeredAt: 100,
      },
    });
    expect(
      registry.register({
        executionId: 'exec_duplicate',
        senderId: 12,
        kind: 'run',
        abortController: replacement,
      }),
    ).toEqual({ status: 'duplicate-active', executionId: 'exec_duplicate' });

    expect(registry.cancel(11, 'exec_duplicate')).toEqual({
      status: 'cancelled',
      executionId: 'exec_duplicate',
    });
    expect(first.signal.aborted).toBe(true);
    expect(replacement.signal.aborted).toBe(false);
  });

  it('isolates get, confirm, and cancel by trusted sender id', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const confirm = vi.fn();
    const cancel = vi.fn();
    registry.register({
      executionId: 'exec_private',
      senderId: 21,
      kind: 'create',
      cancel,
      confirm,
    });

    expect(registry.get(22, 'exec_private')).toEqual({
      status: 'not-found',
      executionId: 'exec_private',
    });
    expect(registry.confirm(22, 'exec_private', 'install')).toEqual({
      status: 'not-found',
      executionId: 'exec_private',
    });
    expect(registry.cancel(22, 'exec_private')).toEqual({
      status: 'not-found',
      executionId: 'exec_private',
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();

    expect(registry.confirm(21, 'exec_private', 'install')).toEqual({
      status: 'accepted',
      executionId: 'exec_private',
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(true);
    expect(registry.get(21, 'exec_private').status).toBe('active');
  });

  it('cancels an active execution exactly once and then reports already-terminal', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const abortController = new AbortController();
    const cancel = vi.fn();
    registry.register({
      executionId: 'exec_cancel',
      senderId: 31,
      kind: 'modify',
      abortController,
      cancel,
    });

    expect(registry.cancel(31, 'exec_cancel')).toEqual({
      status: 'cancelled',
      executionId: 'exec_cancel',
    });
    expect(abortController.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(registry.cancel(31, 'exec_cancel')).toEqual({
      status: 'already-terminal',
      executionId: 'exec_cancel',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(registry.get(31, 'exec_cancel')).toMatchObject({
      status: 'already-terminal',
      execution: { terminalStatus: 'cancelled', kind: 'modify', senderId: 31 },
    });
    expect(registry.get(32, 'exec_cancel')).toEqual({
      status: 'not-found',
      executionId: 'exec_cancel',
    });
  });

  it('propagates an outer abort through all cancellation controls and detaches on completion', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const outer = new AbortController();
    const local = new AbortController();
    const cancel = vi.fn();
    const cancelJob = vi.fn();
    registry.register({
      executionId: 'exec_outer',
      senderId: 36,
      kind: 'run',
      outerSignal: outer.signal,
      abortController: local,
      cancel,
      activeJobIds: ['job_outer'],
      cancelJob,
    });

    outer.abort();

    expect(local.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancelJob).toHaveBeenCalledOnce();
    expect(cancelJob).toHaveBeenCalledWith('job_outer');
    expect(registry.cancel(36, 'exec_outer').status).toBe('already-terminal');

    const completedOuter = new AbortController();
    const completedCancel = vi.fn();
    registry.register({
      executionId: 'exec_completed_outer',
      senderId: 36,
      kind: 'modify',
      outerSignal: completedOuter.signal,
      cancel: completedCancel,
    });
    registry.markTerminal(36, 'exec_completed_outer');
    completedOuter.abort();
    expect(completedCancel).not.toHaveBeenCalled();
  });

  it('marks natural completion as a terminal tombstone without invoking cancellation', () => {
    const registry = new DesignSchemeExecutionRegistry({ clock: () => 250 });
    const cancel = vi.fn();
    registry.register({ executionId: 'exec_done', senderId: 41, kind: 'run', cancel });

    expect(registry.markTerminal(41, 'exec_done', 'completed')).toEqual({
      status: 'marked-terminal',
      executionId: 'exec_done',
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(registry.markTerminal(41, 'exec_done', 'failed')).toEqual({
      status: 'already-terminal',
      executionId: 'exec_done',
    });
    expect(registry.confirm(41, 'exec_done', 'install')).toEqual({
      status: 'already-terminal',
      executionId: 'exec_done',
    });
    expect(
      registry.register({
        executionId: 'exec_done',
        senderId: 41,
        kind: 'run',
        cancel,
      }),
    ).toEqual({ status: 'already-terminal', executionId: 'exec_done' });
  });

  it('treats a rejected confirmation as an idempotent cancellation', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const abortController = new AbortController();
    const confirm = vi.fn();
    registry.register({
      executionId: 'exec_reject',
      senderId: 51,
      kind: 'create',
      abortController,
      confirm,
    });

    expect(registry.confirm(51, 'exec_reject', 'cancel')).toEqual({
      status: 'cancelled',
      executionId: 'exec_reject',
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(false);
    expect(abortController.signal.aborted).toBe(true);
    expect(registry.confirm(51, 'exec_reject', 'cancel')).toEqual({
      status: 'already-terminal',
      executionId: 'exec_reject',
    });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('cleanupOwner cancels only executions belonging to that sender', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const ownerCancelA = vi.fn();
    const ownerCancelB = vi.fn();
    const otherCancel = vi.fn();
    registry.register({
      executionId: 'exec_owner_a',
      senderId: 61,
      kind: 'create',
      cancel: ownerCancelA,
    });
    registry.register({
      executionId: 'exec_owner_b',
      senderId: 61,
      kind: 'modify',
      cancel: ownerCancelB,
    });
    registry.register({
      executionId: 'exec_other',
      senderId: 62,
      kind: 'run',
      cancel: otherCancel,
    });

    expect(registry.cleanupOwner(61)).toEqual({
      cancelledExecutionIds: ['exec_owner_a', 'exec_owner_b'],
    });
    expect(ownerCancelA).toHaveBeenCalledOnce();
    expect(ownerCancelB).toHaveBeenCalledOnce();
    expect(otherCancel).not.toHaveBeenCalled();
    expect(registry.get(61, 'exec_owner_a').status).toBe('not-found');
    expect(registry.get(62, 'exec_other').status).toBe('active');
  });

  it('cleanupAll cancels every active execution and is idempotent', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register({ executionId: 'exec_all_a', senderId: 71, kind: 'create', cancel: first });
    registry.register({ executionId: 'exec_all_b', senderId: 72, kind: 'run', cancel: second });

    expect(registry.cleanupAll()).toEqual({
      cancelledExecutionIds: ['exec_all_a', 'exec_all_b'],
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(registry.get(71, 'exec_all_a').status).toBe('not-found');
    expect(registry.cleanupAll()).toEqual({ cancelledExecutionIds: [] });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('waits for registered execution completion after cancellation', async () => {
    const registry = new DesignSchemeExecutionRegistry();
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const abortController = new AbortController();
    registry.register({
      executionId: 'exec_drain',
      senderId: 101,
      kind: 'run',
      abortController,
      completion,
    });

    registry.cleanupAll();
    let settled = false;
    const draining = registry.waitForCompletions().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveCompletion();
    await draining;
    expect(settled).toBe(true);
  });
  it('expires tombstones by injected-clock TTL and evicts oldest entries by capacity', () => {
    let now = 0;
    const registry = new DesignSchemeExecutionRegistry({
      clock: () => now,
      tombstoneTtlMs: 100,
      maxTombstones: 2,
    });

    registerWithController(registry, 'exec_oldest', 81);
    registry.markTerminal(81, 'exec_oldest');
    now = 10;
    registerWithController(registry, 'exec_middle', 81);
    registry.markTerminal(81, 'exec_middle');
    now = 20;
    registerWithController(registry, 'exec_newest', 81);
    registry.markTerminal(81, 'exec_newest');

    expect(registry.get(81, 'exec_oldest')).toEqual({
      status: 'not-found',
      executionId: 'exec_oldest',
    });
    expect(registry.get(81, 'exec_middle').status).toBe('already-terminal');
    expect(registry.get(81, 'exec_newest').status).toBe('already-terminal');

    now = 110;
    expect(registry.get(81, 'exec_middle')).toEqual({
      status: 'not-found',
      executionId: 'exec_middle',
    });
    expect(registry.get(81, 'exec_newest').status).toBe('already-terminal');
    now = 120;
    expect(registry.get(81, 'exec_newest')).toEqual({
      status: 'not-found',
      executionId: 'exec_newest',
    });
  });

  it('updates active job ids and invokes the job cancellation callback once per active id', () => {
    const registry = new DesignSchemeExecutionRegistry();
    const cancelJob = vi.fn();
    registry.register({
      executionId: 'exec_jobs',
      senderId: 91,
      kind: 'run',
      cancel: vi.fn(),
      activeJobIds: ['job_old'],
      cancelJob,
    });

    expect(registry.setActiveJobIds(92, 'exec_jobs', ['job_stolen'])).toEqual({
      status: 'not-found',
      executionId: 'exec_jobs',
    });
    expect(registry.setActiveJobIds(91, 'exec_jobs', ['job_a', 'job_b', 'job_a'])).toMatchObject({
      status: 'updated',
      execution: { activeJobIds: ['job_a', 'job_b'] },
    });
    registry.cancel(91, 'exec_jobs');

    expect(cancelJob).toHaveBeenCalledTimes(2);
    expect(cancelJob).toHaveBeenNthCalledWith(1, 'job_a');
    expect(cancelJob).toHaveBeenNthCalledWith(2, 'job_b');
    registry.cancel(91, 'exec_jobs');
    expect(cancelJob).toHaveBeenCalledTimes(2);
  });
});
