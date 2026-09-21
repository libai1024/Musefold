import type { WorkbenchSession, WorkbenchSessionListQuery } from '@musefold/contracts';
import {
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePurgeSession } from '../../workbench/session-trash-hooks';
import { useActiveSession } from '../../workbench/session-store';
import { SessionTrashPanel } from '../SessionTrashPanel';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const date = '2026-09-13T00:00:00.000Z';
function session(id: string, archived = false): WorkbenchSession {
  return {
    id,
    title: `对话 ${id}`,
    draft: {
      prompt: '保留的草稿',
      negative: '',
      params: {},
      promptReferenceIds: [],
      promptReferenceSelections: [],
    },
    version: 7,
    createdAt: date,
    updatedAt: date,
    deletedAt: date,
    archivedAt: archived ? date : null,
    latestJobStatus: null,
    latestJobFinishedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<MusefoldGateway['workbench']> = {}) {
  let rows = [session('one'), session('archived', true)];
  const workbench: MusefoldGateway['workbench'] = {
    listSessions: vi.fn(async (_query: WorkbenchSessionListQuery) => ({
      items: rows,
      nextCursor: null,
    })),
    getSession: vi.fn(),
    createSession: vi.fn(),
    updateSession: vi.fn(),
    removeSession: vi.fn(),
    restoreSession: vi.fn(async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error('会话不存在');
      rows = rows.filter((r) => r.id !== id);
      return { ...row, deletedAt: null };
    }),
    purgeSession: vi.fn(async (id: string) => {
      rows = rows.filter((r) => r.id !== id);
      return { purged: 1 };
    }),
    emptyTrash: vi.fn(async () => {
      const purged = rows.length;
      rows = [];
      return { purged };
    }),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  const gateway = { workbench } as MusefoldGateway;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  return { workbench, client, wrapper };
}

async function open() {
  fireEvent.click(screen.getByTestId('session-trash-toggle'));
  await screen.findByTestId('session-trash-row-one');
}

beforeEach(() => {
  vi.clearAllMocks();
  useActiveSession.setState({
    activeSessionId: null,
    draftSession: false,
    pendingDraft: null,
    draftParamOverrides: {},
  });
});

describe('shared Session trash', () => {
  it('queries only on expansion and requests deletedOnly instead of filtering a live page', async () => {
    const { workbench, wrapper } = setup();
    render(<SessionTrashPanel />, { wrapper });
    expect(workbench.listSessions).not.toHaveBeenCalled();
    await open();
    expect(workbench.listSessions).toHaveBeenCalledWith({
      deletedOnly: true,
      limit: 20,
      cursor: undefined,
    });
    expect(screen.getByTestId('session-trash-row-archived').textContent).toContain('已归档');
    expect(screen.getByTestId('session-trash-count').textContent).toBe('2');
  });

  it('shows pending, first-page failure/retry and an empty result without a destructive action', async () => {
    const read = deferred<{ items: WorkbenchSession[]; nextCursor: null }>();
    const listSessions = vi
      .fn()
      .mockReturnValueOnce(read.promise)
      .mockResolvedValue({ items: [], nextCursor: null });
    render(<SessionTrashPanel />, { wrapper: setup({ listSessions }).wrapper });
    fireEvent.click(screen.getByTestId('session-trash-toggle'));
    expect(screen.getByTestId('session-trash-loading')).toBeTruthy();
    await act(async () => read.reject(new Error('offline')));
    fireEvent.click(await screen.findByTestId('session-trash-retry'));
    await screen.findByTestId('session-trash-empty');
    expect(screen.queryByTestId('session-trash-empty-all')).toBeNull();
  });

  it('keeps loaded rows on later-page failure, retries the cursor and deduplicates overlap', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce({ items: [session('one')], nextCursor: 'next-page' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [session('one'), session('two')], nextCursor: null });
    render(<SessionTrashPanel />, { wrapper: setup({ listSessions }).wrapper });
    await open();
    expect(screen.getByTestId('session-trash-count').textContent).toBe('1+');
    fireEvent.click(screen.getByTestId('session-trash-load-more'));
    const retry = await screen.findByTestId('session-trash-retry');
    expect(screen.getByTestId('session-trash-row-one')).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByTestId('session-trash-row-two');
    expect(screen.getAllByTestId('session-trash-row-one')).toHaveLength(1);
    expect(listSessions.mock.calls[2][0].cursor).toBe('next-page');
    expect(screen.getByTestId('session-trash-count').textContent).toBe('2');
  });

  it('restores archived placement without unarchiving or navigating away from another draft', async () => {
    const { workbench, wrapper } = setup();
    useActiveSession.getState().setActiveSessionId('other');
    render(<SessionTrashPanel />, { wrapper });
    await open();
    fireEvent.click(screen.getByTestId('session-trash-restore-archived'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('对话已恢复到已归档对话'));
    expect(workbench.restoreSession).toHaveBeenCalledWith('archived');
    expect(workbench.updateSession).not.toHaveBeenCalled();
    expect(useActiveSession.getState().activeSessionId).toBe('other');
    await waitFor(() => expect(screen.queryByTestId('session-trash-row-archived')).toBeNull());
  });

  it('keeps a failed restore visible and permits explicit retry', async () => {
    const restoreSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('restore offline'))
      .mockResolvedValue({ ...session('one'), deletedAt: null });
    render(<SessionTrashPanel />, { wrapper: setup({ restoreSession }).wrapper });
    await open();
    fireEvent.click(screen.getByTestId('session-trash-restore-one'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('restore offline'));
    const button = screen.getByTestId('session-trash-restore-one');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('对话已恢复到对话列表'));
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('cancels with Escape, returns focus and makes no cleanup call', async () => {
    const user = userEvent.setup();
    const { workbench, wrapper } = setup();
    render(<SessionTrashPanel />, { wrapper });
    await open();
    const trigger = screen.getByTestId('session-trash-purge-one');
    await user.click(trigger);
    expect(screen.getByRole('alertdialog').textContent).toContain('会话和草稿无法恢复');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(workbench.purgeSession).not.toHaveBeenCalled();
  });

  it('locks pending cleanup, keeps failure confirmation and retries the same id', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ purged: number }>();
    const purgeSession = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ purged: 0 });
    render(<SessionTrashPanel />, { wrapper: setup({ purgeSession }).wrapper });
    await open();
    fireEvent.click(screen.getByTestId('session-trash-purge-one'));
    fireEvent.click(screen.getByTestId('session-trash-confirm'));
    await waitFor(() =>
      expect((screen.getByTestId('session-trash-confirm') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('session-trash-confirm'));
    expect(purgeSession).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error('已恢复，不能永久删除')));
    expect(await screen.findByText('已恢复，不能永久删除')).toBeTruthy();
    fireEvent.click(screen.getByTestId('session-trash-confirm'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(purgeSession.mock.calls).toEqual([['one'], ['one']]);
    expect(toast.success).toHaveBeenCalledWith('没有需要永久删除的对话');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('session-trash-toggle')),
    );
  });

  it('empties all server pages once, reports actual count and invalidates linked generation data', async () => {
    const emptyTrash = vi.fn().mockResolvedValue({ purged: 501 });
    const { client, workbench, wrapper } = setup({
      emptyTrash,
      listSessions: vi.fn().mockResolvedValue({ items: [session('one')], nextCursor: 'unloaded' }),
    });
    const generationKey = queryKeys.generation.list({});
    client.setQueryData(generationKey, { items: [] });
    render(<SessionTrashPanel />, { wrapper });
    await open();
    fireEvent.click(screen.getByTestId('session-trash-empty-all'));
    expect(screen.getByRole('alertdialog').textContent).toContain('包括尚未加载的会话');
    fireEvent.click(screen.getByTestId('session-trash-confirm'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已永久删除 501 条对话'));
    expect(emptyTrash).toHaveBeenCalledTimes(1);
    expect(workbench.purgeSession).not.toHaveBeenCalled();
    expect(client.getQueryState(generationKey)?.isInvalidated).toBe(true);
  });
});

