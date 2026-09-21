import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  type MusefoldDatabase,
  accountRecoveryBackupEvidence,
  accountRecoveryRequests,
  createDatabase,
  migrateDatabase,
  session,
  user,
} from '@musefold/db';
import { sealJsonToString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { runMigrations, runOnce } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExpiredAccountRecoverySecretBatches,
  clearExpiredAccountRecoverySecrets,
} from '../account-recovery-retention.js';
import { createTaskList } from '../tasks.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'recovery-retention-test';
const NOW = new Date('2026-09-08T00:00:00.000Z');
const PAST = new Date(NOW.getTime() - 1000);
const FUTURE = new Date(NOW.getTime() + 86_400_000);
const ENCRYPTION_KEY = 'synthetic-recovery-retention-key';
const ENCRYPTED = sealJsonToString({ marker: 'synthetic-recovery-material' }, ENCRYPTION_KEY);

describeDb('account recovery material retention (real PG, bounded and nonblocking)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri(), { max: 5 }));
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    await db.insert(user).values({ id: OWNER, name: 'Retention', email: 'retention@example.test' });
  }, 180_000);
  beforeEach(async () => {
    await db.delete(session).where(eq(session.userId, OWNER));
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function seed(
    input: {
      requestExpiry?: Date;
      backupExpiry?: Date;
      completed?: boolean;
      backupState?: 'staged' | 'consumed' | 'revoked';
      leased?: boolean;
    } = {},
  ) {
    const id = randomUUID();
    await db.insert(session).values({
      id,
      userId: OWNER,
      token: `synthetic-${id}`,
      expiresAt: FUTURE,
    });
    await db.insert(accountRecoveryRequests).values({
      id,
      sessionId: id,
      targetUserId: OWNER,
      upstreamIssuer: 'https://upstream.example.test',
      upstreamOwnerId: '101',
      candidateCiphertext: ENCRYPTED,
      candidateSummary: {},
      reason: 'legacy_evidence_missing',
      identityVersion: 0,
      status: input.completed ? 'completed' : 'pending',
      expiresAt: input.requestExpiry ?? FUTURE,
    });
    await db.insert(accountRecoveryBackupEvidence).values({
      id,
      requestId: id,
      targetUserId: OWNER,
      upstreamIssuer: 'https://upstream.example.test',
      sourceProfileId: 'synthetic-profile',
      sourceDigest: 'a'.repeat(64),
      provenance: { assurance: 'synthetic-retention-test' },
      ciphertext: input.backupState && input.backupState !== 'staged' ? '' : ENCRYPTED,
      state: input.backupState ?? 'staged',
      expiresAt: input.backupExpiry ?? FUTURE,
      leaseId: input.leased ? randomUUID() : null,
      leaseUntil: input.leased ? FUTURE : null,
    });
    return id;
  }

  async function facts(id: string) {
    const request = await db.query.accountRecoveryRequests.findFirst({
      where: eq(accountRecoveryRequests.id, id),
    });
    const backup = await db.query.accountRecoveryBackupEvidence.findFirst({
      where: eq(accountRecoveryBackupEvidence.id, id),
    });
    return { request, backup };
  }

  async function seedBatch(count: number, requestExpiry: Date, backupExpiry: Date) {
    const ids = Array.from({ length: count }, () => randomUUID());
    await db.insert(session).values(
      ids.map((id) => ({
        id,
        userId: OWNER,
        token: `synthetic-${id}`,
        expiresAt: FUTURE,
      })),
    );
    await db.insert(accountRecoveryRequests).values(
      ids.map((id) => ({
        id,
        sessionId: id,
        targetUserId: OWNER,
        upstreamIssuer: 'https://upstream.example.test',
        upstreamOwnerId: '101',
        candidateCiphertext: ENCRYPTED,
        candidateSummary: {},
        reason: 'legacy_evidence_missing',
        identityVersion: 0,
        expiresAt: requestExpiry,
      })),
    );
    await db.insert(accountRecoveryBackupEvidence).values(
      ids.map((id) => ({
        id,
        requestId: id,
        targetUserId: OWNER,
        upstreamIssuer: 'https://upstream.example.test',
        sourceProfileId: 'synthetic-profile',
        sourceDigest: 'a'.repeat(64),
        provenance: {},
        ciphertext: ENCRYPTED,
        expiresAt: backupExpiry,
      })),
    );
  }

  async function remaining() {
    const candidates =
      await pool.query(`SELECT count(*)::int AS count, sum(revision)::int AS revision
      FROM account_recovery_requests WHERE candidate_ciphertext <> ''`);
    const backups = await pool.query(`SELECT count(*)::int AS count, sum(revision)::int AS revision
      FROM account_recovery_backup_evidence WHERE state = 'staged'`);
    return { candidates: candidates.rows[0].count, backups: backups.rows[0].count };
  }

  it('clears expired candidate and leased backup, preserves provenance and is idempotent', async () => {
    const id = await seed({ requestExpiry: PAST, leased: true });
    expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
      candidates: 1,
      backups: 1,
    });
    const { request, backup } = await facts(id);
    expect(request).toMatchObject({ candidateCiphertext: '', status: 'pending', revision: 2 });
    expect(backup).toMatchObject({
      state: 'revoked',
      ciphertext: '',
      revision: 2,
      leaseId: null,
      leaseUntil: null,
      sourceDigest: 'a'.repeat(64),
      provenance: { assurance: 'synthetic-retention-test' },
    });
    expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
      candidates: 0,
      backups: 0,
    });
    expect(await db.select().from(session)).toHaveLength(1);
  });

  it('keeps live evidence and clears only a backup that expires before its request', async () => {
    const live = await seed({ leased: true });
    const expiredBackup = await seed({ backupExpiry: NOW });
    expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
      candidates: 0,
      backups: 1,
    });
    expect((await facts(live)).backup).toMatchObject({
      state: 'staged',
      ciphertext: ENCRYPTED,
      revision: 1,
    });
    expect((await facts(expiredBackup)).request).toMatchObject({
      candidateCiphertext: ENCRYPTED,
      revision: 1,
    });
    expect((await facts(expiredBackup)).backup).toMatchObject({ state: 'revoked', ciphertext: '' });
  });

  it('clears completed request leftovers without changing previously consumed/revoked evidence', async () => {
    const staged = await seed({ completed: true });
    const consumed = await seed({ completed: true, backupState: 'consumed' });
    const revoked = await seed({ completed: true, backupState: 'revoked' });
    expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
      candidates: 3,
      backups: 1,
    });
    expect((await facts(staged)).backup?.state).toBe('revoked');
    expect((await facts(consumed)).backup).toMatchObject({
      state: 'consumed',
      revision: 1,
      ciphertext: '',
    });
    expect((await facts(revoked)).backup).toMatchObject({
      state: 'revoked',
      revision: 1,
      ciphertext: '',
    });
  });

  it('bounds batches and two independent PG connections clear each row once', async () => {
    await seed({ requestExpiry: PAST });
    await seed({ requestExpiry: PAST });
    await seed({ requestExpiry: PAST });
    const first = await clearExpiredAccountRecoverySecrets(db, NOW, 1);
    expect(first).toEqual({ candidates: 1, backups: 1 });
    const other = createDatabase(container.getConnectionUri(), { max: 1 });
    try {
      const results = await Promise.all([
        clearExpiredAccountRecoverySecrets(db, NOW, 1),
        clearExpiredAccountRecoverySecrets(other.db, NOW, 1),
      ]);
      expect(results.reduce((n, value) => n + value.candidates, 0)).toBe(2);
      expect(results.reduce((n, value) => n + value.backups, 0)).toBe(2);
      expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
        candidates: 0,
        backups: 0,
      });
    } finally {
      await other.pool.end();
    }
  });

  it('skips an active backup writer and rechecks its committed expiry on the next pass', async () => {
    const id = await seed({ backupExpiry: PAST });
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT id FROM account_recovery_backup_evidence WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
        candidates: 0,
        backups: 0,
      });
      await writer.query('UPDATE account_recovery_backup_evidence SET expires_at=$2 WHERE id=$1', [
        id,
        FUTURE,
      ]);
      await writer.query('COMMIT');
      expect(await clearExpiredAccountRecoverySecrets(db, NOW)).toEqual({
        candidates: 0,
        backups: 0,
      });
      expect((await facts(id)).backup?.ciphertext).toBe(ENCRYPTED);
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
    }
  });

  it('real graphile maintenance task clears secrets without provider or S3 calls', async () => {
    const id = await seed({ requestExpiry: new Date(0) });
    const send = vi.fn();
    const generate = vi.fn(async () => {
      throw new Error('Unexpected generation');
    });
    const taskList = createTaskList({
      db,
      s3: { send } as unknown as S3Client,
      generate,
      env: {
        PUBLIC_BASE_URL: 'https://app.example.test',
        NEW_API_BASE_URL: 'https://unused.example.test',
        CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
        S3_BUCKET: 'unused',
      },
    });
    await pool.query("SELECT graphile_worker.add_job('maintenance/cleanup', '{}'::json)");
    await runOnce({ pgPool: pool, taskList, concurrency: 1, noHandleSignals: true });
    expect((await facts(id)).backup).toMatchObject({ ciphertext: '', state: 'revoked' });
    expect((await facts(id)).request?.candidateCiphertext).toBe('');
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('caps a cleanup execution at 1000 rows per kind and a later execution drains the backlog', async () => {
    await seedBatch(1001, PAST, FUTURE);
    await clearExpiredAccountRecoverySecretBatches(db, NOW);
    expect(await remaining()).toEqual({ candidates: 1, backups: 1 });
    await clearExpiredAccountRecoverySecretBatches(db, NOW);
    expect(await remaining()).toEqual({ candidates: 0, backups: 0 });
    await clearExpiredAccountRecoverySecretBatches(db, NOW);
    for (const table of ['account_recovery_requests', 'account_recovery_backup_evidence']) {
      const result = await pool.query(
        `SELECT count(*)::int AS count, min(revision) AS min, max(revision) AS max FROM ${table}`,
      );
      expect(result.rows[0]).toEqual({ count: 1001, min: 2, max: 2 });
    }
  });

  it('continues a full backup batch when no candidate is expired', async () => {
    await seedBatch(150, FUTURE, PAST);
    await clearExpiredAccountRecoverySecretBatches(db, NOW);
    expect(await remaining()).toEqual({ candidates: 150, backups: 0 });
    const revisions = await pool.query('SELECT DISTINCT revision FROM account_recovery_requests');
    expect(revisions.rows).toEqual([{ revision: 1 }]);
  });
});
