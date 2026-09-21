import type { GenerationJob, WorkbenchSession } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionJobs, useSessionList } from '../hooks';

afterEach(() => vi.useRealTimers());

it('bounds simultaneous sidebar and timeline reads over the upstream three-minute window and stops at terminal', async () => {
  vi.useFakeTimers();
  let active = true;
  const listSessions = vi.fn(async () => ({
    items: [
      { id: 'session', latestJobStatus: active ? 'running' : 'succeeded' } as WorkbenchSession,
    ],
    nextCursor: null,
  }));
  const list = vi.fn(async () => ({
    items: [
      {
        id: 'original',
        status: active ? 'running' : 'succeeded',
        createdAt: '2026-09-21T00:00:00Z',
      } as GenerationJob,
    ],
    nextCursor: null,
  }));
  const gateway = {
    workbench: { listSessions },
    generation: { list },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  const view = renderHook(
    () => {
      useSessionList();
      useSessionList(); // Mobile picker and sidebar share one query, not two pollers.
      useSessionJobs('session');
    },
    { wrapper },
  );
  for (let i = 0; i < 180; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(35);
  expect(listSessions.mock.calls.length).toBeLessThanOrEqual(37);
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(59);
  expect(list.mock.calls.length).toBeLessThanOrEqual(61);
  active = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  const counts = [listSessions.mock.calls.length, list.mock.calls.length];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000);
  });
  expect([listSessions.mock.calls.length, list.mock.calls.length]).toEqual(counts);
  view.unmount();
  client.clear();
});
