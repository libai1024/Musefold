import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKBENCH_SESSION_LIST_KEY, musefoldQueryKeys } from '@musefold/product-ui';
import {
  DESKTOP_WORKBENCH_ARCHIVED_SESSION_LIST_KEY,
  DESKTOP_WORKBENCH_SESSION_LIST_KEY,
  desktopWorkbenchSessionListQueryKey,
  dropDesktopWorkbenchSession,
  readDesktopWorkbenchSessions,
  replaceDesktopWorkbenchSessions,
  resetDesktopWorkbenchSessionQueriesForTests,
  upsertDesktopWorkbenchSession,
} from '../workbench-session-query';

describe('desktop workbench session Query keys', () => {
  it('keeps the web default { limit: 20 } and uses a separate desktop snapshot', () => {
    expect(DEFAULT_WORKBENCH_SESSION_LIST_KEY).toEqual({ limit: 20 });
    expect(DESKTOP_WORKBENCH_SESSION_LIST_KEY).toEqual({ limit: 200 });
    expect(DESKTOP_WORKBENCH_ARCHIVED_SESSION_LIST_KEY).toEqual({
      limit: 200,
      archived: true,
    });
    expect(desktopWorkbenchSessionListQueryKey(false)).toEqual(
      musefoldQueryKeys.workbench.list(DESKTOP_WORKBENCH_SESSION_LIST_KEY),
    );
    expect(desktopWorkbenchSessionListQueryKey(true)).not.toEqual(
      desktopWorkbenchSessionListQueryKey(false),
    );
  });

  it('upserts active sessions and moves archived ones between caches', () => {
    resetDesktopWorkbenchSessionQueriesForTests();
    const active = {
      id: 's1',
      title: '进行中',
      createdAt: 1,
      updatedAt: 2,
      archivedAt: null,
      deletedAt: null,
      turnCount: 1,
      runCount: 0,
      latestAssetPath: null,
      conversationKind: 'chat' as const,
      latestStatus: 'running' as const,
    };
    upsertDesktopWorkbenchSession(active);
    expect(readDesktopWorkbenchSessions()).toEqual([active]);

    const archived = { ...active, archivedAt: 3, latestStatus: 'success' as const };
    upsertDesktopWorkbenchSession(archived);
    expect(readDesktopWorkbenchSessions()).toEqual([]);
    expect(readDesktopWorkbenchSessions(true)).toEqual([archived]);

    dropDesktopWorkbenchSession('s1');
    expect(readDesktopWorkbenchSessions(true)).toEqual([]);

    replaceDesktopWorkbenchSessions(false, [active]);
    expect(readDesktopWorkbenchSessions()[0]?.id).toBe('s1');
  });
});
