import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  user,
  type MusefoldDatabase,
  type MusefoldTransaction,
} from '@musefold/db';
import { newPromptDocumentSchema, syncBootstrapPageSchema } from '@musefold/contracts';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PromptService } from '../../modules/prompts/service.js';
import { SyncService } from '../../modules/sync/service.js';
import { runPromptRetentionProcess } from '../fixtures/sync-retention-runner.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const kinds = ['folder', 'tag'] as const;
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}
function observe<T>(promise: Promise<T>) {
  const state = { settled: false };
  const result = promise
    .then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    )
    .finally(() => {
      state.settled = true;
    });
  return { state, result };
}

describeDb('permanent cloud classification deletion and real reference locks', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let service: PromptService;
  let sync: SyncService;
  let owner: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri(), { max: 8 }));
    await migrateDatabase(db);
    service = new PromptService(db);
    sync = new SyncService(db, service);
  }, 180_000);
  beforeEach(async () => {
    await pool.query('DELETE FROM "user"');
    owner = randomUUID();
    await db
      .insert(user)
      .values({ id: owner, name: 'Synthetic classification', email: `${owner}@example.test` });
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
  const create = (kind: (typeof kinds)[number], id: string = randomUUID()) =>
    kind === 'folder'
      ? service.createFolder(
          owner,
          { name: `Folder ${id.slice(0, 8)}`, parentId: null, sortOrder: 0 },
          id,
        )
      : service.createTag(owner, { name: `Tag ${id.slice(0, 8)}`, group: null, color: null }, id);
  const remove = (kind: (typeof kinds)[number], id: string, version?: number) =>
    kind === 'folder'
      ? service.deleteFolder(owner, id, version)
      : service.deleteTag(owner, id, version);
  const restore = (kind: (typeof kinds)[number], id: string, version?: number) =>
    kind === 'folder'
      ? service.restoreFolder(owner, id, version)
      : service.restoreTag(owner, id, version);
  async function physicalRows(kind: (typeof kinds)[number], id: string) {
    // Table choice is fixed by this test, never user input.
    const query =
      kind === 'folder'
        ? 'SELECT id FROM prompt_folders WHERE user_id=$1 AND id=$2'
        : 'SELECT id FROM prompt_tags WHERE user_id=$1 AND id=$2';
    return (await pool.query(query, [owner, id])).rows;
  }
  async function child(
    kind: 'prompt' | 'folder',
    parentId: string,
    id: string,
    tx?: MusefoldTransaction,
  ) {
    const context = tx ? { tx } : undefined;
    return kind === 'folder'
      ? service.createFolder(
          owner,
          { name: `Child ${id.slice(0, 8)}`, parentId, sortOrder: 0 },
          id,
          context,
        )
      : service.createPrompt(
          owner,
          newPromptDocumentSchema.parse({
            title: 'Retained child prompt',
            content: 'Retained synthetic body',
            description: null,
            negative: null,
            folderId: parentId,
            tagIds: [],
            modelId: null,
            params: null,
          }),
          id,
          context,
        );
  }
  async function assertBlockedBy(pid: number, state: { settled: boolean }) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await pool.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))',
        [pid],
      );
      if (rows.rows[0].n > 0) return;
      if (state.settled)
        throw new Error('Reference/deletion committed without waiting for the open transaction');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Expected real PostgreSQL transaction lock was not observed');
  }

  it.each(kinds)(
    '%s deletion removes the physical entity and remains visible as a compatible bootstrap deletion',
    async (kind) => {
      const entity = await create(kind);
      const deleted = await remove(kind, entity.id, entity.version);
      expect(deleted).toMatchObject({
        id: entity.id,
        version: entity.version + 1,
        deletedAt: expect.any(String),
      });
      expect(await physicalRows(kind, entity.id)).toEqual([]);
      const page = syncBootstrapPageSchema.parse(await sync.bootstrap(owner, kind, undefined, 1));
      expect(page.items).toEqual([
        expect.objectContaining({
          id: entity.id,
          version: deleted.version,
          deletedAt: deleted.deletedAt,
        }),
      ]);
      expect(page.nextPage).toBeNull();
    },
  );

  it.each(kinds)(
    '%s restore and requested-ID recreation cannot reverse an accepted deletion',
    async (kind) => {
      const entity = await create(kind);
      const deleted = await remove(kind, entity.id, entity.version);
      await expect(restore(kind, entity.id, deleted.version)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(create(kind, entity.id)).rejects.toMatchObject({
        code: 'PROMPT_VERSION_CONFLICT',
      });
      expect(await physicalRows(kind, entity.id)).toEqual([]);
    },
  );

  it('deleting a folder preserves child, grandchild, live/deleted prompts and exact current versions', async () => {
    const parent = await create('folder');
    const nested = await service.createFolder(owner, {
      name: 'Child',
      parentId: parent.id,
      sortOrder: 0,
    });
    const grandchild = await service.createFolder(owner, {
      name: 'Grandchild',
      parentId: nested.id,
      sortOrder: 0,
    });
    const live = await child('prompt', parent.id, randomUUID());
    const trashed = await child('prompt', parent.id, randomUUID());
    await service.deletePrompt(owner, trashed.id, trashed.version);
    const before = await service.getPrompt(owner, trashed.id);
    await remove('folder', parent.id, parent.version);
    expect(await physicalRows('folder', parent.id)).toEqual([]);
    expect(await service.getFolder(owner, nested.id)).toMatchObject({
      parentId: null,
      version: nested.version + 1,
    });
    expect(await service.getFolder(owner, grandchild.id)).toEqual(grandchild);
    expect(await service.getPrompt(owner, live.id)).toMatchObject({
      folderId: null,
      content: 'Retained synthetic body',
      deletedAt: null,
      version: live.version + 1,
    });
    expect(await service.getPrompt(owner, trashed.id)).toMatchObject({
      folderId: null,
      content: before.content,
      deletedAt: before.deletedAt,
      version: before.version + 1,
    });
  });

  it.each(['prompt', 'folder'] as const)(
    '%s reference commits first: deletion waits and then detaches that committed reference',
    async (kind) => {
      const parent = await create('folder');
      const id = randomUUID();
      const ready = barrier<number>();
      const release = barrier<void>();
      const creation = observe(
        db.transaction(async (tx) => {
          const result = await child(kind, parent.id, id, tx);
          ready.resolve(
            (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid,
          );
          await release.promise;
          return result;
        }),
      );
      let deletion: ReturnType<typeof observe<unknown>> | undefined;
      try {
        const pid = await Promise.race([
          ready.promise,
          creation.result.then(() => {
            throw new Error('Creation failed before transaction barrier');
          }),
        ]);
        deletion = observe<unknown>(remove('folder', parent.id, parent.version));
        await assertBlockedBy(pid, deletion.state);
        release.resolve();
        expect((await creation.result).status).toBe('fulfilled');
        expect((await deletion.result).status).toBe('fulfilled');
        expect(await physicalRows('folder', parent.id)).toEqual([]);
        if (kind === 'folder')
          expect(await service.getFolder(owner, id)).toMatchObject({ parentId: null });
        else
          expect(await service.getPrompt(owner, id)).toMatchObject({
            folderId: null,
            content: 'Retained synthetic body',
          });
      } finally {
        release.resolve();
        await creation.result;
        await deletion?.result;
      }
    },
  );

  it.each(['prompt', 'folder'] as const)(
    '%s reference arrives during deletion: it waits then rejects the removed parent',
    async (kind) => {
      const parent = await create('folder');
      const id = randomUUID();
      const ready = barrier<number>();
      const release = barrier<void>();
      const deletion = observe(
        db.transaction(async (tx) => {
          const result = await service.deleteFolder(owner, parent.id, parent.version, { tx });
          ready.resolve(
            (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid,
          );
          await release.promise;
          return result;
        }),
      );
      let creation: ReturnType<typeof observe<unknown>> | undefined;
      try {
        const pid = await Promise.race([
          ready.promise,
          deletion.result.then(() => {
            throw new Error('Deletion failed before transaction barrier');
          }),
        ]);
        creation = observe(child(kind, parent.id, id));
        await assertBlockedBy(pid, creation.state);
        release.resolve();
        expect((await deletion.result).status).toBe('fulfilled');
        expect(await creation.result).toMatchObject({
          status: 'rejected',
          reason: { code: 'VALIDATION_FAILED' },
        });
        expect(await physicalRows('folder', parent.id)).toEqual([]);
        if (kind === 'folder') expect(await physicalRows('folder', id)).toEqual([]);
        else
          expect(
            (await pool.query('SELECT id FROM prompts WHERE user_id=$1 AND id=$2', [owner, id]))
              .rows,
          ).toEqual([]);
      } finally {
        release.resolve();
        await deletion.result;
        await creation?.result;
      }
    },
  );

  async function facts() {
    const tables = [
      'prompt_folders',
      'prompt_tags',
      'prompts',
      'prompt_tag_links',
      'sync_taxonomy_tombstones',
      'sync_change_log',
      'sync_mutation_results',
    ];
    return Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (
            await pool.query(
              `SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`,
            )
          ).rows,
        ]),
      ),
    );
  }
  async function taggedPrompt(tagIds: string[], tx?: MusefoldTransaction) {
    return service.createPrompt(
      owner,
      newPromptDocumentSchema.parse({
        title: 'Retained tagged prompt',
        content: 'Keep full body',
        description: null,
        negative: null,
        folderId: null,
        tagIds,
        modelId: null,
        params: null,
      }),
      randomUUID(),
      tx ? { tx } : undefined,
    );
  }
  async function pair(
    first: (tx: MusefoldTransaction) => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    const ready = barrier<number>();
    const release = barrier<void>();
    const running = observe(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        const result = await first(tx);
        ready.resolve(
          (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid,
        );
        await release.promise;
        return result;
      }),
    );
    let pending: ReturnType<typeof observe<unknown>> | undefined;
    try {
      const pid = await Promise.race([
        ready.promise,
        running.result.then(() => {
          throw new Error('First transaction failed before the barrier');
        }),
      ]);
      pending = observe(second());
      await assertBlockedBy(pid, pending.state);
      release.resolve();
      expect((await running.result).status).toBe('fulfilled');
      return await pending.result;
    } finally {
      release.resolve();
      await running.result;
      await pending?.result;
    }
  }

  it.each(kinds)(
    '%s stale versions and repeated deletion have stable results and no extra writes',
    async (kind) => {
      const entity = await create(kind);
      const before = await facts();
      await expect(remove(kind, entity.id, entity.version + 1)).rejects.toMatchObject({
        code: 'PROMPT_VERSION_CONFLICT',
      });
      expect(await facts()).toEqual(before);
      const deleted = await remove(kind, entity.id, entity.version);
      const after = await facts();
      for (const version of [undefined, deleted.version]) {
        expect(await remove(kind, entity.id, version)).toMatchObject({
          id: entity.id,
          version: deleted.version,
          deletedAt: deleted.deletedAt,
        });
        expect(await facts()).toEqual(after);
      }
      await expect(remove(kind, entity.id, entity.version)).rejects.toMatchObject({
        code: 'PROMPT_VERSION_CONFLICT',
      });
      const update =
        kind === 'folder'
          ? service.updateFolder(owner, entity.id, {
              expectedVersion: deleted.version,
              name: 'No resurrection',
            })
          : service.updateTag(owner, entity.id, {
              expectedVersion: deleted.version,
              name: 'No resurrection',
            });
      await expect(update).rejects.toMatchObject({ code: 'PROMPT_VERSION_CONFLICT' });
      expect(await facts()).toEqual(after);
    },
  );

  for (const kind of kinds) {
    for (const stage of ['detach', 'marker', 'entity', 'log'] as const) {
      it(`${kind} ${stage} failure rolls back references, versions, physical deletion, marker and sync log`, async () => {
        const entity = await create(kind);
        if (kind === 'folder') {
          await child('folder', entity.id, randomUUID());
          await child('prompt', entity.id, randomUUID());
        } else {
          const otherTag = await create('tag');
          await taggedPrompt([entity.id, otherTag.id]);
        }
        const table =
          stage === 'detach'
            ? 'prompts'
            : stage === 'marker'
              ? 'sync_taxonomy_tombstones'
              : stage === 'log'
                ? 'sync_change_log'
                : kind === 'folder'
                  ? 'prompt_folders'
                  : 'prompt_tags';
        const event = stage === 'detach' ? 'UPDATE' : stage === 'entity' ? 'DELETE' : 'INSERT';
        const predicate = stage === 'log' ? `NEW.entity_type = '${kind}'` : 'true';
        // Fixed test-only SQL in an owned database; sequence records a trigger hit even after rollback.
        await pool.query('CREATE SEQUENCE classification_fault_hit');
        await pool.query(`CREATE FUNCTION classification_fault() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM nextval('classification_fault_hit'); RAISE EXCEPTION 'classification fault'; END $$`);
        await pool.query(`CREATE TRIGGER classification_fault AFTER ${event} ON ${table}
          FOR EACH ROW WHEN (${predicate}) EXECUTE FUNCTION classification_fault()`);
        try {
          const before = await facts();
          await expect(remove(kind, entity.id, entity.version)).rejects.toThrow();
          expect((await pool.query('SELECT is_called FROM classification_fault_hit')).rows).toEqual(
            [{ is_called: true }],
          );
          expect(await facts()).toEqual(before);
        } finally {
          await pool.query(`DROP TRIGGER classification_fault ON ${table}`);
          await pool.query('DROP FUNCTION classification_fault()');
          await pool.query('DROP SEQUENCE classification_fault_hit');
        }
        await remove(kind, entity.id, entity.version);
        expect(await physicalRows(kind, entity.id)).toEqual([]);
      });
    }
  }

  for (const reference of ['create', 'update'] as const) {
    for (const order of ['reference-first', 'delete-first'] as const) {
      it(`tag ${reference} ${order}: real row locks reject late references and retain unrelated tags`, async () => {
        const target = await create('tag');
        const other = await create('tag');
        const prompt = await taggedPrompt([other.id]);
        const write = (tx?: MusefoldTransaction) =>
          reference === 'create'
            ? taggedPrompt([target.id, other.id], tx)
            : service.updatePrompt(
                owner,
                prompt.id,
                { expectedVersion: prompt.version, tagIds: [target.id, other.id] },
                tx ? { tx } : undefined,
              );
        const deletion = (tx?: MusefoldTransaction) =>
          service.deleteTag(owner, target.id, target.version, tx ? { tx } : undefined);
        if (order === 'reference-first') {
          const result = await pair(write, deletion);
          expect(result.status).toBe('fulfilled');
        } else {
          const result = await pair(deletion, write);
          expect(result).toMatchObject({
            status: 'rejected',
            reason: { code: 'VALIDATION_FAILED' },
          });
        }
        expect(await physicalRows('tag', target.id)).toEqual([]);
        expect(await service.getTag(owner, other.id)).toEqual(other);
        const ids = (
          await pool.query<{ id: string }>('SELECT id FROM prompts WHERE user_id=$1 ORDER BY id', [
            owner,
          ])
        ).rows;
        expect(ids).toHaveLength(reference === 'create' && order === 'reference-first' ? 2 : 1);
        for (const row of ids)
          expect(await service.getPrompt(owner, row.id)).toMatchObject({
            content: 'Keep full body',
            tags: [expect.objectContaining({ id: other.id })],
          });
      }, 20000);
    }
  }

  for (const kind of kinds) {
    for (const purge of ['single', 'empty'] as const) {
      for (const order of ['purge-first', 'delete-first'] as const) {
        it(`${kind} deletion versus ${purge} Prompt purge (${order}) commits without deadlock or missing-row snapshot`, async () => {
          const entity = await create(kind);
          const prompt =
            kind === 'folder'
              ? await child('prompt', entity.id, randomUUID())
              : await taggedPrompt([entity.id]);
          await service.deletePrompt(owner, prompt.id, prompt.version);
          const deletion = (tx?: MusefoldTransaction) =>
            kind === 'folder'
              ? service.deleteFolder(owner, entity.id, entity.version, tx ? { tx } : undefined)
              : service.deleteTag(owner, entity.id, entity.version, tx ? { tx } : undefined);
          const cleanup = (tx?: MusefoldTransaction) =>
            purge === 'single'
              ? service.purgePrompt(owner, prompt.id, tx ? { tx } : undefined)
              : service.emptyTrash(owner, tx ? { tx } : undefined);
          const result =
            order === 'purge-first' ? await pair(cleanup, deletion) : await pair(deletion, cleanup);
          expect(result.status).toBe('fulfilled');
          expect(await physicalRows(kind, entity.id)).toEqual([]);
          expect(
            (await pool.query('SELECT id FROM prompts WHERE id=$1', [prompt.id])).rows,
          ).toEqual([]);
          expect(
            (await pool.query('SELECT * FROM prompt_tag_links WHERE prompt_id=$1', [prompt.id]))
              .rows,
          ).toEqual([]);
          expect(
            (
              await pool.query(
                'SELECT version FROM sync_taxonomy_tombstones WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3',
                [owner, kind, entity.id],
              )
            ).rows,
          ).toEqual([{ version: entity.version + 1 }]);
          const logs = (
            await pool.query(
              'SELECT operation,version::integer AS version FROM sync_change_log WHERE user_id=$1 AND entity_id=$2 ORDER BY seq',
              [owner, prompt.id],
            )
          ).rows;
          expect(logs.at(-1)).toEqual({
            operation: 'delete',
            version: order === 'delete-first' ? 4 : 3,
          });
          expect(logs).toHaveLength(order === 'delete-first' ? 4 : 3);
        }, 20000);
      }
    }
  }

  for (const kind of kinds) {
    for (const order of ['worker-first', 'delete-first'] as const) {
      it(`${kind} deletion versus real worker retention process (${order}) preserves surviving content`, async () => {
        const entity = await create(kind);
        const prompt =
          kind === 'folder'
            ? await child('prompt', entity.id, randomUUID())
            : await taggedPrompt([entity.id]);
        const survivor =
          kind === 'folder'
            ? await child('prompt', entity.id, randomUUID())
            : await taggedPrompt([entity.id]);
        await service.deletePrompt(owner, prompt.id, prompt.version);
        await pool.query("UPDATE prompts SET deleted_at='2026-08-01T00:00:00Z' WHERE id=$1", [
          prompt.id,
        ]);
        const deletion = (tx?: MusefoldTransaction) =>
          kind === 'folder'
            ? service.deleteFolder(owner, entity.id, entity.version, tx ? { tx } : undefined)
            : service.deleteTag(owner, entity.id, entity.version, tx ? { tx } : undefined);
        const maintenance = () =>
          runPromptRetentionProcess(container.getConnectionUri(), new Date('2026-09-13T00:00:00Z'));
        if (order === 'delete-first') {
          const result = await pair(deletion, maintenance);
          expect(result).toMatchObject({
            status: 'fulfilled',
            value: { pid: expect.any(Number), stats: { purged: 1 } },
          });
        } else {
          const controller = await pool.connect();
          await controller.query('SELECT pg_advisory_lock(754321)');
          const controllerPid = (
            await controller.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
          ).rows[0].pid;
          await pool.query(`CREATE FUNCTION classification_maintenance_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN PERFORM pg_advisory_xact_lock(754321); RETURN OLD; END $$`);
          await pool.query(
            'CREATE TRIGGER classification_maintenance_barrier AFTER DELETE ON prompts FOR EACH ROW EXECUTE FUNCTION classification_maintenance_barrier()',
          );
          const running = observe(maintenance());
          let pending: ReturnType<typeof observe<unknown>> | undefined;
          try {
            let workerPid: number | undefined;
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
              const waiting = await pool.query<{ pid: number }>(
                'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))',
                [controllerPid],
              );
              workerPid = waiting.rows[0]?.pid;
              if (workerPid) break;
              if (running.state.settled)
                throw new Error('Worker exited before the post-delete barrier');
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(workerPid).toBeDefined();
            pending = observe<unknown>(deletion());
            await assertBlockedBy(workerPid as number, pending.state);
            await controller.query('SELECT pg_advisory_unlock(754321)');
            expect(await running.result).toMatchObject({
              status: 'fulfilled',
              value: { pid: expect.any(Number), stats: { purged: 1 } },
            });
            expect((await pending.result).status).toBe('fulfilled');
          } finally {
            await controller.query('SELECT pg_advisory_unlock(754321)');
            await running.result;
            await pending?.result;
            await pool.query('DROP TRIGGER classification_maintenance_barrier ON prompts');
            await pool.query('DROP FUNCTION classification_maintenance_barrier()');
            controller.release();
          }
        }
        expect(await physicalRows(kind, entity.id)).toEqual([]);
        expect((await pool.query('SELECT id FROM prompts WHERE id=$1', [prompt.id])).rows).toEqual(
          [],
        );
        expect(await service.getPrompt(owner, survivor.id)).toMatchObject({
          content: kind === 'folder' ? 'Retained synthetic body' : 'Keep full body',
          folderId: null,
          tags: [],
          deletedAt: null,
          version: survivor.version + 1,
        });
        expect(
          (
            await pool.query(
              'SELECT version FROM sync_taxonomy_tombstones WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3',
              [owner, kind, entity.id],
            )
          ).rows,
        ).toEqual([{ version: entity.version + 1 }]);
      }, 30000);
    }
  }

  it.each(kinds)(
    '%s other-owner reads, deletes and updates cannot disclose or mutate live or deleted identities',
    async (kind) => {
      const entity = await create(kind);
      const other = randomUUID();
      await db
        .insert(user)
        .values({ id: other, name: 'Other synthetic owner', email: `${other}@example.test` });
      const read = () =>
        kind === 'folder' ? service.getFolder(other, entity.id) : service.getTag(other, entity.id);
      const erase = () =>
        kind === 'folder'
          ? service.deleteFolder(other, entity.id, entity.version)
          : service.deleteTag(other, entity.id, entity.version);
      const update = () =>
        kind === 'folder'
          ? service.updateFolder(other, entity.id, {
              name: 'Unauthorized',
              expectedVersion: entity.version,
            })
          : service.updateTag(other, entity.id, {
              name: 'Unauthorized',
              expectedVersion: entity.version,
            });
      for (const state of ['live', 'deleted'] as const) {
        if (state === 'deleted') await remove(kind, entity.id, entity.version);
        const before = await facts();
        for (const operation of [read, erase, update])
          await expect(operation()).rejects.toMatchObject({ status: 404 });
        expect(
          syncBootstrapPageSchema.parse(await sync.bootstrap(other, kind, undefined, 10)).items,
        ).toEqual([]);
        expect(await facts()).toEqual(before);
      }
    },
  );

  for (const reference of ['prompt', 'folder'] as const) {
    for (const order of ['reference-first', 'delete-first'] as const) {
      it(`${reference} moving into parent (${order}) cannot create a dangling reference`, async () => {
        const target = await create('folder');
        const entity = reference === 'folder' ? await create('folder') : await taggedPrompt([]);
        const write = (tx?: MusefoldTransaction) =>
          reference === 'folder'
            ? service.updateFolder(
                owner,
                entity.id,
                { expectedVersion: entity.version, parentId: target.id },
                tx ? { tx } : undefined,
              )
            : service.updatePrompt(
                owner,
                entity.id,
                { expectedVersion: entity.version, folderId: target.id },
                tx ? { tx } : undefined,
              );
        const deletion = (tx?: MusefoldTransaction) =>
          service.deleteFolder(owner, target.id, target.version, tx ? { tx } : undefined);
        if (order === 'reference-first')
          expect((await pair(write, deletion)).status).toBe('fulfilled');
        else
          expect(await pair(deletion, write)).toMatchObject({
            status: 'rejected',
            reason: { code: 'VALIDATION_FAILED' },
          });
        expect(await physicalRows('folder', target.id)).toEqual([]);
        const current =
          reference === 'folder'
            ? await service.getFolder(owner, entity.id)
            : await service.getPrompt(owner, entity.id);
        expect(current).toMatchObject({
          ...(reference === 'folder'
            ? { parentId: null }
            : { folderId: null, content: 'Keep full body' }),
          version: order === 'reference-first' ? entity.version + 2 : entity.version,
        });
      }, 20000);
    }
  }
});
