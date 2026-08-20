import { describe, expect, it } from 'vitest';
import type { WorkbenchSession as DesktopWorkbenchSession } from '@musefold/desktop-contracts/workbench';
import {
  EMPTY_WORKBENCH_DRAFT,
  createWorkbenchSessionToEnsureCommand,
  mergeWorkbenchSessionRows,
  paginateWorkbenchRows,
  workbenchSessionRowToDocument,
} from '../mappers/workbench';

function session(
  id: string,
  patch: Partial<DesktopWorkbenchSession> = {},
): DesktopWorkbenchSession {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: 1_000,
    updatedAt: 2_000,
    archivedAt: null,
    deletedAt: null,
    ...patch,
  };
}

describe('workbench session mapping', () => {
  it('emits an empty draft and synthetic version', () => {
    const doc = workbenchSessionRowToDocument(session('s1', { title: '  ' }));
    expect(doc.title).toBe('未命名创作');
    expect(doc.draft).toEqual(EMPTY_WORKBENCH_DRAFT);
    expect(doc.version).toBe(1);
    expect(doc.archivedAt).toBeNull();
  });

  it('drops draft when creating via ensure', () => {
    const command = createWorkbenchSessionToEnsureCommand(
      {
        title: '海报',
        draft: { prompt: 'keep me', negative: '', params: {}, promptReferenceIds: [] },
      },
      'id-1',
    );
    expect(command).toEqual({ id: 'id-1', title: '海报' });
  });

  it('merges active and archived then paginates by updatedAt', () => {
    const merged = mergeWorkbenchSessionRows(
      {
        items: [{ ...session('a', { updatedAt: 10 }), turnCount: 0, runCount: 0, latestAssetPath: null, conversationKind: 'chat', latestStatus: null }],
        total: 1,
        limit: 200,
        offset: 0,
      },
      {
        items: [{ ...session('b', { updatedAt: 20, archivedAt: 15 }), turnCount: 1, runCount: 1, latestAssetPath: null, conversationKind: 'prompt', latestStatus: 'success' }],
        total: 1,
        limit: 200,
        offset: 0,
      },
    );
    expect(merged.map((row) => row.id)).toEqual(['b', 'a']);
    const page = paginateWorkbenchRows(merged, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe('b');
    expect(page.nextCursor).toBe('1');
  });
});
