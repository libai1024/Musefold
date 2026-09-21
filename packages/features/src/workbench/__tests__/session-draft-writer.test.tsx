import type { WorkbenchDraft, WorkbenchSession } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionDraftWriter } from '../use-session-draft-writer';

const draft = (prompt: string): WorkbenchDraft => ({
  prompt,
  negative: '',
  params: {},
  promptReferenceIds: [],
  promptReferenceSelections: [],
});
const initial: WorkbenchSession = {
  id: 'session-1',
  title: 'Initial',
  draft: draft('base'),
  version: 1,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
  latestJobStatus: null,
  latestJobFinishedAt: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
function setup() {
  let remote = structuredClone(initial);
  const workbench = {
    getSession: vi.fn(async (_id: string) => structuredClone(remote)),
    updateSession: vi.fn(
      async (_id: string, patch: { expectedVersion: number; draft: WorkbenchDraft }) => {
        if (patch.expectedVersion !== remote.version) throw new Error('WORKBENCH_VERSION_CONFLICT');
        remote = { ...remote, version: remote.version + 1, draft: patch.draft };
        return structuredClone(remote);
      },
    ),
  };
  const gateway = { workbench } as unknown as MusefoldGateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(({ id }) => useSessionDraftWriter(id), {
    wrapper,
    initialProps: { id: initial.id },
  });
  act(() => hook.result.current.accept(initial));
  return {
    ...hook,
    workbench,
    remote: () => remote,
    setRemote: (next: WorkbenchSession) => {
      remote = next;
    },
  };
}

describe('draft versions and explicit resolution', () => {
  it('binds debounced input before a reload but allows a metadata-only refresh in the same editor', async () => {
    const h = setup();
    const obsolete = h.result.current.prepareWrite(initial.id, 1, draft('old delayed input'));
    const loaded = { ...initial, version: 2, draft: draft('newly loaded draft') };
    h.setRemote(loaded);
    act(() => h.result.current.accept(loaded));
    await act(async () => {
      await obsolete();
    });
    expect(h.remote()).toEqual(loaded);
    expect(h.workbench.updateSession).not.toHaveBeenCalled();
    const current = h.result.current.prepareWrite(initial.id, 2, draft('new delayed input'));
    const renamed = { ...loaded, title: 'New title', version: 3 };
    h.setRemote(renamed);
    act(() => h.result.current.observe(renamed));
    await act(async () => {
      await current();
    });
    expect(h.remote()).toMatchObject({ version: 4, draft: draft('new delayed input') });
    expect(h.workbench.updateSession).toHaveBeenCalledWith(initial.id, {
      expectedVersion: 3,
      draft: draft('new delayed input'),
    });
  });

  it('ignores an old committed response after loading a newer draft and saves the new edit at its own version', async () => {
    const h = setup();
    const pending = deferred<WorkbenchSession>();
    const committed = { ...initial, version: 2, draft: draft('old committed') };
    h.workbench.updateSession.mockImplementationOnce(async () => {
      h.setRemote(committed);
      return pending.promise;
    });
    let oldWrite!: Promise<void>;
    act(() => {
      oldWrite = h.result.current.write(initial.id, 1, committed.draft);
    });
    await waitFor(() => expect(h.workbench.updateSession).toHaveBeenCalledTimes(1));
    const loaded = { ...initial, version: 3, draft: draft('new remote loaded') };
    h.setRemote(loaded);
    act(() => h.result.current.accept(loaded));
    let currentWrite!: Promise<void>;
    act(() => {
      currentWrite = h.result.current.write(initial.id, loaded.version, draft('new edit'));
    });
    await act(async () => {
      pending.resolve(committed);
      await Promise.all([oldWrite, currentWrite]);
    });
    expect(h.remote()).toMatchObject({ version: 4, draft: draft('new edit') });
    expect(h.workbench.updateSession).toHaveBeenLastCalledWith(initial.id, {
      expectedVersion: 3,
      draft: draft('new edit'),
    });
    expect(h.result.current.issue).toBeUndefined();
  });

  it('does not let an old failed response block an explicitly reloaded editor', async () => {
    const h = setup();
    const pending = deferred<void>();
    h.workbench.updateSession.mockImplementationOnce(async () => {
      await pending.promise;
      throw new Error('old response lost');
    });
    let oldWrite!: Promise<void>;
    act(() => {
      oldWrite = h.result.current.write(initial.id, 1, draft('old edit'));
    });
    await waitFor(() => expect(h.workbench.updateSession).toHaveBeenCalledTimes(1));
    const loaded = { ...initial, version: 2, draft: draft('loaded after uncertain write') };
    h.setRemote(loaded);
    act(() => h.result.current.accept(loaded));
    let currentWrite!: Promise<void>;
    act(() => {
      currentWrite = h.result.current.write(initial.id, 2, draft('new edit'));
    });
    await act(async () => {
      pending.resolve();
      await Promise.allSettled([oldWrite, currentWrite]);
    });
    expect(h.remote()).toMatchObject({ version: 3, draft: draft('new edit') });
    expect(h.workbench.updateSession).toHaveBeenCalledTimes(2);
    expect(h.result.current.issue).toBeUndefined();
  });

  it('keeps consecutive writes in the same editor serialized at their committed versions', async () => {
    const h = setup();
    await act(async () => {
      await Promise.all([
        h.result.current.write(initial.id, 1, draft('first edit')),
        h.result.current.write(initial.id, 1, draft('second edit')),
      ]);
    });
    expect(h.remote()).toMatchObject({ version: 3, draft: draft('second edit') });
    expect(h.workbench.updateSession.mock.calls.map(([, patch]) => patch.expectedVersion)).toEqual([
      1, 2,
    ]);
  });
  it('does not let a reloaded draft authorize an older queued editor write', async () => {
    const h = setup();
    const other = { ...initial, id: 'session-2', draft: draft('other base') };
    const pending = deferred<WorkbenchSession>();
    h.workbench.updateSession.mockReturnValueOnce(pending.promise);
    h.rerender({ id: other.id });
    act(() => h.result.current.accept(other));
    let first!: Promise<void>;
    act(() => {
      first = h.result.current.write(other.id, 1, draft('other saved'));
    });
    await waitFor(() => expect(h.workbench.updateSession).toHaveBeenCalledTimes(1));
    h.rerender({ id: initial.id });
    act(() => h.result.current.accept(initial));
    let queued!: Promise<void>;
    act(() => {
      queued = h.result.current.write(initial.id, 1, draft('old queued input'));
    });
    const latest = { ...initial, version: 2, draft: draft('new remote loaded') };
    h.setRemote(latest);
    h.rerender({ id: other.id });
    h.rerender({ id: initial.id });
    act(() => h.result.current.accept(latest));
    await act(async () => {
      pending.resolve({ ...other, version: 2, draft: draft('other saved') });
      await Promise.allSettled([first, queued]);
    });
    expect(h.remote()).toEqual(latest);
    expect(h.workbench.updateSession).toHaveBeenCalledTimes(1);
  });

  it('advances metadata-only versions but never borrows a changed remote draft version', async () => {
    const h = setup();
    const renamed = { ...initial, title: 'Renamed', version: 2 };
    h.setRemote(renamed);
    act(() => h.result.current.observe(renamed));
    await act(async () => {
      await h.result.current.write(initial.id, 1, draft('local accepted'));
    });
    expect(h.workbench.updateSession).toHaveBeenLastCalledWith(initial.id, {
      expectedVersion: 2,
      draft: draft('local accepted'),
    });
    const remote = { ...h.remote(), version: 4, draft: draft('other writer') };
    h.setRemote(remote);
    act(() => h.result.current.observe(remote));
    await act(async () => {
      await expect(h.result.current.write(initial.id, 4, draft('stale local'))).rejects.toThrow(
        'WORKBENCH_VERSION_CONFLICT',
      );
    });
    expect(h.workbench.updateSession).toHaveBeenLastCalledWith(initial.id, {
      expectedVersion: 3,
      draft: draft('stale local'),
    });
    expect(h.remote().draft.prompt).toBe('other writer');
  });

  it('stops already queued siblings after an ambiguous committed write and requires a reviewed version', async () => {
    const h = setup();
    h.workbench.updateSession.mockImplementationOnce(async (_id, patch) => {
      h.setRemote({ ...initial, version: 2, draft: patch.draft });
      throw new Error('response lost after commit');
    });
    await act(async () => {
      const results = await Promise.allSettled([
        h.result.current.write(initial.id, 1, draft('first committed')),
        h.result.current.write(initial.id, 1, draft('second queued')),
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    });
    expect(h.workbench.updateSession).toHaveBeenCalledTimes(1);
    expect(h.remote().draft.prompt).toBe('first committed');
    await act(async () => {
      await h.result.current.openReview();
    });
    expect(h.result.current.review?.version).toBe(2);
    expect(h.result.current.review?.draft.prompt).toBe('first committed');
    await act(async () => {
      expect(await h.result.current.saveReviewed(draft('second queued'))).toBe(true);
    });
    expect(h.workbench.updateSession).toHaveBeenCalledTimes(2);
    expect(h.remote().version).toBe(3);
    expect(h.remote().draft.prompt).toBe('second queued');
    expect(h.result.current.issue).toBeUndefined();
  });

  it('does not change the displayed confirmation version on another query refresh; retry requires new review', async () => {
    const h = setup();
    h.setRemote({ ...initial, version: 2, draft: draft('remote second') });
    await act(async () => {
      await expect(h.result.current.write(initial.id, 1, draft('mine'))).rejects.toThrow();
    });
    await act(async () => {
      await h.result.current.openReview();
    });
    const latest = { ...h.remote(), version: 3, draft: draft('remote third') };
    h.setRemote(latest);
    act(() => h.result.current.observe(latest));
    await act(async () => {
      expect(await h.result.current.saveReviewed(draft('mine'))).toBe(false);
    });
    expect(h.workbench.updateSession).toHaveBeenLastCalledWith(initial.id, {
      expectedVersion: 2,
      draft: draft('mine'),
    });
    expect(h.result.current.review?.version).toBe(2);
    expect(h.result.current.reviewError).toBe('WORKBENCH_VERSION_CONFLICT');
    expect(h.remote().draft.prompt).toBe('remote third');
    await act(async () => {
      await h.result.current.openReview();
    });
    await act(async () => {
      expect(await h.result.current.saveReviewed(draft('mine'))).toBe(true);
    });
    expect(h.remote().version).toBe(4);
  });

  it('loads the displayed remote draft only on explicit choice and does not write it back', async () => {
    const h = setup();
    h.setRemote({ ...initial, version: 2, draft: draft('remote') });
    await act(async () => {
      await expect(h.result.current.write(initial.id, 1, draft('mine'))).rejects.toThrow();
    });
    await act(async () => {
      await h.result.current.openReview();
    });
    act(() => {
      expect(h.result.current.loadReviewed()?.draft.prompt).toBe('remote');
    });
    expect(h.workbench.updateSession).toHaveBeenCalledTimes(1);
    expect(h.result.current.issue).toBeUndefined();
    await act(async () => {
      await h.result.current.write(initial.id, 1, draft('edit after load'));
    });
    expect(h.workbench.updateSession).toHaveBeenLastCalledWith(initial.id, {
      expectedVersion: 2,
      draft: draft('edit after load'),
    });
  });

  it('discards a late review after switching Sessions and prevents double review/save', async () => {
    const h = setup();
    const pending = deferred<WorkbenchSession>();
    h.workbench.getSession.mockReturnValueOnce(pending.promise);
    let read!: Promise<void>;
    act(() => {
      read = h.result.current.openReview();
    });
    await act(async () => {
      await h.result.current.openReview();
    });
    expect(h.workbench.getSession).toHaveBeenCalledTimes(1);
    h.rerender({ id: 'other-session' });
    await act(async () => {
      pending.resolve(initial);
      await read;
    });
    expect(h.result.current.review).toBeNull();
    await act(async () => {
      expect(await h.result.current.saveReviewed(draft('wrong session'))).toBe(false);
    });
    expect(h.workbench.updateSession).not.toHaveBeenCalled();
    await waitFor(() => expect(h.result.current.busy).toBe(false));
  });

  it.each(['deletedAt', 'archivedAt'] as const)(
    'does not offer editing when the reviewed Session has %s',
    async (field) => {
      const h = setup();
      h.setRemote({ ...initial, [field]: initial.createdAt });
      await act(async () => {
        await h.result.current.openReview();
      });
      expect(h.result.current.review).toBeNull();
      expect(h.result.current.issue).toContain('已删除或归档');
      expect(h.workbench.updateSession).not.toHaveBeenCalled();
    },
  );
});
