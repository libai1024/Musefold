import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  type MusefoldTransaction,
} from '../../packages/db/src/index';
import { newPromptDocumentSchema } from '@musefold/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PromptService } from '../../apps/api/src/modules/prompts/service';
import { SyncService } from '../../apps/api/src/modules/sync/service';
import { trimExpiredSyncRecords } from '../../apps/worker/src/sync-retention';

const describeDb = ['true', '1'].includes(process.env.RUN_DATABASE_TESTS ?? '')
  ? describe
  : describe.skip;
const input = newPromptDocumentSchema.parse({
  title: 'Synthetic',
  description: null,
  content: 'Synthetic',
  negative: null,
  folderId: null,
  modelId: null,
  params: null,
});

describeDb('sync publication across real PostgreSQL commit order', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let reader: ReturnType<typeof createDatabase>;
  let prompts: PromptService;
  let sync: SyncService;
  let owner: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 5 });
    const url = new URL(container.getConnectionUri());
    url.searchParams.set('application_name', 'sync-publication-reader');
    reader = createDatabase(url.toString(), { max: 3 });
    await migrateDatabase(database.db);
    prompts = new PromptService(database.db);
    sync = new SyncService(reader.db, new PromptService(reader.db));
  }, 180_000);
  afterAll(async () => {
    await reader?.pool.end();
    await database?.pool.end();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user",sync_retention_state RESTART IDENTITY CASCADE');
    owner = randomUUID();
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3)', [
      owner,
      'Synthetic',
      `${owner}@example.test`,
    ]);
  });

  async function heldWrite(
    operation: (tx: MusefoldTransaction) => Promise<unknown>,
    rollback = false,
  ) {
    let release!: () => void;
    let written!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      written = resolve;
    });
    const done = database.db.transaction(async (tx) => {
      await operation(tx);
      written();
      await held;
      if (rollback) throw new Error('synthetic writer rollback');
    });
    void done.catch(() => {});
    try {
      await Promise.race([ready, done]);
    } catch (error) {
      release();
      throw error;
    }
    return { release, done };
  }

  // Observe either a completed pre-fix read or an actual PG lock wait. No long
  // arbitrary sleep and no expectation that a particular implementation must block.
  async function observe<T>(operation: Promise<T>) {
    let settled = false;
    const result = operation.finally(() => {
      settled = true;
    });
    void result.catch(() => {});
    const deadline = Date.now() + 1500;
    while (!settled && Date.now() < deadline) {
      const blocked = await database.pool.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name='sync-publication-reader' AND wait_event_type='Lock' LIMIT 1`);
      if (blocked.rowCount) break;
      await delay(10);
    }
    return { result };
  }

  it.each(['pull', 'bootstrap'] as const)(
    '%s cannot advance past a lower sequence that commits later',
    async (kind) => {
      const late = randomUUID(),
        early = randomUUID();
      const writer = await heldWrite((tx) => prompts.createPrompt(owner, input, late, { tx }));
      let pending: Promise<{ ids: string[]; cursor: string }> | undefined;
      try {
        // This must remain able to commit while A is open: no global writer mutex.
        await prompts.createPrompt(owner, input, early);
        pending =
          kind === 'pull'
            ? sync.pull(owner, '0', 100).then((page) => ({
                ids: page.changes.map((x) => x.entityId),
                cursor: page.nextCursor,
              }))
            : sync.bootstrap(owner, 'prompt', undefined, 100).then((page) => ({
                ids: page.items.map((x) => x.id),
                cursor: page.snapshotCursor,
              }));
        await observe(pending);
        writer.release();
        await writer.done;
        const first = await pending;
        const second = await sync.pull(owner, first.cursor, 100);
        expect(new Set([...first.ids, ...second.changes.map((x) => x.entityId)])).toEqual(
          new Set([late, early]),
        );
        expect(second.hasMore).toBe(false);
      } finally {
        writer.release();
        await writer.done;
        await pending?.catch(() => {});
      }
    },
  );

  it('a no-op trim cannot manufacture a published watermark from an uncommitted sequence gap', async () => {
    const late = randomUUID(),
      early = randomUUID();
    const writer = await heldWrite((tx) => prompts.createPrompt(owner, input, late, { tx }));
    let pending: ReturnType<typeof trimExpiredSyncRecords> | undefined;
    try {
      await prompts.createPrompt(owner, input, early);
      pending = trimExpiredSyncRecords(reader.db);
      await observe(pending);
      writer.release();
      await writer.done;
      expect(await pending).toEqual({
        purged: 0,
        changeLogs: 0,
        mutationResults: 0,
        minAvailableCursor: 0,
      });
      const page = await sync.pull(owner, '0', 100);
      expect(page.changes.map((x) => x.entityId)).toEqual([late, early]);
    } finally {
      writer.release();
      await writer.done;
      await pending?.catch(() => {});
    }
  });

  it('a rolled-back lower sequence does not hide the later committed change', async () => {
    const late = randomUUID(),
      early = randomUUID();
    const writer = await heldWrite((tx) => prompts.createPrompt(owner, input, late, { tx }), true);
    let pending: ReturnType<SyncService['pull']> | undefined;
    try {
      await prompts.createPrompt(owner, input, early);
      pending = sync.pull(owner, '0', 100);
      await observe(pending);
      writer.release();
      await expect(writer.done).rejects.toThrow('synthetic writer rollback');
      const page = await pending;
      expect(page.changes.map((x) => x.entityId)).toEqual([early]);
      expect(page.nextCursor).toBe('2');
      expect((await sync.pull(owner, page.nextCursor, 100)).changes).toEqual([]);
    } finally {
      writer.release();
      await writer.done.catch(() => {});
      await pending?.catch(() => {});
    }
  });

  it('cross-owner trimming preserves a late owner in bootstrap without leaking the other owner', async () => {
    const other = randomUUID(),
      late = randomUUID();
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$2,$3)', [
      other,
      'Other',
      `${other}@example.test`,
    ]);
    const writer = await heldWrite((tx) => prompts.createPrompt(owner, input, late, { tx }));
    let pending: ReturnType<typeof trimExpiredSyncRecords> | undefined;
    try {
      await prompts.createPrompt(other, input);
      await database.pool.query(
        "UPDATE sync_change_log SET created_at=now()-interval '91 days' WHERE user_id=$1",
        [other],
      );
      pending = trimExpiredSyncRecords(reader.db);
      await observe(pending);
      writer.release();
      await writer.done;
      expect(await pending).toMatchObject({ changeLogs: 1, minAvailableCursor: 2 });
      await expect(sync.pull(owner, '0', 100)).rejects.toMatchObject({
        code: 'SYNC_CURSOR_EXPIRED',
        status: 410,
      });
      const page = await sync.bootstrap(owner, 'prompt', undefined, 100);
      expect(page.items.map((x) => x.id)).toEqual([late]);
      expect(page.snapshotCursor).toBe('2');
      expect((await sync.pull(owner, page.snapshotCursor, 100)).changes).toEqual([]);
    } finally {
      writer.release();
      await writer.done;
      await pending?.catch(() => {});
    }
  });

  it('long-running writers produce a bounded retryable error without advancing the device cursor', async () => {
    const deviceId = randomUUID(),
      late = randomUUID();
    await sync.registerDevice(owner, {
      deviceId,
      name: 'Synthetic',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    const before = (await database.pool.query('SELECT * FROM sync_devices')).rows;
    const timeout = (await reader.pool.query('SHOW lock_timeout')).rows;
    const writer = await heldWrite((tx) => prompts.createPrompt(owner, input, late, { tx }));
    try {
      await expect(sync.pull(owner, '0', 100, deviceId)).rejects.toMatchObject({
        status: 503,
        retryable: true,
      });
      expect((await database.pool.query('SELECT * FROM sync_devices')).rows).toEqual(before);
      writer.release();
      await writer.done;
      expect((await sync.pull(owner, '0', 100, deviceId)).changes.map((x) => x.entityId)).toEqual([
        late,
      ]);
      expect((await reader.pool.query('SHOW lock_timeout')).rows).toEqual(timeout);
    } finally {
      writer.release();
      await writer.done;
    }
  }, 10_000);

  it('push waits at the publication boundary before taking a device lock and remains retryable', async () => {
    const deviceId = randomUUID(),
      id = randomUUID();
    await sync.registerDevice(owner, {
      deviceId,
      name: 'Synthetic',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    const holder = await database.pool.connect();
    let pending: ReturnType<SyncService['push']> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE sync_change_log IN SHARE MODE');
      pending = sync.push(owner, deviceId, [
        {
          mutationId: randomUUID(),
          entityType: 'prompt',
          entityId: id,
          operation: 'create',
          baseVersion: null,
          payload: input,
        },
      ]);
      await observe(pending);
      // A reader holding the boundary may now update this device without a lock cycle.
      await holder.query('SELECT * FROM sync_devices WHERE device_id=$1 FOR UPDATE NOWAIT', [
        deviceId,
      ]);
      await holder.query('COMMIT');
      expect((await pending).results[0]).toMatchObject({ status: 'applied' });
      expect((await sync.pull(owner, '0', 100, deviceId)).changes.map((x) => x.entityId)).toEqual([
        id,
      ]);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await pending?.catch(() => {});
    }
  });
});
