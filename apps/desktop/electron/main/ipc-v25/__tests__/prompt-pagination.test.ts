import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  promptListQuerySchema,
  type PromptListQuery,
  type PromptPage,
  type PromptFolder,
  type PromptTag,
} from '@musefold/contracts';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb } from '@musefold/core/db';
import { ensureAccountWorkspace } from '@musefold/core/db/workspaces';
import { DesktopSyncRepository } from '@musefold/core/sync';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';
import { buildPromptsDomainMethods } from '../prompts-domain';

vi.mock('../sync-domain', () => ({ scheduleV25CloudSync: vi.fn() }));
let directory: string;
let workspace: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-prompt-pagination-'));
  configureTestCoreRuntime(directory);
  const db = getDb();
  workspace = ensureAccountWorkspace(db, 'pagination-owner');
  new DesktopSyncRepository(db).activateAccount({
    ownerId: 'pagination-owner',
    username: 'Synthetic',
    deviceId: 'owned-device',
    deviceName: 'Fixture',
    platform: 'macos',
    clientVersion: 'test',
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

type Query = PromptListQuery & { deletedOnly?: boolean };
async function list(query: Query) {
  return (await buildPromptsDomainMethods()['prompts.list'].handle(
    promptListQuerySchema.parse(query),
  )) as PromptPage;
}
async function walk(query: Query) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = await list({ ...query, cursor });
    expect(page.items.length).toBeLessThanOrEqual(Number(query.limit ?? 100));
    ids.push(...page.items.map((p) => p.id));
    if (!page.nextCursor) return ids;
    expect(page.items.length).toBeGreaterThan(0);
    cursor = page.nextCursor;
  }
  throw new Error('Pagination did not terminate');
}
function seed(count: number, deleted = false) {
  const db = getDb();
  return db.transaction(() => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = promptsRepo.create(
        { title: `Needle ${String(i).padStart(4, '0')}`, content: 'Synthetic searchable body' },
        workspace,
      );
      if (deleted) promptsRepo.softDelete(p.id, workspace);
      db.prepare('UPDATE prompts SET created_at=?,updated_at=? WHERE workspace_id=? AND id=?').run(
        i + 1,
        i + 1,
        workspace,
        p.id,
      );
      ids.push(p.id);
    }
    return ids;
  })();
}

describe('actual Desktop gateway prompt paging and trash filters', () => {
  it.each([undefined, 'Needle'])(
    'reads all1001 active/search rows with query=%s in bounded pages',
    async (q) => {
      const ids = seed(1001);
      const read = vi.spyOn(promptsRepo, 'list');
      const actual = await walk({ q, limit: 100 });
      expect(actual).toHaveLength(1001);
      expect(new Set(actual)).toEqual(new Set(ids));
      expect(read.mock.results.every((r) => r.type === 'return' && r.value.length <= 101)).toBe(
        true,
      );
    },
  );
  it('reads all501 deleted rows without mixing live or other-workspace data', async () => {
    const ids = seed(501, true);
    seed(5);
    const foreign = ensureAccountWorkspace(getDb(), 'other-owner');
    getDb()
      .prepare(
        'INSERT INTO prompts (workspace_id,id,title,content,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(foreign, ids[0], 'Foreign needle', 'Foreign', 1, 1, 1);
    const actual = await walk({ deletedOnly: true, includeDeleted: true, limit: 70 });
    expect(actual).toEqual([...ids].reverse());
    expect((await list({ deletedOnly: true, includeDeleted: false, limit: 1 })).items[0].id).toBe(
      ids[500],
    );
  });
  it('applies the same search/folder/AND-tag/pin filters to live and trashed rows', async () => {
    const methods = buildPromptsDomainMethods();
    const folder = (await methods['prompts.createFolder'].handle({
      name: 'Owned folder',
      parentId: null,
      sortOrder: 0,
    })) as PromptFolder;
    const tags = (await Promise.all(
      ['A', 'B'].map((name) =>
        methods['prompts.createTag'].handle({ name, group: null, color: null }),
      ),
    )) as PromptTag[];
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const row = promptsRepo.create(
        {
          title: 'Needle',
          content: 'Synthetic',
          folderId: i < 5 ? folder.id : undefined,
          tagIds: tags.slice(0, i === 3 ? 1 : 2).map((t) => t.id),
          isPinned: i !== 2,
        },
        workspace,
      );
      if (i % 2 === 0 || i === 3 || i === 5) promptsRepo.softDelete(row.id, workspace);
      getDb()
        .prepare('UPDATE prompts SET updated_at=? WHERE workspace_id=? AND id=?')
        .run(i + 1, workspace, row.id);
      ids.push(row.id);
    }
    const query = {
      q: 'Needle',
      folderId: folder.id,
      tagIds: tags.map((t) => t.id),
      pinnedOnly: true,
      includeDeleted: true,
      limit: 1,
    };
    expect(await walk(query)).toEqual([ids[4], ids[1], ids[0]]);
    expect(await walk({ ...query, deletedOnly: true })).toEqual([ids[4], ids[0]]);
    expect(await walk({ ...query, includeDeleted: false })).toEqual([ids[1]]);
    expect(await walk({ ...query, q: 'no-match' })).toEqual([]);
  });
  it.each(['updated-desc', 'created-desc', 'usage-desc', 'title-asc'] as const)(
    'keeps %s ordering across live/trash page boundaries',
    async (sort) => {
      seed(8, true);
      seed(8);
      const all = await list({ includeDeleted: true, sort, limit: 100 });
      expect(await walk({ includeDeleted: true, sort, limit: 3 })).toEqual(
        all.items.map((p) => p.id),
      );
      const state = all.items.map((p) => Boolean(p.deletedAt));
      // Identical sort keys should interleave by their stable secondary ID, not append all trash.
      expect(state.slice(0, 8)).toContain(true);
      expect(state.slice(0, 8)).toContain(false);
    },
  );
  it.each(['-1', '1junk', '1.5', '9007199254740992'])(
    'rejects invalid offset %s instead of silently resetting',
    async (cursor) => {
      await expect(list({ cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});
