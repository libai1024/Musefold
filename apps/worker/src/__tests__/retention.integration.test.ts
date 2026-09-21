import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  type MusefoldDatabase,
  createDatabase,
  migrateDatabase,
  promptFolders,
  promptTagLinks,
  promptTags,
  promptUsageEvents,
  prompts,
  syncChangeLog,
  syncDevices,
  syncMutationResults,
  syncRetentionState,
  user,
} from '@musefold/db';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedPrompts } from '../retention.js';
import { trimExpiredSyncRecords } from '../sync-retention.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

const USER_ID = 'user-worker-retention';
const NOW = new Date('2026-09-07T00:00:00.000Z');

describeDb('D02-b 第二刀(真 PostgreSQL):提示词 30 天硬删 + sync 90 天裁剪', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const created = createDatabase(container.getConnectionUri(), { max: 5 });
    db = created.db;
    pool = created.pool;
    await migrateDatabase(db);
    await db.insert(user).values({
      id: USER_ID,
      name: 'Retention Tester',
      email: 'retention@test.local',
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('过期软删提示词硬删,未到期/未软删与 folder/tag 保留', async () => {
    const folderId = 'folder-keep';
    const tagId = 'tag-keep';
    const expiredId = 'prompt-expired';
    const recentTrashId = 'prompt-recent-trash';
    const liveId = 'prompt-live';
    await db.insert(promptFolders).values({
      id: folderId,
      userId: USER_ID,
      name: '保留文件夹',
    });
    await db.insert(promptTags).values({
      id: tagId,
      userId: USER_ID,
      name: '保留标签',
    });
    await db.insert(prompts).values([
      {
        id: expiredId,
        userId: USER_ID,
        title: '过期回收',
        content: 'gone',
        folderId,
        deletedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: recentTrashId,
        userId: USER_ID,
        title: '未满 30 天',
        content: 'keep trash',
        folderId,
        deletedAt: new Date('2026-09-06T00:00:00.000Z'),
      },
      {
        id: liveId,
        userId: USER_ID,
        title: '在用',
        content: 'keep live',
        folderId,
      },
    ]);
    await db.insert(promptTagLinks).values({ promptId: expiredId, tagId });

    const first = await purgeExpiredSoftDeletedPrompts(db, NOW);
    expect(first).toEqual({ purged: 1 });
    const second = await purgeExpiredSoftDeletedPrompts(db, NOW);
    expect(second).toEqual({ purged: 0 });

    const remaining = await db.select({ id: prompts.id }).from(prompts);
    expect(remaining.map((row) => row.id).sort()).toEqual([liveId, recentTrashId]);
    expect(await db.select().from(promptFolders)).toHaveLength(1);
    expect(await db.select().from(promptTags)).toHaveLength(1);
    expect(await db.select().from(promptTagLinks)).toHaveLength(0);
  });

  it('过期 sync 行裁剪并抬水位,未到期与设备保留,第二次 no-op', async () => {
    await db.insert(syncDevices).values({
      userId: USER_ID,
      deviceId: 'device-keep',
      name: '保留设备',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    await db.insert(syncChangeLog).values([
      {
        userId: USER_ID,
        entityType: 'prompt',
        entityId: 'old-1',
        operation: 'upsert',
        version: 1,
        snapshot: { id: 'old-1' },
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        userId: USER_ID,
        entityType: 'prompt',
        entityId: 'fresh-1',
        operation: 'upsert',
        version: 1,
        snapshot: { id: 'fresh-1' },
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    await db.insert(syncMutationResults).values([
      {
        userId: USER_ID,
        deviceId: 'device-keep',
        mutationId: 'mut-old',
        entityType: 'prompt',
        entityId: 'old-1',
        resultStatus: 'applied',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        userId: USER_ID,
        deviceId: 'device-keep',
        mutationId: 'mut-fresh',
        entityType: 'prompt',
        entityId: 'fresh-1',
        resultStatus: 'applied',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    const first = await trimExpiredSyncRecords(db, NOW);
    expect(first.purged).toBe(2);
    expect(first.changeLogs).toBe(1);
    expect(first.mutationResults).toBe(1);
    const surviving = await db.select({ seq: syncChangeLog.seq }).from(syncChangeLog);
    expect(surviving).toHaveLength(1);
    expect(first.minAvailableCursor).toBe((surviving[0]?.seq ?? 0) - 1);

    const second = await trimExpiredSyncRecords(db, NOW);
    expect(second).toEqual({
      purged: 0,
      changeLogs: 0,
      mutationResults: 0,
      minAvailableCursor: first.minAvailableCursor,
    });

    const mutations = await db.select().from(syncMutationResults);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.mutationId).toBe('mut-fresh');
    expect(await db.select().from(syncDevices)).toHaveLength(1);
    const watermark = await db.select().from(syncRetentionState);
    expect(watermark[0]?.minAvailableCursor).toBe(first.minAvailableCursor);
    expect(
      await db.select().from(syncChangeLog).where(eq(syncChangeLog.entityId, 'old-1')),
    ).toEqual([]);
  });

  it('a committed restore survives a purge that began against its old deleted state, including usage', async () => {
    const id = 'restore-before-retention';
    await db.insert(prompts).values({
      id,
      userId: USER_ID,
      title: 'Restored fixture',
      content: 'preserve restored content',
      deletedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await db
      .insert(promptUsageEvents)
      .values({ userId: USER_ID, eventId: 'restore-usage', promptId: id, action: 'copy' });
    const holder = await pool.connect();
    let pending: ReturnType<typeof purgeExpiredSoftDeletedPrompts> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM prompts WHERE id=$1 FOR UPDATE', [id]);
      const {
        rows: [{ pid }],
      } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pending = purgeExpiredSoftDeletedPrompts(db, NOW);
      void pending.catch(() => undefined);
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const { rows } = await pool.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (rows[0].n > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await holder.query('UPDATE prompts SET deleted_at=NULL,version=version+1 WHERE id=$1', [id]);
      await holder.query('COMMIT');
      const result = await pending;
      const remaining = await db.select().from(prompts).where(eq(prompts.id, id));
      const usage = await db
        .select()
        .from(promptUsageEvents)
        .where(eq(promptUsageEvents.promptId, id));
      console.info(
        'RETENTION_RESTORE',
        JSON.stringify({ purged: result.purged, remaining: remaining.length, usage: usage.length }),
      );
      expect(result).toEqual({ purged: 0 });
      expect(remaining).toMatchObject([
        { id, deletedAt: null, content: 'preserve restored content', version: 2 },
      ]);
      expect(usage).toHaveLength(1);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await pending?.catch(() => undefined);
    }
  }, 15000);
});
