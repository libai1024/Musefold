import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceBin, maintenanceStorage } from './fixtures/maintenance-bin.js';
import { maintenanceFacts, seedMaintenanceMatrix } from './fixtures/maintenance-matrix.js';
import { waitUntil } from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('production maintenance pause covers every persisted cleanup category', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof maintenanceStorage>>;
  const children: MaintenanceBin[] = [];
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE "user",object_cleanup_queue,object_key_retirements,sync_retention_state,rate_limit_buckets RESTART IDENTITY CASCADE',
    );
    storage = await maintenanceStorage();
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      await child.stop('SIGKILL');
      for (const privateValue of [
        'synthetic-maintenance-cipher-key',
        'synthetic-maintenance-storage-secret',
        'synthetic-candidate-ciphertext',
        'synthetic-backup-ciphertext',
        'Owned title',
        'Owned content',
        'users/owned-maintenance/',
      ])
        expect(child.output).not.toContain(privateValue);
    }
    expect(storage.state.unexpectedRequests).toBe(0);
    await storage.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  async function start(paused: boolean) {
    const child = new MaintenanceBin(container.getConnectionUri(), storage.url, paused);
    children.push(child);
    await child.ready();
    return child;
  }
  async function run(task = 'maintenance/cleanup') {
    const result = await database.pool.query<{ id: string }>(
      "SELECT (graphile_worker.add_job($1::text, '{}'::json, max_attempts := 1)).id::text AS id",
      [task],
    );
    const id = result.rows[0].id;
    await waitUntil(
      async () =>
        (await database.pool.query('SELECT id FROM graphile_worker.jobs WHERE id=$1::bigint', [id]))
          .rowCount === 0,
      'actual maintenance job completed',
    );
  }

  it('pauses both aliases with every table unchanged, then a new PID clears only expired data and reports exact committed counts', async () => {
    const { expiredKeys, liveKeys } = await seedMaintenanceMatrix(database.pool);
    for (const key of [...expiredKeys, ...liveKeys]) storage.objects.add(key);
    const before = await maintenanceFacts(database.pool);
    for (const [table, rows] of Object.entries(before))
      expect(rows.length, table).toBeGreaterThan(0);
    const paused = await start(true);
    for (const alias of ['maintenance/cleanup', 'maintenance.cleanup']) {
      await run(alias);
      expect(await maintenanceFacts(database.pool)).toEqual(before);
      expect(storage.deletions).toEqual([]);
      expect(storage.state.deleteRequests).toBe(0);
      expect([...storage.objects].sort()).toEqual([...expiredKeys, ...liveKeys].sort());
    }
    expect(paused.output).toContain('[maintenance] paused');
    expect(paused.stages()).toEqual([]);
    expect(await paused.stop()).toEqual({ code: 0, signal: null });
    const resumed = await start(false);
    expect(resumed.child.pid).not.toBe(paused.child.pid);
    await run();
    await waitUntil(() => resumed.stages().length >= 8, 'all resumed maintenance stage reports');
    expect(storage.deletions.sort()).toEqual(expiredKeys.sort());
    expect([...storage.objects].sort()).toEqual(liveKeys.sort());
    const after = await maintenanceFacts(database.pool);
    const liveRows = (rows: unknown[]) =>
      rows.filter((row) =>
        Object.values(row as Record<string, unknown>).some(
          (value) =>
            typeof value === 'string' &&
            (value === 'live' || value.endsWith('-live') || value.endsWith('/live')),
        ),
      );
    for (const table of Object.keys(before))
      expect(liveRows(after[table]), table).toEqual(liveRows(before[table]));
    for (const table of ['prompts', 'generation_runs', 'generation_assets'])
      expect(after[table]).toEqual(
        before[table].filter((row) => (row as { id: string }).id.endsWith('-live')),
      );
    expect(after.sync_devices).toEqual(before.sync_devices);
    expect(after.design_scheme_package_stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'package-expired', status: 'expired' }),
        expect.objectContaining({ id: 'package-live', status: 'ready' }),
      ]),
    );
    expect(after.design_scheme_source_files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ snapshot_id: 'source-expired', object_key: null }),
        expect.objectContaining({
          snapshot_id: 'source-live',
          object_key: liveKeys.find((key) => key.includes('/source/')),
        }),
      ]),
    );
    expect(after.account_recovery_requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'recovery-expired', candidate_ciphertext: '' }),
        expect.objectContaining({
          id: 'recovery-live',
          candidate_ciphertext: 'synthetic-candidate-ciphertext',
        }),
      ]),
    );
    expect(after.account_recovery_backup_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recovery-expired',
          ciphertext: '',
          state: 'revoked',
          provenance: { owned: true },
        }),
        expect.objectContaining({
          id: 'recovery-live',
          ciphertext: 'synthetic-backup-ciphertext',
          state: 'staged',
        }),
      ]),
    );
    expect(resumed.stages()).toEqual(
      expect.arrayContaining([
        { stage: 'package_stages', retired: 1 },
        { stage: 'source_preparations', retired: 1 },
        { stage: 'account_recovery', candidates: 1, backups: 1 },
        { stage: 'rate_limits', purged: 1 },
        { stage: 'generation_runs', purged: 1, queuedObjects: 1 },
        { stage: 'prompts', purged: 1 },
        expect.objectContaining({ stage: 'sync', purged: 2, changeLogs: 1, mutationResults: 1 }),
        { stage: 'objects', expiredReferences: 1, deleted: 5, protected: 0, failed: 0 },
      ]),
    );
    const count = resumed.stages().length;
    await run('maintenance.cleanup');
    await waitUntil(
      () => resumed.stages().length >= count + 8,
      'all no-op maintenance stage reports',
    );
    expect(storage.deletions).toHaveLength(5);
    for (const stage of resumed.stages().slice(count))
      for (const [key, value] of Object.entries(stage))
        if (key !== 'stage' && key !== 'minAvailableCursor') expect(value).toBe(0);
    expect(await resumed.stop()).toEqual({ code: 0, signal: null });
  }, 60_000);

  it('resumes bounded child cleanup after SIGKILL and a paused replacement without repeating completed rows', async () => {
    const { expiredKeys, liveKeys } = await seedMaintenanceMatrix(database.pool);
    const extraKeys = Array.from({ length: 1000 }, (_, i) => `owned/child/asset/${i + 1}`);
    for (const key of [...expiredKeys, ...liveKeys, ...extraKeys]) storage.objects.add(key);
    await database.pool.query(`INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
      SELECT 'bulk-asset-'||n,'run-expired','owned-maintenance','owned/child/asset/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(1,1000) n`);
    await database.pool.query(`INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
      SELECT 'owned-maintenance','bulk-usage-'||n,'prompt-expired','copy' FROM generate_series(1,1000) n`);
    const first = await start(false);
    await run();
    await waitUntil(() => first.stages().length >= 8, 'first child batch committed');
    expect(first.stages()).toEqual(
      expect.arrayContaining([
        { stage: 'generation_runs', purged: 0, queuedObjects: 1000 },
        { stage: 'prompts', purged: 0 },
      ]),
    );
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM generation_assets WHERE run_id='run-expired'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM prompt_usage_events WHERE prompt_id='prompt-expired'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await first.stop('SIGKILL')).toEqual({ code: null, signal: 'SIGKILL' });
    const beforePause = await maintenanceFacts(database.pool);
    const deletions = [...storage.deletions];
    const paused = await start(true);
    expect(paused.child.pid).not.toBe(first.child.pid);
    await run();
    expect(await maintenanceFacts(database.pool)).toEqual(beforePause);
    expect(storage.deletions).toEqual(deletions);
    expect(await paused.stop()).toEqual({ code: 0, signal: null });
    const resumed = await start(false);
    expect(resumed.child.pid).not.toBe(paused.child.pid);
    await run();
    await waitUntil(() => resumed.stages().length >= 8, 'remaining child batch committed');
    expect(resumed.stages()).toEqual(
      expect.arrayContaining([
        { stage: 'generation_runs', purged: 1, queuedObjects: 1 },
        { stage: 'prompts', purged: 1 },
      ]),
    );
    expect((await database.pool.query('SELECT id FROM generation_runs')).rows).toEqual([
      { id: 'run-live' },
    ]);
    expect((await database.pool.query('SELECT id FROM prompts')).rows).toEqual([
      { id: 'prompt-live' },
    ]);
    expect([...storage.objects].sort()).toEqual(liveKeys.sort());
    expect(storage.deletions.sort()).toEqual([...expiredKeys, ...extraKeys].sort());
    const count = resumed.stages().length;
    await run();
    await waitUntil(() => resumed.stages().length >= count + 8, 'completed child cleanup no-op');
    for (const stage of resumed.stages().slice(count))
      for (const [key, value] of Object.entries(stage))
        if (key !== 'stage' && key !== 'minAvailableCursor') expect(value).toBe(0);
    expect(await resumed.stop()).toEqual({ code: 0, signal: null });
  }, 60000);

  it('retains failed object deletions across restart, pauses even due retries, then resumes without repeating committed database cleanup', async () => {
    const { expiredKeys, liveKeys } = await seedMaintenanceMatrix(database.pool);
    for (const key of [...expiredKeys, ...liveKeys]) storage.objects.add(key);
    storage.state.failDeletes = true;
    const failedWorker = await start(false);
    const began = Date.now();
    await run();
    await waitUntil(() => failedWorker.stages().length >= 8, 'all failed-storage stage reports');
    expect(failedWorker.stages()).toEqual(
      expect.arrayContaining([
        { stage: 'objects', expiredReferences: 1, deleted: 0, protected: 0, failed: 5 },
        { stage: 'generation_runs', purged: 1, queuedObjects: 1 },
        { stage: 'prompts', purged: 1 },
      ]),
    );
    expect(storage.deletions).toEqual([]);
    expect([...storage.objects].sort()).toEqual([...expiredKeys, ...liveKeys].sort());
    const failed = (
      await database.pool.query(
        'SELECT * FROM object_cleanup_queue WHERE object_key=ANY($1::text[]) ORDER BY object_key',
        [expiredKeys],
      )
    ).rows;
    expect(failed).toHaveLength(5);
    for (const row of failed) {
      expect(row.attempt_count).toBe(1);
      expect(row.next_attempt_at.getTime()).toBeGreaterThanOrEqual(began + 299000);
      expect(row.last_error).not.toContain('Owned storage fault');
    }
    expect(
      (
        await database.pool.query(
          "SELECT id FROM generation_reference_uploads WHERE id LIKE '%-expired'",
        )
      ).rows,
    ).toHaveLength(2);
    expect(await failedWorker.stop()).toEqual({ code: 0, signal: null });
    // Advance only this fixture's persisted due time; this is not a natural five-minute wait test.
    await database.pool.query(
      "UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key=ANY($1::text[])",
      [expiredKeys],
    );
    storage.state.failDeletes = false;
    const beforePause = await maintenanceFacts(database.pool);
    const requests = storage.state.deleteRequests;
    const paused = await start(true);
    expect(paused.child.pid).not.toBe(failedWorker.child.pid);
    await run();
    expect(await maintenanceFacts(database.pool)).toEqual(beforePause);
    expect(storage.state.deleteRequests).toBe(requests);
    expect(await paused.stop()).toEqual({ code: 0, signal: null });
    const resumed = await start(false);
    expect(resumed.child.pid).not.toBe(paused.child.pid);
    await run();
    await waitUntil(() => resumed.stages().length >= 8, 'all recovered-storage stage reports');
    expect(storage.deletions.sort()).toEqual(expiredKeys.sort());
    expect([...storage.objects].sort()).toEqual(liveKeys.sort());
    expect(resumed.stages()).toEqual(
      expect.arrayContaining([
        { stage: 'generation_runs', purged: 0, queuedObjects: 0 },
        { stage: 'prompts', purged: 0 },
        { stage: 'objects', expiredReferences: 0, deleted: 5, protected: 0, failed: 0 },
      ]),
    );
    expect((await database.pool.query('SELECT object_key FROM object_cleanup_queue')).rows).toEqual(
      [{ object_key: 'users/owned-maintenance/queued/live' }],
    );
    expect(
      (
        await database.pool.query(
          "SELECT id FROM generation_reference_uploads WHERE id LIKE '%-expired'",
        )
      ).rows,
    ).toEqual([]);
    expect(await resumed.stop()).toEqual({ code: 0, signal: null });
  }, 60_000);
});
