import type {
  CreateGenerationInput,
  GenerationJob,
  WorkbenchSession,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';
import {
  PlatformProvider,
  queryKeys,
  type MusefoldGateway,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerationMutationIntent,
  createRetryGenerationMutationIntent,
  sessionHasActiveJob,
  useArchivedSessions,
  useCreateGeneration,
  useRemoveSession,
  useRestoreSession,
  useRetryGeneration,
} from '../hooks';

const SESSION: WorkbenchSession = {
  id: 'session-1',
  title: '归档会话',
  draft: {
    prompt: '',
    negative: '',
    params: {},
    promptReferenceSelections: [],
    promptReferenceIds: [],
  },
  version: 7,
  createdAt: '2026-08-29T00:00:00+00:00',
  updatedAt: '2026-08-29T00:00:00+00:00',
  archivedAt: '2026-08-29T00:00:00+00:00',
  deletedAt: null,
  latestJobStatus: null,
  latestJobFinishedAt: null,
};

function createGateway(overrides: Partial<MusefoldGateway['workbench']> = {}) {
  const workbench = {
    listSessions: vi.fn(async (_query: WorkbenchSessionListQuery) => ({
      items: [SESSION],
      nextCursor: null,
    })),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(async () => SESSION),
    removeSession: vi.fn(async () => SESSION),
    restoreSession: vi.fn(),
    ...overrides,
  } as MusefoldGateway['workbench'];
  return { workbench, gateway: { workbench } as unknown as MusefoldGateway };
}

function createWrapper(queryClient: QueryClient, gateway: MusefoldGateway) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generation mutation intents', () => {
  const input: CreateGenerationInput = { prompt: 'rain over neon streets' };
  const job = {} as GenerationJob;

  it('keeps one create key across mutation retry and allocates a new key for a new intent', async () => {
    const randomUUID = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    const create = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(job);
    const gateway = { generation: { create } } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } },
    });
    const firstIntent = createGenerationMutationIntent(input);
    const { result } = renderHook(() => useCreateGeneration(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(() => result.current.mutateAsync(firstIntent));
    const secondIntent = createGenerationMutationIntent(input);

    expect(create.mock.calls).toEqual([
      [input, '00000000-0000-4000-8000-000000000001'],
      [input, '00000000-0000-4000-8000-000000000001'],
    ]);
    expect(secondIntent).toEqual([input, '00000000-0000-4000-8000-000000000002']);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('keeps one retry key across mutation retry and allocates a new key for a new intent', async () => {
    const randomUUID = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
    const retry = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(job);
    const gateway = { generation: { retry } } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } },
    });
    const firstIntent = createRetryGenerationMutationIntent('job-1');
    const { result } = renderHook(() => useRetryGeneration(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(() => result.current.mutateAsync(firstIntent));
    const secondIntent = createRetryGenerationMutationIntent('job-1');

    expect(retry.mock.calls).toEqual([
      ['job-1', '00000000-0000-4000-8000-000000000003'],
      ['job-1', '00000000-0000-4000-8000-000000000003'],
    ]);
    expect(secondIntent).toEqual(['job-1', '00000000-0000-4000-8000-000000000004']);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('create generation invalidates account status with workbench and usage', async () => {
    const create = vi.fn().mockResolvedValue(job);
    const gateway = { generation: { create } } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const accountKey = queryKeys.account.status();
    queryClient.setQueryData(accountKey, { id: 'u1', canGenerate: true, quota: 1 });
    const { result } = renderHook(() => useCreateGeneration(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(() => result.current.mutateAsync(createGenerationMutationIntent(input)));

    expect(queryClient.getQueryState(accountKey)?.isInvalidated).toBe(true);
  });
});

describe('sessionHasActiveJob', () => {
  it('treats pending_approval as an active session job', () => {
    expect(sessionHasActiveJob({ ...SESSION, latestJobStatus: 'pending_approval' })).toBe(true);
    expect(sessionHasActiveJob({ ...SESSION, latestJobStatus: 'queued' })).toBe(true);
    expect(sessionHasActiveJob({ ...SESSION, latestJobStatus: 'succeeded' })).toBe(false);
    expect(sessionHasActiveJob({ ...SESSION, latestJobStatus: null })).toBe(false);
  });
});

describe('workbench session hooks', () => {
  it('uses the archivedOnly gateway filter for archived sessions', async () => {
    const { gateway, workbench } = createGateway();
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useArchivedSessions(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(workbench.listSessions).toHaveBeenCalledWith({
      archivedOnly: true,
      cursor: undefined,
    });
    expect(queryClient.getQueryData(queryKeys.workbench.archived({ archivedOnly: true }))).toEqual({
      pages: [{ items: [SESSION], nextCursor: null }],
      pageParams: [undefined],
    });
  });

  it('restores with expectedVersion and invalidates ordinary and archived lists', async () => {
    const { gateway, workbench } = createGateway();
    const queryClient = createQueryClient();
    const ordinaryKey = queryKeys.workbench.sessions({});
    const archivedKey = queryKeys.workbench.archived({ archivedOnly: true });
    queryClient.setQueryData(ordinaryKey, { items: [], nextCursor: null });
    queryClient.setQueryData(archivedKey, {
      pages: [{ items: [SESSION], nextCursor: null }],
      pageParams: [undefined],
    });
    const { result } = renderHook(() => useRestoreSession(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(() =>
      result.current.mutateAsync({ id: SESSION.id, expectedVersion: SESSION.version }),
    );

    expect(workbench.updateSession).toHaveBeenCalledWith(SESSION.id, {
      expectedVersion: SESSION.version,
      archived: false,
    });
    expect(queryClient.getQueryState(ordinaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
  });

  it('soft-removes by id and invalidates ordinary and archived lists', async () => {
    const { gateway, workbench } = createGateway();
    const queryClient = createQueryClient();
    const ordinaryKey = queryKeys.workbench.sessions({});
    const archivedKey = queryKeys.workbench.sessions({ archivedOnly: true });
    queryClient.setQueryData(ordinaryKey, { items: [SESSION], nextCursor: null });
    queryClient.setQueryData(archivedKey, { items: [SESSION], nextCursor: null });
    const { result } = renderHook(() => useRemoveSession(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(() => result.current.mutateAsync(SESSION.id));

    expect(workbench.removeSession).toHaveBeenCalledWith(SESSION.id);
    expect(queryClient.getQueryState(ordinaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
  });

  it('exposes restore failures through the mutation error', async () => {
    const failure = new Error('版本冲突');
    const { gateway } = createGateway({
      updateSession: vi.fn().mockRejectedValue(failure),
    });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useRestoreSession(), {
      wrapper: createWrapper(queryClient, gateway),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: SESSION.id, expectedVersion: SESSION.version }),
      ).rejects.toBe(failure);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
  });
});
