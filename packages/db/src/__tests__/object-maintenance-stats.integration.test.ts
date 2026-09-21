import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../client.js';
import { migrateDatabase } from '../migrate.js';
import {
  collectObjectMaintenanceSnapshot,
  MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT,
  PROTECTION_DEFERRAL_MARKER,
} from '../object-maintenance-stats.js';

const HASH = 'a'.repeat(64);
const SCOPE = 'b'.repeat(64);
const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * D02.7 safety counters: the read-only snapshot must mirror the real table
 * states exactly, carry only anonymized (SHA-256) object identities and be
 * side-effect-free so backstage observation can poll it — including while
 * destructive maintenance is paused.
 */
describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')(
  'object maintenance safety snapshot',
  () => {
    const name = `maintenance_stats_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool;
    let database: ReturnType<typeof createDatabase>;
    let created = false;
    const NOW = new Date('2026-09-14T12:00:00.000Z');
    const PAST = new Date(NOW.getTime() - 60_000);
    const FUTURE = new Date(NOW.getTime() + 60_000);

    const facts = async () => {
      const result: Record<string, pg.QueryResultRow[]> = {};
      for (const table of [
        'object_cleanup_queue',
        'object_inventory_candidates',
        'object_key_retirements',
      ]) {
        result[table] = (
          await database.pool.query(`SELECT * FROM ${table} ORDER BY row_to_json(${table})::text`)
        ).rows;
      }
      return result;
    };
    const enqueue = (
      objectKey: string,
      state: { nextAttemptAt: Date; lastError?: string; abandonedAt?: Date },
    ) =>
      database.pool.query(
        `INSERT INTO object_cleanup_queue(object_key,owner_id,object_type,reason,next_attempt_at,last_error,abandoned_at)
         VALUES($1,'stats-owner','generation_reference','reference_expired',$2,$3,$4)`,
        [objectKey, state.nextAttemptAt, state.lastError ?? null, state.abandonedAt ?? null],
      );
    const observe = (
      objectKey: string,
      state: {
        eligibleAt: Date;
        nextAttemptAt?: Date;
        claimToken?: string;
        claimUntil?: Date;
        lastError?: string;
        abandonedAt?: Date;
      },
    ) =>
      database.pool.query(
        `INSERT INTO object_inventory_candidates
         (scope_id,object_key,prefix,etag,modified_at,byte_size,first_observed_at,last_observed_at,eligible_at,claim_token,claim_until,next_attempt_at,last_error,abandoned_at)
         VALUES($1,$2,'users/','etag',$3,17,$3,$3,$4,$5,$6,$7,$8,$9)`,
        [
          SCOPE,
          objectKey,
          PAST,
          state.eligibleAt,
          state.claimToken ?? null,
          state.claimUntil ?? null,
          state.nextAttemptAt ?? PAST,
          state.lastError ?? null,
          state.abandonedAt ?? null,
        ],
      );

    beforeAll(async () => {
      if (!process.env.DATABASE_URL)
        throw new Error('Supply an explicit owned disposable DATABASE_URL');
      admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      const target = new URL(process.env.DATABASE_URL);
      target.pathname = `/${name}`;
      database = createDatabase(target.toString());
      await migrateDatabase(database.db);
    }, 60000);
    beforeEach(async () => {
      await database.pool.query(
        'TRUNCATE object_cleanup_queue,object_inventory_candidates,object_key_retirements',
      );
    });
    afterAll(async () => {
      await database?.pool.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin?.end();
    });

    it('mirrors outbox, inventory and retirement states into the five counters', async () => {
      await enqueue('users/stats-owner/references/due', { nextAttemptAt: PAST });
      await enqueue('users/stats-owner/references/lease-held', {
        nextAttemptAt: FUTURE,
        lastError: PROTECTION_DEFERRAL_MARKER,
      });
      await enqueue('users/stats-owner/references/backoff', {
        nextAttemptAt: FUTURE,
        lastError: 'S3DeleteObjectsError',
      });
      await enqueue('users/stats-owner/references/gave-up', {
        nextAttemptAt: FUTURE,
        lastError: 'S3DeleteObjectsError',
        abandonedAt: PAST,
      });
      await observe('users/stats-owner/references/grace', { eligibleAt: FUTURE });
      await observe('users/stats-owner/references/ready', { eligibleAt: PAST });
      await observe('users/stats-owner/references/claimed', {
        eligibleAt: PAST,
        claimToken: randomUUID(),
        claimUntil: FUTURE,
      });
      await observe('users/stats-owner/references/flaky', {
        eligibleAt: PAST,
        nextAttemptAt: FUTURE,
        lastError: 'InventoryHeadFailed',
      });
      await observe('users/stats-owner/references/stuck', {
        eligibleAt: PAST,
        lastError: 'InventoryDeleteFailed',
        abandonedAt: PAST,
      });
      await database.pool.query(`INSERT INTO object_key_retirements(key_hash) VALUES ($1),($2)`, [
        keyHash('users/stats-owner/references/deleted-a'),
        keyHash('scheme-exports/deleted-b'),
      ]);

      const snapshot = await collectObjectMaintenanceSnapshot(database.db, NOW);
      expect(snapshot.generatedAt).toBe(NOW.toISOString());
      expect(snapshot.outbox).toEqual({
        due: 1,
        deferred: 2,
        protectedDeferrals: 1,
        failed: 1,
        abandoned: 1,
      });
      expect(snapshot.inventory).toEqual({
        observing: 1,
        eligible: 1,
        claimed: 1,
        failed: 1,
        abandoned: 1,
      });
      expect(snapshot.retired).toBe(2);
      expect(snapshot.totals).toEqual({
        // 3 live outbox rows + 4 live inventory observations.
        candidates: 7,
        // Lease deferral + in-grace observation.
        protected: 2,
        deleted: 2,
        failed: 2,
        abandoned: 2,
      });
    });

    it('carries only SHA-256 object identities, never real keys', async () => {
      const failedKey = `users/stats-owner/references/${randomUUID()}`;
      const abandonedQueueKey = `users/stats-owner/design-scheme-uploads/${randomUUID()}`;
      const abandonedInventoryKey = `scheme-sources/${HASH}/${randomUUID()}/${randomUUID()}`;
      await enqueue(failedKey, { nextAttemptAt: FUTURE, lastError: 'S3DeleteObjectsError' });
      await enqueue(abandonedQueueKey, { nextAttemptAt: FUTURE, abandonedAt: PAST });
      await observe(abandonedInventoryKey, { eligibleAt: PAST, abandonedAt: PAST });

      const snapshot = await collectObjectMaintenanceSnapshot(database.db, NOW);
      const serialized = JSON.stringify(snapshot);
      for (const key of [failedKey, abandonedQueueKey, abandonedInventoryKey]) {
        expect(serialized).not.toContain(key);
        expect(serialized).not.toContain(encodeURIComponent(key));
      }
      expect(snapshot.anonymous.failed).toEqual([keyHash(failedKey)]);
      expect(snapshot.anonymous.abandoned).toEqual(
        [keyHash(abandonedQueueKey), keyHash(abandonedInventoryKey)].sort(),
      );
      for (const hash of [...snapshot.anonymous.failed, ...snapshot.anonymous.abandoned]) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(snapshot.anonymous.failed.length).toBeLessThanOrEqual(
        MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT,
      );
      expect(snapshot.anonymous.abandoned.length).toBeLessThanOrEqual(
        MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT,
      );
    });

    it('is side-effect-free and repeatable at the same clock', async () => {
      await enqueue('users/stats-owner/references/due', { nextAttemptAt: PAST });
      await observe('users/stats-owner/references/grace', { eligibleAt: FUTURE });
      const before = await facts();
      const first = await collectObjectMaintenanceSnapshot(database.db, NOW);
      const second = await collectObjectMaintenanceSnapshot(database.db, NOW);
      expect(second).toEqual(first);
      expect(await facts()).toEqual(before);
    });
  },
);
