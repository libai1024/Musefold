import { describe, expect, it } from 'vitest';
import { canKeepLocalSyncConflict, type SyncEntityType } from '../sync';
import { promptDocumentSchema, promptFolderSchema, promptTagSchema } from '../prompt';

function snapshot(entityType: SyncEntityType, deletedAt: string | null) {
  const common = {
    id: 'policy-entity',
    version: 2,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    deletedAt,
  };
  if (entityType === 'folder')
    return promptFolderSchema.parse({
      ...common,
      name: 'Folder',
      parentId: null,
      sortOrder: 0,
    });
  if (entityType === 'tag')
    return promptTagSchema.parse({
      ...common,
      name: 'Tag',
      group: null,
      color: null,
    });
  return promptDocumentSchema.parse({
    ...common,
    title: 'Prompt',
    content: 'Retained content',
    description: null,
    negative: null,
    folderId: null,
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    tags: [],
  });
}

describe('sync conflict resolution policy', () => {
  it.each<SyncEntityType>(['folder', 'tag', 'prompt'])(
    'allows local edits of a live %s',
    (entityType) => {
      expect(
        canKeepLocalSyncConflict({ entityType, remoteSnapshot: snapshot(entityType, null) }),
      ).toBe(true);
    },
  );

  it.each<SyncEntityType>(['folder', 'tag'])(
    'rejects resurrection of a permanently deleted %s',
    (entityType) => {
      expect(
        canKeepLocalSyncConflict({
          entityType,
          remoteSnapshot: snapshot(entityType, '2026-09-13T00:00:00.000Z'),
        }),
      ).toBe(false);
    },
  );

  it('preserves Prompt soft-delete restore', () => {
    expect(
      canKeepLocalSyncConflict({
        entityType: 'prompt',
        remoteSnapshot: snapshot('prompt', '2026-09-13T00:00:00.000Z'),
      }),
    ).toBe(true);
  });
});
