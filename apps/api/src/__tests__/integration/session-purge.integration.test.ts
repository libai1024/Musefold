import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, purgeGenerationRetentionBatch } from '@musefold/db';
import { runMigrations } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchService } from '../../modules/workbench/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const owner = 'session-purge-owner';
const foreign = 'session-purge-foreign';
const forbiddenIo = async (): Promise<never> => {
  throw new Error('Purge must not perform provider or object IO');
};
const observe = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );

describeDb('Session purge, restoration and generation admission with real PostgreSQL locks', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let service: WorkbenchService;
  let generation: GenerationService;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 8 });
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
    service = new WorkbenchService(database.db);
    generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        sign: forbiddenIo,
        readObject: forbiddenIo,
        putObject: forbiddenIo,
        removeObjects: forbiddenIo,
      },
      GENERATION_TEST_ISSUERS,
    );
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('DELETE FROM generation_execution_receipts');
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$1),($2,$2,$2)', [
      owner,
      foreign,
    ]);
    await seedGenerationAuthority(database.db, { principalId: owner, ownerId: '42' });
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  const facts = async () => {
    const tables = [
      'workbench_sessions',
      'generation_runs',
      'generation_assets',
      'generation_execution_receipts',
      'generation_events',
    ];
    return Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (await database.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
        ]),
      ),
    );
  };
  const createRun = (sessionId: string, key = randomUUID()) =>
    generation.create(
      owner,
      { prompt: 'Preserved output', sessionId },
      key,
      generationAuthSession(owner),
    );
  async function waitBlocked(blocker: number, minimum = 1) {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const result = await database.pool.query(
        'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
        [blocker],
      );
      if (result.rows.length >= minimum) return result.rows.map((row) => row.pid as number);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected real PostgreSQL lock contention did not occur');
  }

  it('detaches generation without changing assets, immutable receipts, events or cost, and replays the original key', async () => {
    const session = await service.create(owner, {
      title: 'Deleted',
      draft: { prompt: 'Private draft' },
    });
    const key = randomUUID();
    const job = await createRun(session.id, key);
    await generation.cancel(owner, job.id);
    await database.pool.query(
      `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256)
      VALUES ('preserved-asset',$1,$2,'owned/output.png','image/png',2,2,100,$3)`,
      [job.id, owner, 'a'.repeat(64)],
    );
    await service.remove(owner, session.id, undefined);
    const before = await facts();
    expect(await service.purge(foreign, session.id)).toEqual({ purged: 0 });
    expect(await facts()).toEqual(before);
    expect(await service.purge(owner, session.id)).toEqual({ purged: 1 });
    const after = await facts();
    expect(after).toEqual({
      ...before,
      workbench_sessions: [],
      generation_runs: before.generation_runs.map((row: Record<string, unknown>) => ({
        ...row,
        session_id: null,
      })),
    });
    expect(await service.purge(owner, session.id)).toEqual({ purged: 0 });
    // The original receipt remains replay-only; no new job or paid authority is created.
    // Remove the synthetic asset from this fixture before replay, which would otherwise require signing IO.
    await database.pool.query('DELETE FROM generation_assets WHERE id=$1', ['preserved-asset']);
    expect((await createRun(session.id, key)).id).toBe(job.id);
    expect((await facts()).generation_runs).toHaveLength(1);
  });

  it('clears 501 trashed rows including archive while preserving live and foreign rows', async () => {
    await database.pool.query(
      `INSERT INTO workbench_sessions(id,user_id,title,draft,deleted_at,archived_at)
      SELECT 'trash-'||n,$1,'Trash','{"prompt":"","negative":"","params":{}}',now(),CASE WHEN n%2=0 THEN now() END FROM generate_series(1,501) n`,
      [owner],
    );
    const live = await service.create(owner, { title: 'Live' });
    const other = await service.create(foreign, { title: 'Foreign' });
    await service.remove(foreign, other.id, undefined);
    expect(await service.emptyTrash(owner)).toEqual({ purged: 501 });
    expect(await service.get(owner, live.id)).toEqual(live);
    expect((await service.get(foreign, other.id)).deletedAt).not.toBeNull();
    expect(await service.emptyTrash(owner)).toEqual({ purged: 0 });
  });

  it.each(['restore-first', 'empty-first'] as const)(
    'empty trash uses its locked snapshot with %s and a newly deleted arrival',
    async (order) => {
      const originals = await Promise.all([
        service.create(owner, { title: 'Original one' }),
        service.create(owner, { title: 'Original two' }),
      ]);
      originals.sort((a, b) => a.id.localeCompare(b.id));
      const target = originals[0];
      await service.update(owner, target.id, { expectedVersion: 1, archived: true });
      for (const item of originals) await service.remove(owner, item.id, undefined);
      const archived = await service.get(owner, target.id);
      const arrival = await service.create(owner, { title: 'Enters trash after clear starts' });
      const otherOwner = await service.create(foreign, { title: 'Other owner' });
      const foreignDeleted = await service.remove(foreign, otherOwner.id, undefined);
      const lock = await database.pool.connect();
      const pending: Array<ReturnType<typeof observe>> = [];
      try {
        await lock.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await lock.query('SELECT pg_backend_pid() AS pid');
        await lock.query('SELECT id FROM workbench_sessions WHERE id=$1 FOR UPDATE', [target.id]);
        const restore = () => service.restore(owner, target.id, undefined);
        const clear = () => service.emptyTrash(owner);
        pending.push(observe(order === 'restore-first' ? restore() : clear()));
        const [firstWaiter] = await waitBlocked(pid);
        pending.push(observe(order === 'restore-first' ? clear() : restore()));
        await waitBlocked(firstWaiter);
        // This commits after the clear statement has selected its snapshot and is blocked.
        const arrived = await service.remove(owner, arrival.id, undefined);
        await lock.query('COMMIT');
        const [first, second] = await Promise.all(pending);
        if (order === 'restore-first') {
          expect(first.error).toBeUndefined();
          expect(second).toEqual({ value: { purged: 1 }, error: undefined });
          const restored = await service.get(owner, target.id);
          expect(restored.deletedAt).toBeNull();
          expect(restored.archivedAt).toBe(archived.archivedAt);
          expect(restored.draft).toEqual(archived.draft);
          expect(restored.version).toBe(archived.version + 1);
        } else {
          expect(first).toEqual({ value: { purged: 2 }, error: undefined });
          expect(second.error).toMatchObject({ code: 'WORKBENCH_SESSION_NOT_FOUND' });
          await expect(service.get(owner, target.id)).rejects.toMatchObject({
            code: 'WORKBENCH_SESSION_NOT_FOUND',
          });
        }
        await expect(service.get(owner, originals[1].id)).rejects.toMatchObject({
          code: 'WORKBENCH_SESSION_NOT_FOUND',
        });
        expect(await service.get(owner, arrival.id)).toEqual(arrived);
        expect(await service.get(foreign, otherOwner.id)).toEqual(foreignDeleted);
        expect(await service.emptyTrash(owner)).toEqual({ purged: 1 });
        expect(await service.emptyTrash(owner)).toEqual({ purged: 0 });
        expect(await service.get(foreign, otherOwner.id)).toEqual(foreignDeleted);
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await Promise.all(pending);
      }
    },
    20_000,
  );

  it('rolls back detached generation and all Session deletion if the delete statement fails', async () => {
    const session = await service.create(owner, { title: 'Rollback' });
    await createRun(session.id);
    await service.remove(owner, session.id, undefined);
    const before = await facts();
    await database.pool.query(`CREATE FUNCTION owned_purge_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned purge fault'; END $$;
      CREATE TRIGGER owned_purge_fault BEFORE DELETE ON workbench_sessions FOR EACH ROW EXECUTE FUNCTION owned_purge_fault()`);
    try {
      await expect(service.emptyTrash(owner)).rejects.toThrow();
      expect(await facts()).toEqual(before);
    } finally {
      await database.pool.query(
        'DROP TRIGGER owned_purge_fault ON workbench_sessions; DROP FUNCTION owned_purge_fault()',
      );
    }
  });

  it.each(['restore-first', 'purge-first'] as const)(
    'serializes %s under a real row lock',
    async (order) => {
      const session = await service.create(owner, { title: 'Race' });
      await service.update(owner, session.id, { expectedVersion: 1, archived: true });
      await service.remove(owner, session.id, undefined);
      const lock = await database.pool.connect();
      const operations: Array<ReturnType<typeof observe>> = [];
      try {
        await lock.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await lock.query('SELECT pg_backend_pid() AS pid');
        await lock.query('SELECT id FROM workbench_sessions WHERE id=$1 FOR UPDATE', [session.id]);
        const restore = () => service.restore(owner, session.id, undefined);
        const purge = () => service.purge(owner, session.id);
        operations.push(observe(order === 'restore-first' ? restore() : purge()));
        const firstWaiters = await waitBlocked(pid);
        operations.push(observe(order === 'restore-first' ? purge() : restore()));
        // The second operation queues behind the first waiter, establishing the order before release.
        await waitBlocked(firstWaiters[0]);
        await lock.query('COMMIT');
        const [first, second] = await Promise.all(operations);
        expect(first?.error).toBeUndefined();
        if (order === 'restore-first') {
          expect(second?.error).toMatchObject({ code: 'VALIDATION_FAILED' });
          const restored = await service.get(owner, session.id);
          expect(restored.deletedAt).toBeNull();
          expect(restored.archivedAt).not.toBeNull();
        } else {
          expect(second?.error).toMatchObject({ code: 'WORKBENCH_SESSION_NOT_FOUND' });
          expect(await service.purge(owner, session.id)).toEqual({ purged: 0 });
        }
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await Promise.all(operations);
      }
    },
  );

  it('holds the Session share lock until generation admission commits, then cleanup detaches that run', async () => {
    const session = await service.create(owner, { title: 'Admission race' });
    const lock = await database.pool.connect();
    const pending: Array<ReturnType<typeof observe>> = [];
    try {
      const {
        rows: [{ pid }],
      } = await lock.query('SELECT pg_backend_pid() AS pid');
      await lock.query('SELECT pg_advisory_lock(87654321)');
      await database.pool.query(`CREATE FUNCTION owned_admission_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87654321); RETURN NEW; END $$;
        CREATE TRIGGER owned_admission_pause BEFORE INSERT ON generation_runs FOR EACH ROW EXECUTE FUNCTION owned_admission_pause()`);
      pending.push(observe(createRun(session.id)));
      const [admissionPid] = await waitBlocked(pid);
      pending.push(observe(service.remove(owner, session.id, undefined)));
      await waitBlocked(admissionPid);
      await lock.query('SELECT pg_advisory_unlock(87654321)');
      const outcomes = await Promise.all(pending);
      expect(outcomes.every((outcome) => outcome.error === undefined)).toBe(true);
      const before = await facts();
      expect(before.generation_runs).toHaveLength(1);
      expect(await service.purge(owner, session.id)).toEqual({ purged: 1 });
      expect(await facts()).toEqual({
        ...before,
        workbench_sessions: [],
        generation_runs: before.generation_runs.map((row: Record<string, unknown>) => ({
          ...row,
          session_id: null,
        })),
      });
    } finally {
      await lock.query('SELECT pg_advisory_unlock_all()');
      lock.release();
      await Promise.all(pending);
      await database.pool.query(
        'DROP TRIGGER IF EXISTS owned_admission_pause ON generation_runs; DROP FUNCTION IF EXISTS owned_admission_pause()',
      );
    }
  }, 20_000);

  it('rejects a fresh admission after purge without adding a generation or receipt', async () => {
    const session = await service.create(owner, { title: 'Gone' });
    await service.remove(owner, session.id, undefined);
    await service.purge(owner, session.id);
    const before = await facts();
    await expect(createRun(session.id)).rejects.toMatchObject({
      code: 'WORKBENCH_SESSION_NOT_FOUND',
    });
    expect(await facts()).toEqual(before);
  });

  it('rejects retry that read the old Session association before concurrent purge detached its source', async () => {
    const session = await service.create(owner, { title: 'Retry race' });
    const job = await createRun(session.id);
    await generation.cancel(owner, job.id);
    const lock = await database.pool.connect();
    let pending: ReturnType<typeof observe> | undefined;
    try {
      await lock.query('BEGIN');
      const {
        rows: [{ pid }],
      } = await lock.query('SELECT pg_backend_pid() AS pid');
      await lock.query(
        'SELECT id FROM generation_execution_receipts WHERE original_run_id=$1 FOR UPDATE',
        [job.id],
      );
      pending = observe(
        generation.retry(owner, job.id, randomUUID(), generationAuthSession(owner)),
      );
      await waitBlocked(pid);
      await service.remove(owner, session.id, undefined);
      await service.purge(owner, session.id);
      const before = await facts();
      await lock.query('COMMIT');
      expect((await pending).error).toMatchObject({ code: 'WORKBENCH_SESSION_NOT_FOUND' });
      expect(await facts()).toEqual(before);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await pending;
    }
  });

  it.each(['retention-first', 'retry-first'] as const)(
    'serializes irreversible retention and retry with %s without losing accepted receipts',
    async (order) => {
      const session = await service.create(owner, { title: 'Retention retry race' });
      const job = await createRun(session.id);
      await generation.cancel(owner, job.id);
      const now = new Date();
      await database.pool.query(
        "UPDATE generation_runs SET deleted_at=$2::timestamptz-interval '31 days' WHERE id=$1",
        [job.id, now],
      );
      // More than one batch forces a durable partial result in the retention-first case.
      await database.pool.query(
        `INSERT INTO generation_events(run_id,user_id,event_type,payload)
        SELECT $1,$2,'generation.cancelled','{}' FROM generate_series(1,1001)`,
        [job.id, owner],
      );
      const before = await facts();
      const countJobs = async () =>
        (await database.pool.query('SELECT count(*)::int AS n FROM graphile_worker._private_jobs'))
          .rows[0].n as number;
      const jobsBefore = await countJobs();
      const lock = await database.pool.connect();
      const pending: Array<ReturnType<typeof observe>> = [];
      try {
        await lock.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await lock.query('SELECT pg_backend_pid() AS pid');
        await lock.query(
          'SELECT id FROM generation_execution_receipts WHERE original_run_id=$1 FOR UPDATE',
          [job.id],
        );
        const retry = () =>
          observe(generation.retry(owner, job.id, randomUUID(), generationAuthSession(owner)));
        const purge = () => observe(purgeGenerationRetentionBatch(database.db, now));
        pending.push(order === 'retention-first' ? purge() : retry());
        const [firstPid] = await waitBlocked(pid);
        pending.push(order === 'retention-first' ? retry() : purge());
        await waitBlocked(firstPid);
        // Both operations are actually waiting in PG; neither has published a partial result.
        expect(await facts()).toEqual(before);
        await lock.query('COMMIT');
        const [first, second] = await Promise.all(pending);
        const cleanup = order === 'retention-first' ? first : second;
        const attempted = order === 'retention-first' ? second : first;
        expect(cleanup).toEqual({ value: { purged: 0, objectKeys: [] }, error: undefined });
        const after = await facts();
        expect(
          after.generation_events.filter((row: { run_id: string }) => row.run_id === job.id),
        ).toHaveLength(before.generation_events.length - 1000);
        const retainedReceipt = {
          ...before.generation_execution_receipts[0],
          purged_at: now,
          updated_at: now,
          revision: before.generation_execution_receipts[0].revision + 1,
        };
        expect(after.generation_execution_receipts).toContainEqual(retainedReceipt);
        if (order === 'retention-first') {
          expect(attempted.error).toMatchObject({ code: 'GENERATION_NOT_FOUND' });
          expect(after.generation_runs).toHaveLength(1);
          expect(after.generation_execution_receipts).toEqual([retainedReceipt]);
          expect(await countJobs()).toBe(jobsBefore);
        } else {
          expect(attempted.error).toBeUndefined();
          expect(attempted.value).toMatchObject({ status: 'queued', parentRunId: job.id });
          expect(after.generation_runs).toHaveLength(2);
          expect(after.generation_execution_receipts).toHaveLength(2);
          expect(await countJobs()).toBe(jobsBefore + 1);
        }
        expect(await purgeGenerationRetentionBatch(database.db, now)).toEqual({
          purged: 1,
          objectKeys: [],
        });
        expect((await facts()).generation_execution_receipts).toEqual(
          after.generation_execution_receipts,
        );
        expect(await purgeGenerationRetentionBatch(database.db, now)).toEqual({
          purged: 0,
          objectKeys: [],
        });
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await Promise.all(pending);
      }
    },
    20_000,
  );
});
