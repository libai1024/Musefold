import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  prompts,
  promptTags,
  promptTagLinks,
  promptUsageEvents,
  syncChangeLog,
  user,
  type MusefoldDatabase,
  type MusefoldTransaction,
} from '@musefold/db';
import { and, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PromptService } from '../../modules/prompts/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}
function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason) => ({ status: 'rejected' as const, reason }),
  );
}

describeDb(
  'prompt restore versus permanent deletion: real PG transactions and sync records',
  () => {
    let container: StartedPostgreSqlContainer;
    let db: MusefoldDatabase;
    let pool: pg.Pool;
    let service: PromptService;
    let owner: string;
    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      ({ db, pool } = createDatabase(container.getConnectionUri(), { max: 8 }));
      await migrateDatabase(db);
      service = new PromptService(db);
    }, 180_000);
    beforeEach(async () => {
      owner = randomUUID();
      await db
        .insert(user)
        .values({ id: owner, name: 'Purge fixture', email: `${owner}@example.test` });
    });
    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    });
    async function fixture(deleted = true, userId = owner) {
      const id = randomUUID(),
        tag = randomUUID();
      await db.insert(prompts).values({
        id,
        userId,
        title: 'Preserved prompt',
        content: 'synthetic retained text',
        deletedAt: deleted ? new Date('2026-08-01T00:00:00Z') : null,
      });
      await db.insert(promptTags).values({ id: tag, userId, name: `tag-${tag}` });
      await db.insert(promptTagLinks).values({ promptId: id, tagId: tag });
      await db
        .insert(promptUsageEvents)
        .values({ userId, promptId: id, eventId: randomUUID(), action: 'copy' });
      return id;
    }
    async function blockedBy(pid: number) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await pool.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (result.rows[0].n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('No real PG transaction blocked on the owned row lock');
    }
    async function lock(tx: MusefoldTransaction, id: string) {
      await tx.select({ id: prompts.id }).from(prompts).where(eq(prompts.id, id)).for('update');
      return (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
    }
    async function log(id: string) {
      return db
        .select({ operation: syncChangeLog.operation, version: syncChangeLog.version })
        .from(syncChangeLog)
        .where(and(eq(syncChangeLog.entityId, id), eq(syncChangeLog.userId, owner)))
        .orderBy(syncChangeLog.seq);
    }
    async function state(id: string) {
      return {
        rows: await db.select().from(prompts).where(eq(prompts.id, id)),
        tags: await db.select().from(promptTagLinks).where(eq(promptTagLinks.promptId, id)),
        usage: await db.select().from(promptUsageEvents).where(eq(promptUsageEvents.promptId, id)),
        log: await log(id),
      };
    }
    function purge(kind: 'single' | 'empty', id: string, tx?: MusefoldTransaction) {
      const context = tx ? { tx } : undefined;
      return kind === 'single'
        ? service.purgePrompt(owner, id, context)
        : service.emptyTrash(owner, context);
    }

    it.each(['single', 'empty'] as const)(
      '%s purge cannot delete or publish a tombstone for a committed restore',
      async (kind) => {
        const id = await fixture();
        const before = await state(id);
        const ready = barrier<number>();
        const release = barrier<void>();
        const restore = observe(
          db.transaction(async (tx) => {
            ready.resolve(await lock(tx, id));
            await release.promise;
            return service.restorePrompt(owner, id, undefined, { tx });
          }),
        );
        let pending: ReturnType<typeof observe<unknown>> | undefined;
        try {
          const pid = await ready.promise;
          pending = observe<undefined | { purged: number }>(purge(kind, id));
          await blockedBy(pid);
          release.resolve();
          expect((await restore).status).toBe('fulfilled');
          const outcome = await pending;
          const after = await state(id);
          console.info(
            'PROMPT_PURGE_RACE',
            JSON.stringify({
              kind,
              order: 'restore-first',
              outcome: outcome.status,
              rows: after.rows.length,
              logs: after.log,
            }),
          );
          if (kind === 'single')
            expect(outcome).toMatchObject({
              status: 'rejected',
              reason: { code: 'VALIDATION_FAILED' },
            });
          else expect(outcome).toEqual({ status: 'fulfilled', value: { purged: 0 } });
          expect(after.rows).toMatchObject([
            { id, deletedAt: null, version: 2, content: 'synthetic retained text' },
          ]);
          expect(after.tags).toEqual(before.tags);
          expect(after.usage).toEqual(before.usage);
          expect(after.log).toEqual([{ operation: 'upsert', version: 2 }]);
        } finally {
          release.resolve();
          await restore;
          await pending;
        }
      },
      15000,
    );

    it('empty trash only deletes its selected rows when another prompt enters trash concurrently', async () => {
      const selected = await fixture();
      const late = await fixture(false);
      const ready = barrier<number>();
      const release = barrier<void>();
      const deletion = observe(
        db.transaction(async (tx) => {
          // Block the snapshot join after candidate selection, before the DELETE statement.
          await tx.execute(sql`LOCK TABLE prompt_tags IN ACCESS EXCLUSIVE MODE`);
          ready.resolve(
            (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid,
          );
          await release.promise;
          return service.deletePrompt(owner, late, undefined, { tx });
        }),
      );
      let pending: ReturnType<typeof observe<unknown>> | undefined;
      try {
        const pid = await ready.promise;
        pending = observe(service.emptyTrash(owner));
        await blockedBy(pid);
        release.resolve();
        expect((await deletion).status).toBe('fulfilled');
        expect(await pending).toEqual({ status: 'fulfilled', value: { purged: 1 } });
        expect((await state(selected)).rows).toEqual([]);
        const later = await state(late);
        expect(later.rows).toHaveLength(1);
        expect(later.rows[0].deletedAt).not.toBeNull();
        expect(later.log).toEqual([{ operation: 'delete', version: 2 }]);
        expect(later.tags).toHaveLength(1);
        expect(await service.emptyTrash(owner)).toEqual({ purged: 1 });
        expect(await service.emptyTrash(owner)).toEqual({ purged: 0 });
      } finally {
        release.resolve();
        await deletion;
        await pending;
      }
    }, 15000);

    it.each(['single', 'empty'] as const)(
      '%s purge committed first makes a late restore fail without a false upsert',
      async (kind) => {
        const id = await fixture();
        const ready = barrier<number>();
        const release = barrier<void>();
        const deletion = observe(
          db.transaction(async (tx) => {
            const pid = await lock(tx, id);
            await purge(kind, id, tx);
            ready.resolve(pid);
            await release.promise;
          }),
        );
        let pending: ReturnType<typeof observe<unknown>> | undefined;
        try {
          const pid = await ready.promise;
          pending = observe(service.restorePrompt(owner, id, undefined));
          await blockedBy(pid);
          release.resolve();
          expect((await deletion).status).toBe('fulfilled');
          expect(await pending).toMatchObject({
            status: 'rejected',
            reason: { code: 'PROMPT_NOT_FOUND', status: 404 },
          });
          const after = await state(id);
          expect(after.rows).toEqual([]);
          expect(after.tags).toEqual([]);
          expect(after.log).toEqual([{ operation: 'delete', version: 2 }]);
          expect(after.usage).toHaveLength(1); // Existing explicit-purge audit retention policy.
        } finally {
          release.resolve();
          await deletion;
          await pending;
        }
      },
      15000,
    );

    it('purge and repeated empty trash preserve the other owner and reject a live prompt', async () => {
      const other = randomUUID();
      await db
        .insert(user)
        .values({ id: other, name: 'Other fixture', email: `${other}@example.test` });
      const foreign = await fixture(true, other);
      const live = await fixture(false);
      const before = await state(foreign);
      await expect(service.purgePrompt(owner, foreign)).rejects.toMatchObject({ status: 404 });
      await expect(service.purgePrompt(owner, live)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await service.emptyTrash(owner)).toEqual({ purged: 0 });
      expect(await service.emptyTrash(owner)).toEqual({ purged: 0 });
      expect(await state(foreign)).toEqual(before);
      expect((await state(live)).rows).toHaveLength(1);
    });
  },
);
