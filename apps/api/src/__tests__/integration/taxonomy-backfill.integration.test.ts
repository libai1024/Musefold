import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { newPromptDocumentSchema } from '@musefold/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backfillLegacyTaxonomy } from '../../modules/prompts/taxonomy-backfill.js';
import { PromptService } from '../../modules/prompts/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const execute = promisify(execFile);
const deletedAt = '2025-01-02T03:04:05.000Z';
describeDb('bounded post-expand legacy taxonomy backfill', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let service: PromptService;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 6 });
    await migrateDatabase(database.db);
    service = new PromptService(database.db);
  }, 180000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM "user"');
    await database.pool.query(`INSERT INTO "user"(id,name,email) VALUES
      ('owner-a','Synthetic A','backfill-a@example.test'),('owner-b','Synthetic B','backfill-b@example.test')`);
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  const folder = (id: string, parentId: string | null = null, owner = 'owner-a') =>
    service.createFolder(owner, { name: id, parentId, sortOrder: 0 }, id);
  const tag = (id: string) =>
    service.createTag('owner-a', { name: id, group: 'Legacy', color: '#123456' }, id);
  async function softDelete(kind: 'folder' | 'tag', id: string, version = 7) {
    const table = kind === 'folder' ? 'prompt_folders' : 'prompt_tags';
    await database.pool.query(
      `UPDATE ${table} SET deleted_at=$1,updated_at=$1,version=$2 WHERE id=$3`,
      [deletedAt, version, id],
    );
  }
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
            await database.pool.query(
              `SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`,
            )
          ).rows,
        ]),
      ),
    );
  }
  async function createPrompt(id: string, folderId: string, tagIds: string[], owner = 'owner-a') {
    return service.createPrompt(
      owner,
      newPromptDocumentSchema.parse({
        title: id,
        content: 'Preserve legacy body',
        description: null,
        negative: null,
        folderId,
        tagIds,
        modelId: null,
        params: null,
      }),
      id,
    );
  }

  it('previews without writes, cleans one entity per batch and preserves descendants, soft-deleted content and old versions', async () => {
    await folder('old-folder');
    const child = await folder('child', 'old-folder');
    const grandchild = await folder('grandchild', child.id);
    await tag('old-tag');
    await tag('kept-tag');
    await createPrompt('live', 'old-folder', ['old-tag', 'kept-tag']);
    const trashed = await createPrompt('trashed', 'old-folder', ['old-tag']);
    await service.deletePrompt('owner-a', trashed.id, trashed.version);
    const beforeTrashed = await service.getPrompt('owner-a', trashed.id);
    await softDelete('folder', 'old-folder');
    await softDelete('tag', 'old-tag', 9);
    const before = await facts();
    expect(await backfillLegacyTaxonomy(database.db, { limit: 1 })).toEqual({
      mode: 'preview',
      selected: 1,
      cleaned: 0,
      skipped: 0,
      hasMore: true,
    });
    expect(await facts()).toEqual(before);
    expect(await backfillLegacyTaxonomy(database.db, { limit: 1, apply: true })).toEqual({
      mode: 'apply',
      selected: 1,
      cleaned: 1,
      skipped: 0,
      hasMore: true,
    });
    expect(await backfillLegacyTaxonomy(database.db, { limit: 1, apply: true })).toEqual({
      mode: 'apply',
      selected: 1,
      cleaned: 1,
      skipped: 0,
      hasMore: false,
    });
    expect(
      (
        await database.pool.query(
          'SELECT entity_type,version,deleted_at FROM sync_taxonomy_tombstones ORDER BY entity_type',
        )
      ).rows,
    ).toEqual([
      { entity_type: 'folder', version: 7, deleted_at: new Date(deletedAt) },
      { entity_type: 'tag', version: 9, deleted_at: new Date(deletedAt) },
    ]);
    expect(await service.getFolder('owner-a', child.id)).toMatchObject({
      parentId: null,
      version: child.version + 1,
    });
    expect(await service.getFolder('owner-a', grandchild.id)).toEqual(grandchild);
    expect(await service.getPrompt('owner-a', 'live')).toMatchObject({
      content: 'Preserve legacy body',
      folderId: null,
      tags: [expect.objectContaining({ id: 'kept-tag' })],
      version: 3,
    });
    expect(await service.getPrompt('owner-a', trashed.id)).toMatchObject({
      content: beforeTrashed.content,
      deletedAt: beforeTrashed.deletedAt,
      folderId: null,
      tags: [],
      version: beforeTrashed.version + 2,
    });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM prompt_folders WHERE id='old-folder' UNION ALL SELECT id FROM prompt_tags WHERE id='old-tag'",
        )
      ).rows,
    ).toEqual([]);
    const after = await facts();
    expect(await backfillLegacyTaxonomy(database.db, { apply: true })).toMatchObject({
      selected: 0,
      cleaned: 0,
      hasMore: false,
    });
    expect(await facts()).toEqual(after);
    // Repair log snapshots carry the same final versions as the remaining entities.
    const log = (
      await database.pool.query(
        "SELECT entity_type,entity_id,version,snapshot FROM sync_change_log WHERE entity_id IN ('old-folder','old-tag') AND operation='delete' ORDER BY entity_type",
      )
    ).rows;
    expect(log).toMatchObject([
      {
        entity_type: 'folder',
        version: '7',
        snapshot: { id: 'old-folder', version: 7, deletedAt },
      },
      { entity_type: 'tag', version: '9', snapshot: { id: 'old-tag', version: 9, deletedAt } },
    ]);
  });

  it('rolls back the failed entity and its detach/log while keeping earlier completed batches; retry resumes', async () => {
    await folder('a-first');
    await folder('z-failed');
    await createPrompt('child', 'z-failed', []);
    await softDelete('folder', 'a-first');
    await softDelete('folder', 'z-failed');
    await database.pool.query(`CREATE FUNCTION b75_backfill_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_id='z-failed' THEN RAISE EXCEPTION 'owned-backfill-fault'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER b75_backfill_fault BEFORE INSERT ON sync_taxonomy_tombstones FOR EACH ROW EXECUTE FUNCTION b75_backfill_fault()`);
    try {
      await expect(backfillLegacyTaxonomy(database.db, { apply: true })).rejects.toThrow();
      expect(
        (await database.pool.query('SELECT entity_id FROM sync_taxonomy_tombstones')).rows,
      ).toEqual([{ entity_id: 'a-first' }]);
      expect(await service.getPrompt('owner-a', 'child')).toMatchObject({
        folderId: 'z-failed',
        version: 1,
      });
      expect(
        (await database.pool.query("SELECT id FROM prompt_folders WHERE id='z-failed'")).rows,
      ).toHaveLength(1);
      expect(
        (
          await database.pool.query(
            "SELECT seq FROM sync_change_log WHERE entity_id='z-failed' AND operation='delete'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await database.pool.query(
        'DROP TRIGGER b75_backfill_fault ON sync_taxonomy_tombstones; DROP FUNCTION b75_backfill_fault()',
      );
    }
    expect(await backfillLegacyTaxonomy(database.db, { apply: true })).toMatchObject({
      selected: 1,
      cleaned: 1,
      hasMore: false,
    });
    expect(await service.getPrompt('owner-a', 'child')).toMatchObject({
      folderId: null,
      version: 2,
    });
  });

  it('rejects inconsistent canonical/marker coexistence without deleting either identity', async () => {
    await folder('ambiguous');
    await softDelete('folder', 'ambiguous');
    await database.pool.query(`INSERT INTO sync_taxonomy_tombstones(user_id,entity_type,entity_id,version,entity_created_at,deleted_at)
      SELECT user_id,'folder',id,version,created_at,deleted_at FROM prompt_folders WHERE id='ambiguous'`);
    const before = await facts();
    await expect(backfillLegacyTaxonomy(database.db, { apply: true })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await facts()).toEqual(before);
  });

  it.each(['folder', 'tag'] as const)(
    'rejects legacy cross-owner %s references atomically',
    async (kind) => {
      await folder('owner-b-folder', null, 'owner-b');
      await createPrompt('foreign-prompt', 'owner-b-folder', [], 'owner-b');
      if (kind === 'folder') {
        await folder('target');
        await database.pool.query(
          "UPDATE prompts SET folder_id='target' WHERE id='foreign-prompt'",
        );
      } else {
        await tag('target');
        await database.pool.query(
          "INSERT INTO prompt_tag_links(prompt_id,tag_id) VALUES ('foreign-prompt','target')",
        );
      }
      await softDelete(kind, 'target');
      const before = await facts();
      await expect(backfillLegacyTaxonomy(database.db, { apply: true })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await facts()).toEqual(before);
    },
  );

  it('uses the actual CLI in a new process for preview, apply and repeat without logging user content', async () => {
    await folder('legacy-private-name');
    await softDelete('folder', 'legacy-private-name');
    const bin = fileURLToPath(new URL('../../taxonomy-backfill-bin.ts', import.meta.url));
    const run = async (...args: string[]) => {
      const result = await execute(process.execPath, ['--import', 'tsx', bin, ...args], {
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
        timeout: 8000,
      });
      expect(result.stdout + result.stderr).not.toContain('legacy-private-name');
      expect(result.stdout + result.stderr).not.toContain(container.getConnectionUri());
      return JSON.parse(result.stdout);
    };
    expect(await run('--limit=1')).toMatchObject({ mode: 'preview', selected: 1, cleaned: 0 });
    expect(await run('--apply', '--limit=1')).toMatchObject({
      mode: 'apply',
      selected: 1,
      cleaned: 1,
    });
    expect(await run('--apply')).toMatchObject({ selected: 0, cleaned: 0, hasMore: false });
  }, 30000);

  it('rechecks a selected legacy row after an actual competing transaction restores it', async () => {
    await folder('restored-before-lock');
    await softDelete('folder', 'restored-before-lock');
    const writer = await database.pool.connect();
    let pending: ReturnType<typeof backfillLegacyTaxonomy> | undefined;
    try {
      await writer.query('BEGIN');
      // Simulates an old writer only to test defensive rechecking, not supported mixed deployment.
      await writer.query(
        "UPDATE prompt_folders SET deleted_at=NULL,version=8 WHERE id='restored-before-lock'",
      );
      const pid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      pending = backfillLegacyTaxonomy(database.db, { apply: true });
      void pending.catch(() => undefined);
      await expect
        .poll(
          async () =>
            (
              await database.pool.query<{ count: number }>(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
                [pid],
              )
            ).rows[0].count,
        )
        .toBeGreaterThan(0);
      await writer.query('COMMIT');
      expect(await pending).toMatchObject({ selected: 1, cleaned: 0, skipped: 1 });
      expect(await service.getFolder('owner-a', 'restored-before-lock')).toMatchObject({
        deletedAt: null,
        version: 8,
      });
      expect(
        (await database.pool.query('SELECT entity_id FROM sync_taxonomy_tombstones')).rows,
      ).toEqual([]);
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
      await pending?.catch(() => undefined);
    }
  });
});
