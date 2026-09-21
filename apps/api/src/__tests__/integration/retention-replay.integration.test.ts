import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, purgeGenerationRetentionBatch } from '@musefold/db';
import { runMigrations } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const owner = 'owned-retention-replay';
const key = 'owned-original-retention-key';
const input = { prompt: 'Original replay result' };
const observe = <T>(operation: Promise<T>) =>
  operation.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
describeDb(
  'accepted-key replay and irreversible retention share one intact result boundary',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let maintenance: ReturnType<typeof createDatabase>;
    let generation: GenerationService;
    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri(), { max: 1 });
      maintenance = createDatabase(container.getConnectionUri(), { max: 4 });
      await migrateDatabase(database.db);
      await runMigrations({ pgPool: database.pool });
      const forbidden = async (): Promise<never> => {
        throw new Error('Replay must not perform provider or object IO');
      };
      generation = new GenerationService(
        database.db,
        {
          urlTtlSeconds: 60,
          sign: forbidden,
          readObject: forbidden,
          putObject: forbidden,
          removeObjects: forbidden,
        },
        GENERATION_TEST_ISSUERS,
      );
    }, 180000);
    beforeEach(async () => {
      await database.pool.query(
        'TRUNCATE "user",generation_execution_receipts,object_cleanup_queue CASCADE',
      );
      await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$1)', [owner]);
      await seedGenerationAuthority(database.db, { principalId: owner, ownerId: '42' });
    });
    afterAll(async () => {
      await database?.pool.end();
      await maintenance?.pool.end();
      await container?.stop();
    });
    const replay = () => generation.create(owner, input, key, generationAuthSession(owner));
    async function seed(mode: 'receipt' | 'legacy') {
      const job = await replay();
      await generation.cancel(owner, job.id);
      await database.pool.query(
        "UPDATE generation_runs SET deleted_at=now()-interval '31 days' WHERE id=$1",
        [job.id],
      );
      if (mode === 'legacy') {
        // A historical accepted key without a receipt stays replay-only, never re-authorized.
        await database.pool.query(
          'UPDATE generation_runs SET execution_receipt_id=NULL WHERE id=$1',
          [job.id],
        );
        await database.pool.query(
          'DELETE FROM generation_execution_receipts WHERE original_run_id=$1',
          [job.id],
        );
      }
      await database.pool.query(
        `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
      SELECT 'asset-'||n,$1,$2,'owned/replay/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(0,1000) n`,
        [job.id, owner],
      );
      expect((await generation.get(owner, job.id)).assets).toHaveLength(1001);
      return job;
    }
    async function blockedBy(pid: number) {
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const result = await maintenance.pool.query(
          'SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (result.rows[0]) return result.rows[0].pid as number;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return null;
    }
    const facts = async () => ({
      receipts: (
        await maintenance.pool.query('SELECT * FROM generation_execution_receipts ORDER BY id')
      ).rows,
      jobs: (
        await maintenance.pool.query('SELECT * FROM graphile_worker._private_jobs ORDER BY id')
      ).rows,
    });
    async function verifyFinished(
      id: string,
      before: Awaited<ReturnType<typeof facts>>,
      now: Date,
    ) {
      expect((await facts()).jobs).toEqual(before.jobs);
      expect((await facts()).receipts).toEqual(
        before.receipts.map((row: Record<string, unknown>) => ({
          ...row,
          purged_at: now,
          updated_at: now,
          revision: Number(row.revision) + 1,
        })),
      );
      await expect(replay()).rejects.toMatchObject({ code: 'GENERATION_RESULT_CLEANED' });
      expect(await purgeGenerationRetentionBatch(maintenance.db, now)).toMatchObject({
        purged: 1,
        objectKeys: expect.any(Array),
      });
      expect(
        (await maintenance.pool.query('SELECT id FROM generation_runs WHERE id=$1', [id])).rows,
      ).toEqual([]);
      expect((await facts()).jobs).toEqual(before.jobs);
      expect(await purgeGenerationRetentionBatch(maintenance.db, now)).toEqual({
        purged: 0,
        objectKeys: [],
      });
    }
    it.each(['receipt', 'legacy'] as const)(
      '%s replay holds the source until its assets are read',
      async (mode) => {
        const job = await seed(mode);
        const before = await facts();
        const now = new Date();
        const client = await database.pool.connect();
        const pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        const original = client.query;
        let reached!: () => void;
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => {
          reached = resolve;
        });
        const barrier = new Promise<void>((resolve) => {
          resume = resolve;
        });
        let armed = true;
        // Only scheduling is controlled: the production query and its actual PG rows are unchanged.
        client.query = new Proxy(original, {
          async apply(target, self, args) {
            const result = await Reflect.apply(target, self, args);
            const text = typeof args[0] === 'string' ? args[0] : args[0].text;
            if (
              armed &&
              text.startsWith('select') &&
              text.includes('from "generation_runs"') &&
              text.includes('"generation_runs"."idempotency_key" = ')
            ) {
              armed = false;
              reached();
              await barrier;
            }
            return result;
          },
        });
        client.release();
        const pending = observe(replay());
        let cleanup:
          | ReturnType<typeof observe<Awaited<ReturnType<typeof purgeGenerationRetentionBatch>>>>
          | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            paused,
            new Promise<void>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Source lookup barrier missing')), 3000);
            }),
          ]);
          cleanup = observe(purgeGenerationRetentionBatch(maintenance.db, now));
          expect(await blockedBy(pid)).not.toBeNull();
          expect(
            (
              await maintenance.pool.query(
                'SELECT purge_started_at FROM generation_runs WHERE id=$1',
                [job.id],
              )
            ).rows[0].purge_started_at,
          ).toBeNull();
          resume();
          const result = await pending;
          expect(result.error).toBeUndefined();
          expect(result.value?.assets).toHaveLength(1001);
          expect(await cleanup).toMatchObject({
            value: { purged: 0, objectKeys: expect.any(Array) },
            error: undefined,
          });
          expect((await cleanup).value?.objectKeys).toHaveLength(1000);
          await verifyFinished(job.id, before, now);
        } finally {
          if (timer) clearTimeout(timer);
          resume();
          await pending;
          await cleanup;
          client.query = original;
        }
      },
      15000,
    );
    it.each(['receipt', 'legacy'] as const)(
      '%s replay waits for a started purge and returns the cleaned error',
      async (mode) => {
        const job = await seed(mode);
        const before = await facts();
        const now = new Date();
        const holder = await maintenance.pool.connect();
        let cleanup:
          | ReturnType<typeof observe<Awaited<ReturnType<typeof purgeGenerationRetentionBatch>>>>
          | undefined;
        let pending: ReturnType<typeof observe<Awaited<ReturnType<typeof replay>>>> | undefined;
        try {
          await holder.query('BEGIN');
          const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          await holder.query("SELECT id FROM generation_assets WHERE id='asset-0' FOR UPDATE");
          cleanup = observe(purgeGenerationRetentionBatch(maintenance.db, now));
          const purgePid = await blockedBy(pid);
          expect(purgePid).not.toBeNull();
          if (purgePid === null) throw new Error('Retention did not acquire the source lock');
          pending = observe(replay());
          expect(await blockedBy(purgePid)).not.toBeNull();
          await holder.query('COMMIT');
          expect(await cleanup).toMatchObject({ value: { purged: 0 }, error: undefined });
          expect((await pending).error).toMatchObject({ code: 'GENERATION_RESULT_CLEANED' });
          await verifyFinished(job.id, before, now);
        } finally {
          await holder.query('ROLLBACK');
          holder.release();
          await cleanup;
          await pending;
        }
      },
      15000,
    );
  },
);
