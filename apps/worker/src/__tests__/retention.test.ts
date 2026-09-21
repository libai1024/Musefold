import { SOFT_DELETE_RETENTION_MS } from '@musefold/db';
import { describe, expect, it } from 'vitest';
import { collectExpiredSoftDeletedPromptIds } from '../retention.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');

describe('提示词 30 天硬删(内存规则)', () => {
  const expired = {
    id: 'prompt-expired',
    deletedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const recentTrash = {
    id: 'prompt-recent-trash',
    deletedAt: new Date('2026-09-06T00:00:00.000Z'),
  };
  const live = { id: 'prompt-live', deletedAt: null };

  it('过期软删提示词进入 purge,未到期与未软删保留', () => {
    expect(expired.deletedAt.getTime()).toBeLessThanOrEqual(
      NOW.getTime() - SOFT_DELETE_RETENTION_MS,
    );
    expect(recentTrash.deletedAt.getTime()).toBeGreaterThan(
      NOW.getTime() - SOFT_DELETE_RETENTION_MS,
    );

    const store = {
      prompts: [expired, recentTrash, live],
      folders: [{ id: 'folder-keep' }],
      tags: [{ id: 'tag-keep' }],
      links: [{ promptId: expired.id, tagId: 'tag-keep' }],
    };
    const first = collectExpiredSoftDeletedPromptIds(store.prompts, NOW);
    expect(first).toEqual([expired.id]);

    store.prompts = store.prompts.filter((row) => !first.includes(row.id));
    store.links = store.links.filter((row) => !first.includes(row.promptId));

    expect(store.prompts.map((row) => row.id)).toEqual([recentTrash.id, live.id]);
    expect(store.folders).toEqual([{ id: 'folder-keep' }]);
    expect(store.tags).toEqual([{ id: 'tag-keep' }]);
    expect(store.links).toEqual([]);
  });

  it('第二次收集 purged=0', () => {
    const remaining = [recentTrash, live];
    expect(collectExpiredSoftDeletedPromptIds(remaining, NOW)).toEqual([]);
  });
});
