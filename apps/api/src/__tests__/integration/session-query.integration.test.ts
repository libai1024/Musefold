import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, user, type MusefoldDatabase } from '@musefold/db';
import { workbenchSessionListQuerySchema, workbenchSessionPageSchema } from '@musefold/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchService } from '../../modules/workbench/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const owner = 'session-query-owner';
const stamp = '2026-09-13T04:00:00.999001Z';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describeDb('exact and scoped Session pagination in PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: MusefoldDatabase;
  let service: WorkbenchService;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ pool, db } = createDatabase(container.getConnectionUri(), { max: 4 }));
    await migrateDatabase(db);
    service = new WorkbenchService(db);
  }, 180000);
  beforeEach(async () => {
    await pool.query('DELETE FROM "user"');
    await db.insert(user).values([
      { id: owner, name: 'Session test', email: 'session-owner@example.test' },
      { id: 'other-owner', name: 'Other test', email: 'other-session@example.test' },
    ]);
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
  const seed = async (
    id: string,
    updatedAt = stamp,
    archived = false,
    deleted = false,
    userId = owner,
  ) => {
    await pool.query(
      `INSERT INTO workbench_sessions(id,user_id,title,draft,created_at,updated_at,archived_at,deleted_at)
       VALUES ($1,$2,$1,'{"prompt":"","negative":"","params":{}}','2020-01-01Z',$3,
         CASE WHEN $4 THEN '2026-01-01Z'::timestamptz ELSE NULL END,
         CASE WHEN $5 THEN '2026-02-01Z'::timestamptz ELSE NULL END)`,
      [id, userId, updatedAt, archived, deleted],
    );
  };
  const list = async (query: unknown = {}, userId = owner) =>
    workbenchSessionPageSchema.parse(
      await service.list(userId, workbenchSessionListQuerySchema.parse(query)),
    );

  it('preserves microsecond boundaries without omitting the next row', async () => {
    await seed('older');
    await seed('newer', '2026-09-13T04:00:00.999002Z');
    const first = await list({ limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual(['newer']);
    expect(first.nextCursor).not.toBeNull();
    const second = await list({ limit: 1, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(['older']);
    expect(second.nextCursor).toBeNull();
  });

  it('uses deterministic byte-order IDs at equal timestamps across many pages and isolates owners', async () => {
    const ids = ['a', 'Z', 'é', 'é', '中', '😀', 'z', 'aa', 'Ω'];
    for (const id of ids) await seed(id);
    await seed('foreign', stamp, false, false, 'other-owner');
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 2, ...(cursor ? { cursor } : {}) });
      found.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      expect(found.length).toBeLessThanOrEqual(ids.length);
    } while (cursor);
    expect(found).toEqual([...ids].sort((a, b) => Buffer.compare(Buffer.from(b), Buffer.from(a))));
    expect((await list({}, 'other-owner')).items.map((item) => item.id)).toEqual(['foreign']);
  });

  it('continues after a deleted first-page row without skipping a survivor or pulling in newer rows', async () => {
    for (const id of ['a', 'b', 'c']) await seed(id);
    const first = await list({ limit: 1 });
    await service.remove(owner, 'c', undefined);
    await seed('new-after-first-page', '2026-09-13T04:00:01Z');
    const second = await list({ limit: 1, cursor: first.nextCursor });
    const third = await list({ limit: 1, cursor: second.nextCursor });
    expect([...second.items, ...third.items].map((item) => item.id)).toEqual(['b', 'a']);
    expect(third.nextCursor).toBeNull();
    expect((await list({ limit: 1 })).items[0]?.id).toBe('new-after-first-page');
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
    [
      { deletedOnly: 'true', includeArchived: 'false', includeDeleted: 'false' },
      ['trash-archived', 'trash'],
    ],
  ])('applies Session visibility before pagination: %j', async (query, ids) => {
    await seed('active');
    await seed('archived', stamp, true);
    await seed('trash', stamp, false, true);
    await seed('trash-archived', stamp, true, true);
    expect((await list(query)).items.map((item) => item.id)).toEqual(ids);
  });

  it.each([
    '0',
    '1',
    'not-a-cursor',
    '%%%invalid',
    encode(null),
    encode([]),
    encode({ id: 'a', updatedAt: stamp }),
    encode({ id: 'a', updatedAt: 'not-a-date' }),
    encode({ id: '\0', updatedAt: stamp }),
  ])('rejects invalid or legacy cursor with a stable validation error: %s', async (cursor) => {
    await expect(list({ cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a cursor from another effective filter but permits equivalent archived flags', async () => {
    for (const id of ['a', 'b']) await seed(id, stamp, true);
    const first = await list({ limit: 1, archivedOnly: true });
    await expect(list({ limit: 1, cursor: first.nextCursor })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const second = await list({
      limit: 1,
      cursor: first.nextCursor,
      archivedOnly: true,
      includeArchived: true,
      includeDeleted: true,
    });
    expect(second.items.map((item) => item.id)).toEqual(['a']);
  });
});