describe('permanently removed stale selection', () => {
  it('preserves the current pointer on failure and starts an empty draft only after success', async () => {
    const purgeSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ purged: 1 });
    const { wrapper } = setup({ purgeSession });
    useActiveSession.getState().setActiveSessionId('one');
    const { result } = renderHook(() => usePurgeSession(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync('one')).rejects.toThrow('offline');
    });
    expect(useActiveSession.getState().activeSessionId).toBe('one');
    expect(useActiveSession.getState().draftSession).toBe(false);
    await act(async () => {
      await result.current.mutateAsync('one');
    });
    expect(useActiveSession.getState().activeSessionId).toBeNull();
    expect(useActiveSession.getState().draftSession).toBe(true);
  });

  it('does not navigate away from a different session selected while removal was in flight', async () => {
    const pending = deferred<{ purged: number }>();
    const { wrapper } = setup({ purgeSession: vi.fn(() => pending.promise) });
    useActiveSession.getState().setActiveSessionId('one');
    const { result } = renderHook(() => usePurgeSession(), { wrapper });
    let mutation!: Promise<{ purged: number }>;
    act(() => {
      mutation = result.current.mutateAsync('one');
    });
    useActiveSession.getState().setActiveSessionId('other');
    await act(async () => {
      pending.resolve({ purged: 1 });
      await mutation;
    });
    expect(useActiveSession.getState().activeSessionId).toBe('other');
    expect(useActiveSession.getState().draftSession).toBe(false);
  });
});
