import type { WorkbenchSession } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchSessionUrlSync } from '../session-url-sync';
import { useActiveSession } from '@musefold/features/workbench';

function session(id: string, title: string): WorkbenchSession {
  const timestamp = '2026-08-29T00:00:00.000Z';
  return {
    id,
    title,
    draft: {
      prompt: '',
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    },
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    deletedAt: null,
    latestJobStatus: null,
    latestJobFinishedAt: null,
  };
}

describe('WorkbenchSessionUrlSync', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/workbench?session=deep-session&view=compact#composer');
    useActiveSession.setState({
      activeSessionId: null,
      draftSession: false,
      pendingDraft: null,
      seenAt: {},
      unreadMarks: {},
    });
  });

  it('validates a deep-linked session with getSession when it is outside the first list page', async () => {
    const firstPageSession = session('first-page-session', '第一页会话');
    const deepLinkedSession = session('deep-session', '深链会话');
    const getSession = vi.fn(async (id: string) => {
      if (id === deepLinkedSession.id) return deepLinkedSession;
      throw new Error('WORKBENCH_SESSION_NOT_FOUND');
    });
    const gateway = {
      workbench: {
        listSessions: vi.fn(async () => ({ items: [firstPageSession], nextCursor: 'next-page' })),
        getSession,
      },
    } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Providers({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
            {children}
          </PlatformProvider>
        </QueryClientProvider>
      );
    }

    render(
      <WorkbenchSessionUrlSync>
        <p data-testid="workbench-ready">ready</p>
      </WorkbenchSessionUrlSync>,
      { wrapper: Providers },
    );

    await waitFor(() => expect(screen.getByTestId('workbench-ready')).toBeTruthy());
    expect(getSession).toHaveBeenCalledWith(deepLinkedSession.id);
    expect(useActiveSession.getState().activeSessionId).toBe(deepLinkedSession.id);
    expect(window.location.search).toBe('?session=deep-session&view=compact');
    expect(
      queryClient
        .getQueryData<{ items: WorkbenchSession[] }>(['workbench', 'sessions', { limit: 50 }])
        ?.items.map((item) => item.id),
    ).toContain(deepLinkedSession.id);
  });
});
