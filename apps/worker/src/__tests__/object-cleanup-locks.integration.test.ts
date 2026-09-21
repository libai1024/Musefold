import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, enqueueObjectCleanup } from '@musefold/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresObjectCleanupStore } from '../tasks.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const ordinary = 'owned/reference';
const imported = 'scheme-imports/owned/stage/asset';
const now = new Date('2026-09-13T12:00:00Z');
const operations = ['enqueue', 'acknowledge', 'discard', 'mixed-discard', 'defer', 'fail'] as const;

describeDb(
  'object maintenance bounds lock waits and preserves its durable outbox on failure',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let store: PostgresObjectCleanupStore;
    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri(), { max: 1 });
      await migrateDatabase(database.db);
      store = new PostgresObjectCleanupStore(database.db);
    }, 180_000);
    beforeEach(async () => {
      await database.pool.query('TRUNCATE "user",object_cleanup_queue CASCADE');
      await database.pool.query(
        "INSERT INTO \"user\"(id,name,email) VALUES ('owned','Owned','owned@example.test')",
      );
      await database.pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at,cleanup_queued_at)
      VALUES ('reference','owned',$1,'owned.png','image/png',4,'cleanup_pending','2026-01-01Z','2026-01-02Z')`,
        [ordinary],
      );
      await enqueueObjectCleanup(
        database.db,
        [ordinary, imported].map((objectKey) => ({
          objectKey,
          ownerId: 'owned',
          objectType: 'generation_reference',
          reason: 'reference_expired',
        })),
        now,
      );
      await database.pool.query('UPDATE object_cleanup_queue SET attempt_count=2');
    });
    afterAll(async () => {
      await database?.pool.end();
      await container?.stop();
    });
    const facts = async () => ({
      uploads: (await database.pool.query('SELECT * FROM generation_reference_uploads ORDER BY id'))
        .rows,
      queue: (await database.pool.query('SELECT * FROM object_cleanup_queue ORDER BY object_key'))
        .rows,
    });
    const execute = (operation: (typeof operations)[number]) => {
      switch (operation) {
        case 'enqueue':
          return store.queueExpiredReferences(now);
        case 'acknowledge':
          return store.acknowledge([ordinary]);
        case 'discard':
          return store.discardProtected([ordinary]);
        case 'mixed-discard':
          return store.discardProtected([imported, ordinary]);
        case 'defer':
          return store.deferLeased([ordinary], now);
        case 'fail':
          return store.fail([ordinary], new Error('owned failure'), now);
      }
    };

    it.each(operations)(
      'rolls back %s within the lock budget, restores pooled settings, then retries',
      async (operation) => {
        if (operation === 'enqueue')
          await database.pool.query(
            "UPDATE generation_reference_uploads SET status='available',cleanup_queued_at=NULL",
          );
        const before = await facts();
        const timeout = (await database.pool.query('SHOW lock_timeout')).rows;
        const holder = new pg.Client({ connectionString: container.getConnectionUri() });
        await holder.connect();
        let pending: Promise<{ code?: string }> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1 FOR UPDATE', [
            ordinary,
          ]);
          pending = execute(operation).then(
            () => ({ code: 'unexpected-success' }),
            (error: unknown) => ({ code: (error as { cause?: { code?: string } }).cause?.code }),
          );
          const outcome = await Promise.race([
            pending,
            new Promise<{ code: string }>((resolve) => {
              timer = setTimeout(() => resolve({ code: 'probe-deadline-exceeded' }), 4000);
            }),
          ]);
          expect(outcome).toEqual({ code: '55P03' });
          expect(await facts()).toEqual(before);
          expect((await database.pool.query('SHOW lock_timeout')).rows).toEqual(timeout);
          await holder.query('COMMIT');
          await execute(operation);
          const after = await facts();
          const queued = after.queue.find((row) => row.object_key === ordinary);
          if (operation === 'enqueue') {
            expect(after.uploads[0]).toMatchObject({
              status: 'cleanup_pending',
              cleanup_queued_at: now,
            });
            expect(queued).toMatchObject({ attempt_count: 2, updated_at: now });
            expect(await store.queueExpiredReferences(now)).toBe(0);
          } else if (operation === 'acknowledge') {
            expect(after.uploads).toEqual([]);
            expect(queued).toBeUndefined();
            await execute(operation);
            expect(await facts()).toEqual(after);
          } else if (operation === 'discard' || operation === 'mixed-discard') {
            expect(after.uploads[0]).toMatchObject({
              status: 'available',
              cleanup_queued_at: null,
            });
            expect(queued).toBeUndefined();
          } else {
            expect(after.uploads).toEqual(before.uploads);
            expect(queued).toMatchObject({
              attempt_count: operation === 'defer' ? 1 : 2,
              last_error: operation === 'defer' ? 'active_generation_lease' : 'Error',
            });
            expect(queued.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
          }
          const importedAfter = after.queue.find((row) => row.object_key === imported);
          if (operation === 'mixed-discard') {
            expect(importedAfter).toMatchObject({
              attempt_count: 1,
              last_error: 'active_generation_lease',
            });
          } else {
            expect(importedAfter).toEqual(before.queue.find((row) => row.object_key === imported));
          }
        } finally {
          if (timer) clearTimeout(timer);
          await holder.query('ROLLBACK');
          await pending;
          await holder.end();
        }
      },
      15000,
    );
  },
);
