import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { promptListQuerySchema, type ParsedPromptListQuery } from '@musefold/contracts';
import {
  createDatabase,
  migrateDatabase,
  prompts,
  user,
  type MusefoldDatabase,
} from '@musefold/db';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PromptService } from '../../modules/prompts/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const sorts = ['updated-desc', 'created-desc', 'usage-desc', 'title-asc'] as const;
const titles = ['İ', 'i', 'I', 'Alpha', 'alpha', 'Ω', 'Σ', 'σ', 'ς', '中文'];

describeDb('prompt pagination preserves database ordering and complete cursor boundaries', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let service: PromptService;
  let owner: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    await migrateDatabase(db);
    service = new PromptService(db);
  }, 180_000);
  beforeEach(async () => {
    owner = randomUUID();
    await db
      .insert(user)
      .values({ id: owner, name: 'Pagination fixture', email: `${owner}@example.test` });
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function seed(precision = false, pinned = true) {
    const ids: string[] = [];
    for (let i = 0; i < titles.length; i++) {
      const id = `${owner}-${String(i).padStart(2, '0')}`;
      ids.push(id);
      await db.insert(prompts).values({
        id,
        userId: owner,
        title: titles[i],
        content: 'Synthetic pagination',
        isPinned: pinned && i < 3,
        usageCount: i % 3,
      });
      const timestamp = precision
        ? `2026-09-01T00:00:00.000${String((i % 3) + 1)}00Z`
        : `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`;
      await db.execute(
        sql`UPDATE prompts SET created_at=${timestamp}::timestamptz, updated_at=${timestamp}::timestamptz WHERE id=${id}`,
      );
    }
    return ids;
  }
  async function expected(sort: ParsedPromptListQuery['sort']) {
    const order =
      sort === 'created-desc'
        ? sql`created_at DESC, id DESC`
        : sort === 'usage-desc'
          ? sql`usage_count DESC, updated_at DESC, id DESC`
          : sort === 'title-asc'
            ? sql`lower(title) ASC, id ASC`
            : sql`is_pinned DESC, updated_at DESC, id DESC`;
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM prompts WHERE user_id=${owner} AND deleted_at IS NULL ORDER BY ${order}`,
    );
    return rows.rows.map((row) => row.id);
  }
  async function walk(sort: ParsedPromptListQuery['sort'], limit: number, start?: string) {
    const seen: string[] = [];
    const cursors = new Set<string>();
    let cursor = start;
    for (let i = 0; i < 30; i++) {
      const page = await service.listPrompts(
        owner,
        promptListQuerySchema.parse({ sort, limit, cursor }),
      );
      expect(page.items.length).toBeLessThanOrEqual(limit);
      seen.push(...page.items.map((p) => p.id));
      if (!page.nextCursor) return seen;
      expect(page.items).not.toHaveLength(0);
      expect(cursors.has(page.nextCursor)).toBe(false);
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error('Pagination did not terminate');
  }
  for (const sort of sorts) {
    it.each([1, 2, 4])(
      `${sort} preserves pinned boundaries, same-value IDs and Unicode at page size %i`,
      async (limit) => {
        await seed();
        const order = await expected(sort);
        expect(await walk(sort, limit)).toEqual(order);
      },
    );
    it(`${sort} does not lose rows differing only in PostgreSQL microseconds`, async () => {
      await seed(true, false);
      expect(await walk(sort, 1)).toEqual(await expected(sort));
    });
    it(`${sort} continues from its boundary after the anchor is deleted`, async () => {
      await seed(true);
      const order = await expected(sort);
      const first = await service.listPrompts(
        owner,
        promptListQuerySchema.parse({ sort, limit: 2 }),
      );
      expect(first.items.map((p) => p.id)).toEqual(order.slice(0, 2));
      expect(first.nextCursor).toBeTruthy();
      await db.delete(prompts).where(eq(prompts.id, first.items[1].id));
      expect(await walk(sort, 2, first.nextCursor ?? undefined)).toEqual(order.slice(2));
    });
  }

  it('preserves owner, search, pinned and deletion filters on every page', async () => {
    const ids = await seed();
    await db.update(prompts).set({ deletedAt: new Date() }).where(eq(prompts.id, ids[1]));
    const foreign = randomUUID();
    await db
      .insert(user)
      .values({ id: foreign, name: 'Foreign', email: `${foreign}@example.test` });
    await db.insert(prompts).values({
      id: randomUUID(),
      userId: foreign,
      title: 'İ',
      content: 'Synthetic pagination',
      isPinned: true,
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await service.listPrompts(
        owner,
        promptListQuerySchema.parse({ q: 'Synthetic', pinnedOnly: true, limit: 1, cursor }),
      );
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual([ids[2], ids[0]]);
  });

  it.each(['version', 'sort', 'id', 'value', 'updatedAt', 'isPinned'])(
    'rejects an incomplete issued cursor missing %s',
    async (field) => {
      await seed();
      const first = await service.listPrompts(owner, promptListQuerySchema.parse({ limit: 1 }));
      const parsed = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'));
      delete parsed[field];
      const cursor = Buffer.from(JSON.stringify(parsed)).toString('base64url');
      await expect(
        service.listPrompts(owner, promptListQuerySchema.parse({ cursor })),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it('retains folder and AND-tag filtering, including deleted rows, on every page', async () => {
    const ids = await seed();
    const folder = await service.createFolder(owner, {
      name: 'Synthetic folder',
      parentId: null,
      sortOrder: 0,
    });
    const tags = await Promise.all(
      ['A', 'B'].map((name) => service.createTag(owner, { name, group: null, color: null })),
    );
    for (const index of [3, 4, 5, 6]) {
      await service.updatePrompt(owner, ids[index], {
        expectedVersion: 1,
        folderId: folder.id,
        tagIds: tags.slice(0, index === 3 ? 1 : 2).map((tag) => tag.id),
      });
    }
    await service.deletePrompt(owner, ids[5], 2);
    for (const includeDeleted of [false, true]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await service.listPrompts(
          owner,
          promptListQuerySchema.parse({
            folderId: folder.id,
            tagIds: tags.map((tag) => tag.id),
            includeDeleted,
            sort: 'created-desc',
            limit: 1,
            cursor,
          }),
        );
        seen.push(...page.items.map((p) => p.id));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(seen).toEqual((includeDeleted ? [6, 5, 4] : [6, 4]).map((index) => ids[index]));
    }
  });

  it.each([false, true])(
    'deletedOnly wins with includeDeleted=%s and paginates only trash',
    async (includeDeleted) => {
      const ids = await seed();
      const foreign = randomUUID();
      await db
        .insert(user)
        .values({ id: foreign, name: 'Foreign trash', email: `${foreign}@example.test` });
      await db.insert(prompts).values({
        id: randomUUID(),
        userId: foreign,
        title: 'Foreign trash',
        content: 'Foreign',
        deletedAt: new Date(),
      });
      await service.deletePrompt(owner, ids[2], 1);
      await service.deletePrompt(owner, ids[5], 1);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await service.listPrompts(
          owner,
          promptListQuerySchema.parse({
            deletedOnly: true,
            includeDeleted,
            sort: 'created-desc',
            limit: 1,
            cursor,
          }),
        );
        expect(page.items.every((row) => row.deletedAt !== null)).toBe(true);
        seen.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(seen).toEqual([ids[5], ids[2]]);
    },
  );

  it('rejects a cursor used with a different sort as a validation error', async () => {
    await seed();
    const first = await service.listPrompts(owner, promptListQuerySchema.parse({ limit: 1 }));
    await expect(
      service.listPrompts(
        owner,
        promptListQuerySchema.parse({ sort: 'created-desc', cursor: first.nextCursor }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each([
    ['not-json', 'not-json'],
    ['missing-fields', Buffer.from('{}').toString('base64url')],
    [
      'legacy',
      Buffer.from(
        JSON.stringify({
          value: '2026-09-01T00:00:00.000Z',
          id: 'old',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }),
      ).toString('base64url'),
    ],
  ])('rejects %s cursor clearly without a SQL error', async (_name, cursor) => {
    await expect(
      service.listPrompts(owner, promptListQuerySchema.parse({ cursor })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each([
    ['updated-desc', 'value', '2026-02-30T00:00:00.000000Z'],
    ['created-desc', 'value', 'not-a-date'],
    ['usage-desc', 'value', 'NaN'],
    ['usage-desc', 'value', '2147483648'],
    ['usage-desc', 'updatedAt', 'bad-time'],
    ['updated-desc', 'isPinned', 'true'],
    ['title-asc', 'value', 'nul\0value'],
    ['updated-desc', 'id', 'nul\0id'],
    ['created-desc', 'value', '0000-01-01T00:00:00.000000Z'],
    ['usage-desc', 'updatedAt', '0000-01-01T00:00:00.000000Z'],
  ] as const)('validates %s cursor field %s=%s before querying', async (sort, field, invalid) => {
    await seed();
    const first = await service.listPrompts(owner, promptListQuerySchema.parse({ sort, limit: 1 }));
    const parsed = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'));
    parsed[field] = invalid;
    const cursor = Buffer.from(JSON.stringify(parsed)).toString('base64url');
    await expect(
      service.listPrompts(owner, promptListQuerySchema.parse({ sort, cursor })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
