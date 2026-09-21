import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { workbenchSessionPageSchema } from '@musefold/contracts';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb } from '@musefold/core/db';

const directory = mkdtempSync(join(tmpdir(), 'musefold-session-query-'));
vi.mock('electron', () => ({
  app: { getPath: () => directory, getVersion: () => 'test' },
  dialog: {},
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@musefold/core/services/generation', () => ({
  generate: vi.fn(),
  cancelGeneration: vi.fn(),
}));
import { buildWorkbenchDomainMethods } from '../workbench-domain';

configureTestCoreRuntime(directory);
let methods: ReturnType<typeof buildWorkbenchDomainMethods>;
const now = Date.parse('2026-09-13T04:00:00Z');
beforeEach(() => {
  getDb().exec('DELETE FROM workbench_sessions');
  methods = buildWorkbenchDomainMethods();
});
afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});
function seed(id: string, updatedAt = now, archived = false, deleted = false) {
  getDb()
    .prepare(`INSERT INTO workbench_sessions(id,title,created_at,updated_at,archived_at,deleted_at)
    VALUES (?,?,?, ?,?,?)`)
    .run(id, id, now - 1000, updatedAt, archived ? now : null, deleted ? now : null);
}
async function call(name: string, value: unknown) {
  const method = methods[`workbench.${name}`];
  if (!method) throw new Error(`Missing method ${name}`);
  return method.handle(method.input.parse(value));
}
const list = async (query: unknown = {}) =>
  workbenchSessionPageSchema.parse(await call('listSessions', query));

describe('actual Session query IPC over initialized core SQLite', () => {
  it('uses a stable boundary after deleting the first page and inserting a newer Session', async () => {
    for (const id of ['a', 'b', 'c']) seed(id);
    const first = await list({ limit: 1 });
    await call('removeSession', 'c');
    seed('newer', now + 1);
    const second = await list({ limit: 1, cursor: first.nextCursor });
    const third = await list({ limit: 1, cursor: second.nextCursor });
    expect(first.items.map((item) => item.id)).toEqual(['c']);
    expect([...second.items, ...third.items].map((item) => item.id)).toEqual(['b', 'a']);
    expect(third.nextCursor).toBeNull();
    expect((await list({ limit: 1 })).items[0]?.id).toBe('newer');
  });

  it('does not omit a surviving middle row when the first page disappears', async () => {
    for (const [index, id] of ['a', 'b', 'c'].entries()) seed(id, now + index);
    const first = await list({ limit: 1 });
    await call('removeSession', 'c');
    const second = await list({ limit: 1, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(['b']);
  });

  it('orders equal timestamps by UTF-8 bytes and visits every page once', async () => {
    const ids = ['a', 'Z', 'é', 'é', '中', '😀', 'z'];
    for (const id of ids) seed(id);
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 2, ...(cursor ? { cursor } : {}) });
      found.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      expect(found.length).toBeLessThanOrEqual(ids.length);
    } while (cursor);
    expect(found).toEqual([...ids].sort((a, b) => Buffer.compare(Buffer.from(b), Buffer.from(a))));
  });

  it.each([
    [{}, ['active']],
    [{ includeArchived: true }, ['archived', 'active']],
    [{ includeDeleted: true }, ['trash', 'active']],
    [
      { includeArchived: true, includeDeleted: true },
      ['trash-archived', 'trash', 'archived', 'active'],
    ],
    [{ archivedOnly: true, includeDeleted: true }, ['archived']],
    [{ deletedOnly: true }, ['trash-archived', 'trash']],
    [{ deletedOnly: true, archivedOnly: true }, ['trash-archived', 'trash']],
  ])('filters before taking a page: %j', async (query, ids) => {
    seed('active');
    seed('archived', now, true);
    seed('trash', now, false, true);
    seed('trash-archived', now, true, true);
    expect((await list(query)).items.map((item) => item.id)).toEqual(ids);
  });

  it.each(['0', '1', '1junk', '-1', 'not-a-cursor', Buffer.from('{}').toString('base64url')])(
    'rejects malformed and legacy offset cursor: %s',
    async (cursor) => {
      await expect(list({ cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it('rejects changed filters but accepts an equivalent archived query', async () => {
    seed('a', now, true);
    seed('b', now, true);
    const first = await list({ archivedOnly: true, limit: 1 });
    await expect(list({ cursor: first.nextCursor, limit: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(
      (
        await list({
          cursor: first.nextCursor,
          limit: 1,
          archivedOnly: true,
          includeArchived: true,
          includeDeleted: true,
        })
      ).items.map((item) => item.id),
    ).toEqual(['a']);
  });
});
