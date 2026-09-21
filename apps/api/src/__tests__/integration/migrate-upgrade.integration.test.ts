import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { backfillLegacyTaxonomy } from '../../modules/prompts/taxonomy-backfill.js';

const folder = fileURLToPath(new URL('../../../../../packages/db/migrations/', import.meta.url));
const journal = JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
type Database = ReturnType<typeof createDatabase>;

/** Prefixes contain exact repository SQL. Test fixture rows are not anonymized production data. */
describeDb(
  'every PG journal prefix upgrades with data, constraints and exact migration hashes',
  () => {
    let container: StartedPostgreSqlContainer;
    let admin: Database;
    let temporary: string;
    let directory: string;
    let counter = 0;
    let canonicalSchema: unknown;
    let expectedLedger: Array<{ hash: string; created_at: string }>;
    const results: Record<string, unknown>[] = [];

    async function database() {
      const name = `upgrade_${counter++}`;
      await admin.pool.query(`CREATE DATABASE "${name}"`);
      const url = new URL(container.getConnectionUri());
      url.pathname = `/${name}`;
      const value = createDatabase(url.toString(), { max: 3 });
      return {
        ...value,
        async close() {
          await value.pool.end();
          await admin.pool.query(`DROP DATABASE "${name}"`);
        },
      };
    }
    async function schema(value: Database) {
      const columns = (
        await value.pool.query(`SELECT table_name,column_name,ordinal_position,
      data_type,udt_name,is_nullable,column_default,character_maximum_length,is_identity,identity_generation
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)
      ).rows;
      const constraints = (
        await value.pool.query(`SELECT c.relname AS table_name,k.conname,
      pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`)
      ).rows;
      const indexes = (
        await value.pool.query(
          "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
        )
      ).rows;
      const functions = (
        await value.pool.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'
        AND (p.proname LIKE 'retention_%' OR p.proname='queue_deleted_login_release')
      ORDER BY p.proname`)
      ).rows;
      const triggers = (
        await value.pool.query(`SELECT c.relname AS table_name,t.tgname,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`)
      ).rows;
      return { columns, constraints, indexes, functions, triggers };
    }
    async function ledger(value: Database) {
      return (
        await value.pool.query(
          'SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows;
    }
    async function prefix(value: Database, count: number) {
      const path = resolve(temporary, String(count));
      await mkdir(resolve(path, 'meta'), { recursive: true });
      await writeFile(
        resolve(path, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
      );
      for (const entry of journal.entries.slice(0, count)) {
        await copyFile(resolve(folder, `${entry.tag}.sql`), resolve(path, `${entry.tag}.sql`));
      }
      await migrate(value.db, { migrationsFolder: path });
    }
    async function seed(value: Database) {
      await value.pool.query(`INSERT INTO "user"(id,name,email) VALUES
      ('upgrade-a','迁移甲','upgrade-a@example.test'),('upgrade-b','迁移乙','upgrade-b@example.test')`);
      await value.pool.query(`INSERT INTO prompts(id,user_id,title,content,params,version,deleted_at)
      VALUES ('active','upgrade-a','中文 🌱','逐字保留 é 与 é', '{"seed":42}',7,NULL),
      ('deleted','upgrade-b','回收站','保留软删除正文','{"seed":0}',9,'2026-01-02T03:04:05Z')`);
    }
    async function data(value: Database) {
      return {
        users: (
          await value.pool.query(
            'SELECT id,name,email,created_at,updated_at FROM "user" ORDER BY id',
          )
        ).rows,
        prompts: (
          await value.pool.query(
            'SELECT id,user_id,title,content,params,version,deleted_at,created_at,updated_at FROM prompts ORDER BY id',
          )
        ).rows,
      };
    }
    async function seedScheme(value: Database) {
      await value.pool.query(`INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity)
      VALUES ('scheme','upgrade-a','迁移方案','musefold-created','revision','adapted')`);
      await value.pool.query(`INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
      VALUES ('revision','scheme','upgrade-a',1,'{"schemeId":"scheme","revisionId":"revision","fixture":"Unicode 中文"}','import')`);
      await value.pool.query(`INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,byte_size,content_hash)
      VALUES ('asset','upgrade-a','revision','fixture/immutable-image','example','repository','image/png',1,1,4,repeat('a',64))`);
    }
    async function schemeData(value: Database) {
      return {
        scheme: (
          await value.pool.query(
            'SELECT id,user_id,name,current_revision_id,status,version FROM design_schemes ORDER BY id',
          )
        ).rows,
        revisions: (
          await value.pool.query(
            'SELECT revision_id,scheme_id,user_id,document,created_by FROM design_scheme_revisions ORDER BY revision_id',
          )
        ).rows,
        assets: (
          await value.pool.query(
            'SELECT id,user_id,revision_id,object_key,content_hash FROM design_scheme_assets ORDER BY id',
          )
        ).rows,
      };
    }
    beforeAll(async () => {
      temporary = await mkdtemp(resolve(tmpdir(), 'musefold-pg-prefix-'));
      const root = resolve(process.env.PG_UPGRADE_EVIDENCE_DIR ?? 'test-results');
      await mkdir(root, { recursive: true });
      directory = await mkdtemp(resolve(root, 'pg-upgrade-'));
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      admin = createDatabase(container.getConnectionUri(), { max: 2 });
      expectedLedger = await Promise.all(
        journal.entries.map(async (entry) => ({
          hash: digest(await readFile(resolve(folder, `${entry.tag}.sql`), 'utf8')),
          created_at: String(entry.when),
        })),
      );
      const fresh = await database();
      try {
        await migrateDatabase(fresh.db);
        canonicalSchema = await schema(fresh);
      } finally {
        await fresh.close();
      }
    }, 180000);
    afterAll(async () => {
      try {
        if (directory)
          await writeFile(
            resolve(directory, 'results.json'),
            JSON.stringify(
              {
                scope:
                  'Exact SQL prefix upgrades in disposable PG; synthetic row fixtures, not user SQLite, deployed server or installer proof',
                journal: journal.entries,
                expectedLedger,
                schemaHash: digest(JSON.stringify(canonicalSchema)),
                results,
              },
              null,
              2,
            ),
          );
      } finally {
        await admin?.pool.end();
        await container?.stop();
        if (temporary) await rm(temporary, { recursive: true, force: true });
      }
    });

    it.for(journal.entries.map((entry, index) => ({ tag: entry.tag, count: index + 1 })))(
      '$tag → latest preserves data, owner/version/document constraints and replay',
      { timeout: 30000 },
      async ({ tag, count }, { expect }) => {
        const value = await database();
        const record: Record<string, unknown> = {
          tag,
          count,
          startedAt: new Date().toISOString(),
          status: 'running',
        };
        results.push(record);
        try {
          await prefix(value, count);
          expect(await ledger(value)).toEqual(expectedLedger.slice(0, count));
          await seed(value);
          if (count >= 4) await seedScheme(value);
          const before = await data(value);
          const beforeScheme = count >= 4 ? await schemeData(value) : undefined;
          await migrateDatabase(value.db);
          expect(await data(value)).toEqual(before);
          if (beforeScheme) expect(await schemeData(value)).toEqual(beforeScheme);
          expect(await schema(value)).toEqual(canonicalSchema);
          expect(await ledger(value)).toEqual(expectedLedger);
          await migrateDatabase(value.db);
          expect(await data(value)).toEqual(before);
          expect(await ledger(value)).toEqual(expectedLedger);
          if (!beforeScheme) await seedScheme(value);
          const stable = await schemeData(value);
          await expect(
            value.pool.query("UPDATE design_schemes SET version=0 WHERE id='scheme'"),
          ).rejects.toMatchObject({ code: '23514' });
          await expect(
            value.pool.query(
              "UPDATE design_scheme_revisions SET document='{}'::jsonb || jsonb_build_object('revisionId','wrong','schemeId','scheme') WHERE revision_id='revision'",
            ),
          ).rejects.toMatchObject({ code: '23514' });
          await expect(
            value.pool.query(
              "UPDATE design_scheme_assets SET user_id='upgrade-b' WHERE id='asset'",
            ),
          ).rejects.toMatchObject({ code: '23503' });
          expect(await schemeData(value)).toEqual(stable);
          Object.assign(record, {
            status: 'passed',
            rowsHash: digest(JSON.stringify(before)),
            schemeHash: digest(JSON.stringify(stable)),
            appliedMigrations: expectedLedger.length,
          });
        } catch (error) {
          Object.assign(record, { status: 'failed', error: String(error) });
          throw error;
        } finally {
          record.finishedAt = new Date().toISOString();
          await value.close();
        }
      },
    );

    it('root db:migrate upgrades pre-purge runs without losing receipts, and repeats safely', async ({
      expect,
    }) => {
      const value = await database();
      const record: Record<string, unknown> = {
        tag: 'scheme-purge-cli-upgrade',
        status: 'running',
      };
      results.push(record);
      try {
        await prefix(
          value,
          journal.entries.findIndex((entry) => entry.tag === '0029_design_scheme_purge'),
        );
        await seed(value);
        await seedScheme(value);
        await value.pool.query(`INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy,result)
          VALUES('preserved-run','upgrade-a','scheme','revision','trial','completed','{}','{"original":"receipt"}')`);
        const before = await schemeData(value);
        const runBefore = (await value.pool.query('SELECT * FROM design_scheme_runs')).rows[0];
        const command = () =>
          promisify(execFile)('pnpm', ['run', 'db:migrate'], {
            cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
            env: { ...process.env, DATABASE_URL: value.pool.options.connectionString },
            timeout: 30000,
          });
        await command();
        expect(await schemeData(value)).toEqual(before);
        expect((await value.pool.query('SELECT * FROM design_scheme_runs')).rows[0]).toEqual({
          ...runBefore,
          origin_scheme_id: 'scheme',
          origin_revision_id: 'revision',
        });
        await command();
        expect(await ledger(value)).toEqual(expectedLedger);
        expect(await schemeData(value)).toEqual(before);
        Object.assign(record, {
          status: 'passed',
          appliedMigrations: expectedLedger.length,
          rootCommandReplay: true,
        });
      } finally {
        await value.close();
      }
    }, 60000);

    it('registers legacy reference metadata and owner-scoped links without changing old requests', async ({
      expect,
    }) => {
      const value = await database();
      const record: Record<string, unknown> = { tag: 'reference-backfill', status: 'running' };
      results.push(record);
      try {
        await prefix(value, 4);
        await seed(value);
        const reference = {
          id: 'reference_a',
          name: '旧参考图',
          mimeType: 'image/jpeg',
          byteSize: 123,
        };
        for (const [id, owner, request, created] of [
          [
            'first',
            'upgrade-a',
            { referenceImages: [reference, { id: '../invalid' }] },
            '2026-01-01Z',
          ],
          [
            'second',
            'upgrade-a',
            { referenceImages: [{ ...reference, name: 'later' }] },
            '2026-01-02Z',
          ],
          [
            'other',
            'upgrade-b',
            {
              referenceImages: [{ id: 'reference_b', name: '', mimeType: 'unknown', byteSize: -1 }],
            },
            '2026-01-03Z',
          ],
          ['not-array', 'upgrade-a', { referenceImages: {} }, '2026-01-04Z'],
        ] as const) {
          await value.pool.query(
            'INSERT INTO generation_runs(id,user_id,request,created_at) VALUES ($1,$2,$3,$4)',
            [id, owner, JSON.stringify(request), created],
          );
        }
        const before = (
          await value.pool.query(
            'SELECT id,user_id,request,created_at FROM generation_runs ORDER BY id',
          )
        ).rows;
        await migrateDatabase(value.db);
        const references = (
          await value.pool.query('SELECT * FROM generation_reference_uploads ORDER BY id')
        ).rows;
        expect(references).toHaveLength(2);
        expect(references[0]).toMatchObject({
          id: 'reference_a',
          user_id: 'upgrade-a',
          object_key: 'users/upgrade-a/references/reference_a',
          original_name: '旧参考图',
          mime_type: 'image/jpeg',
          byte_size: 123,
          status: 'available',
          created_at: new Date('2026-01-01Z'),
          expires_at: new Date('2026-01-02Z'),
        });
        expect(references[1]).toMatchObject({
          id: 'reference_b',
          user_id: 'upgrade-b',
          original_name: 'reference',
          mime_type: 'image/png',
          byte_size: 0,
          status: 'available',
        });
        const links = (
          await value.pool.query(
            'SELECT run_id,reference_id,user_id FROM generation_reference_links ORDER BY run_id',
          )
        ).rows;
        expect(links).toEqual([
          { run_id: 'first', reference_id: 'reference_a', user_id: 'upgrade-a' },
          { run_id: 'other', reference_id: 'reference_b', user_id: 'upgrade-b' },
          { run_id: 'second', reference_id: 'reference_a', user_id: 'upgrade-a' },
        ]);
        expect(
          (
            await value.pool.query(
              'SELECT id,user_id,request,created_at FROM generation_runs ORDER BY id',
            )
          ).rows,
        ).toEqual(before);
        await migrateDatabase(value.db);
        expect(
          (await value.pool.query('SELECT * FROM generation_reference_uploads ORDER BY id')).rows,
        ).toEqual(references);
        Object.assign(record, {
          status: 'passed',
          references: references.length,
          links: links.length,
          metadataHash: digest(JSON.stringify(references)),
        });
      } catch (error) {
        Object.assign(record, { status: 'failed', error: String(error) });
        throw error;
      } finally {
        await value.close();
      }
    }, 30000);

    it('keeps legacy account hints and ciphertext unverified rather than minting payer authority', async ({
      expect,
    }) => {
      const value = await database();
      const record: Record<string, unknown> = { tag: 'account-backfill', status: 'running' };
      results.push(record);
      try {
        await prefix(value, 9);
        await seed(value);
        await value.pool.query('UPDATE "user" SET new_api_user_id=42 WHERE id=\'upgrade-a\'');
        await value.pool.query(
          "INSERT INTO account_credentials(user_id,ciphertext) VALUES ('upgrade-a','synthetic-opaque-envelope')",
        );
        const before = (await value.pool.query('SELECT * FROM account_credentials')).rows[0];
        await migrateDatabase(value.db);
        const identities = (
          await value.pool.query('SELECT * FROM account_identities ORDER BY user_id')
        ).rows;
        expect(identities).toHaveLength(2);
        for (const row of identities)
          expect(row).toMatchObject({
            api_issuer: null,
            upstream_issuer: null,
            upstream_owner_id: null,
            status: 'unverified',
            identity_version: 0,
            verified_at: null,
            evidence: { kind: 'legacy_unverified' },
          });
        expect((await value.pool.query('SELECT * FROM account_credentials')).rows[0]).toMatchObject(
          {
            ...before,
            upstream_issuer: null,
            upstream_owner_id: null,
            credential_ref: null,
            credential_version: 0,
            status: 'unverified',
            verified_at: null,
          },
        );
        expect(
          (await value.pool.query('SELECT * FROM account_session_authorizations')).rows,
        ).toHaveLength(0);
        await migrateDatabase(value.db);
        expect(
          (await value.pool.query('SELECT * FROM account_identities ORDER BY user_id')).rows,
        ).toEqual(identities);
        Object.assign(record, {
          status: 'passed',
          identities: identities.length,
          identityHash: digest(JSON.stringify(identities)),
        });
      } catch (error) {
        Object.assign(record, { status: 'failed', error: String(error) });
        throw error;
      } finally {
        await value.close();
      }
    }, 30000);

    it('backfills old generation keys without inventing payer, authorization or known cost', async ({
      expect,
    }) => {
      const value = await database();
      const record: Record<string, unknown> = { tag: 'receipt-backfill', status: 'running' };
      results.push(record);
      try {
        await prefix(value, 11);
        await seed(value);
        await seedScheme(value);
        await value.pool.query(`INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy)
        VALUES ('scheme-run','upgrade-a','scheme','revision','trial','completed','{}')`);
        await value.pool.query(`INSERT INTO generation_runs
        (id,user_id,idempotency_key,request,status,run_kind,parent_run_id,design_scheme_run_id,upstream_request_sent,cost_points,created_at,finished_at)
        VALUES ('queued','upgrade-a','shared','{}','queued','free_generation',NULL,NULL,false,NULL,'2026-01-01Z',NULL),
        ('success','upgrade-a','success-key','{}','succeeded','free_generation',NULL,NULL,false,99,'2026-01-02Z','2026-01-03Z'),
        ('retry','upgrade-a','retry-key','{}','failed','retry','success',NULL,true,7,'2026-01-04Z','2026-01-05Z'),
        ('scheme-gen','upgrade-a','scheme-key','{}','succeeded','free_generation',NULL,'scheme-run',true,13,'2026-01-06Z','2026-01-07Z'),
        ('other-owner','upgrade-b','shared','{}','cancelled','free_generation',NULL,NULL,false,NULL,'2026-01-08Z','2026-01-09Z'),
        ('unkeyed','upgrade-a',NULL,'{}','queued','free_generation',NULL,NULL,false,NULL,'2026-01-10Z',NULL)`);
        const originals = (await value.pool.query('SELECT * FROM generation_runs ORDER BY id'))
          .rows;
        await migrateDatabase(value.db);
        const receipts = (
          await value.pool.query('SELECT * FROM generation_execution_receipts ORDER BY id')
        ).rows;
        expect(receipts).toHaveLength(5);
        const expected = [
          ['queued', 'ordinary_create', 'not_started', null],
          ['success', 'ordinary_create', 'claimed', null],
          ['retry', 'legacy_unknown', 'claimed', 'success'],
          ['scheme-gen', 'scheme_run', 'claimed', null],
          ['other-owner', 'ordinary_create', 'not_started', null],
        ];
        for (const [id, operation, dispatch, source] of expected) {
          const original = originals.find((row) => row.id === id);
          expect(receipts.find((row) => row.id === id)).toMatchObject({
            id,
            operation,
            dispatch,
            source_run_id: source,
            original_run_id: id,
            principal_id: original.user_id,
            idempotency_key: original.idempotency_key,
            status: original.status,
            created_at: original.created_at,
            terminal_at: original.finished_at,
            binding_state: 'legacy_unbound',
            binding: null,
            authorizing_session_id: null,
            auth_revision: null,
            cost_provenance: 'unknown',
            cost_points: null,
          });
        }
        const upgraded = (await value.pool.query('SELECT * FROM generation_runs ORDER BY id')).rows;
        expect(upgraded).toEqual(
          originals.map((row) => ({
            ...row,
            execution_receipt_id: row.idempotency_key ? row.id : null,
            purge_started_at: null,
          })),
        );
        await migrateDatabase(value.db);
        expect(
          (await value.pool.query('SELECT * FROM generation_execution_receipts ORDER BY id')).rows,
        ).toEqual(receipts);
        Object.assign(record, {
          status: 'passed',
          originalRuns: originals.length,
          receipts: receipts.length,
          receiptHash: digest(JSON.stringify(receipts)),
        });
      } catch (error) {
        Object.assign(record, { status: 'failed', error: String(error) });
        throw error;
      } finally {
        await value.close();
      }
    }, 30000);

    it('backfills immutable Agent creation time from original view or the legacy updated timestamp', async ({
      expect,
    }) => {
      const value = await database();
      const record: Record<string, unknown> = { tag: 'agent-time-backfill', status: 'running' };
      results.push(record);
      try {
        await prefix(value, 22);
        await seed(value);
        for (const [id, view] of [
          ['original', { status: 'cancelled', createdAt: '2026-01-01T01:02:03.456Z' }],
          ['missing', { status: 'cancelled' }],
          ['null', { status: 'cancelled', createdAt: null }],
        ] as const) {
          await value.pool.query(
            `INSERT INTO design_scheme_agent_sessions(user_id,execution_id,source_execution_ids,view,expires_at,updated_at)
          VALUES ('upgrade-a',$1,'[]',$2,'2027-01-01Z','2026-02-02T02:03:04.567Z')`,
            [id, JSON.stringify(view)],
          );
        }
        const before = (
          await value.pool.query('SELECT * FROM design_scheme_agent_sessions ORDER BY execution_id')
        ).rows;
        await migrateDatabase(value.db);
        const after = (
          await value.pool.query('SELECT * FROM design_scheme_agent_sessions ORDER BY execution_id')
        ).rows;
        expect(after).toEqual(
          before.map((row) => ({
            ...row,
            created_at:
              row.execution_id === 'original'
                ? new Date('2026-01-01T01:02:03.456Z')
                : row.updated_at,
          })),
        );
        await migrateDatabase(value.db);
        expect(
          (
            await value.pool.query(
              'SELECT * FROM design_scheme_agent_sessions ORDER BY execution_id',
            )
          ).rows,
        ).toEqual(after);
        Object.assign(record, {
          status: 'passed',
          sessions: after.length,
          dataHash: digest(JSON.stringify(after)),
        });
      } catch (error) {
        Object.assign(record, { status: 'failed', error: String(error) });
        throw error;
      } finally {
        await value.close();
      }
    }, 30000);

    it.for([1, 23])(
      'upgrades legacy taxonomy from prefix %s then performs bounded post-expand cleanup',
      { timeout: 30000 },
      async (prefixCount, { expect }) => {
        const value = await database();
        const record: Record<string, unknown> = {
          tag: 'taxonomy-backfill',
          prefixCount,
          status: 'running',
        };
        results.push(record);
        try {
          await prefix(value, prefixCount);
          await seed(value);
          await value.pool.query(`INSERT INTO prompt_folders(id,user_id,name,version,deleted_at)
          VALUES ('legacy-folder','upgrade-a','Legacy private folder',6,'2025-01-01Z');
          INSERT INTO prompt_tags(id,user_id,name,version,deleted_at)
          VALUES ('legacy-tag','upgrade-a','Legacy private tag',8,'2025-01-01Z');
          UPDATE prompts SET folder_id='legacy-folder' WHERE id='active';
          INSERT INTO prompt_tag_links(prompt_id,tag_id) VALUES ('active','legacy-tag')`);
          const before = await data(value);
          await migrateDatabase(value.db);
          expect(await backfillLegacyTaxonomy(value.db, { apply: true, limit: 1 })).toMatchObject({
            cleaned: 1,
            hasMore: true,
          });
          expect(await backfillLegacyTaxonomy(value.db, { apply: true, limit: 1 })).toMatchObject({
            cleaned: 1,
            hasMore: false,
          });
          const markers = (
            await value.pool.query(
              'SELECT entity_type,version,deleted_at FROM sync_taxonomy_tombstones ORDER BY entity_type',
            )
          ).rows;
          expect(markers).toEqual([
            { entity_type: 'folder', version: 6, deleted_at: new Date('2025-01-01Z') },
            { entity_type: 'tag', version: 8, deleted_at: new Date('2025-01-01Z') },
          ]);
          expect(
            (
              await value.pool.query(
                'SELECT id FROM prompt_folders UNION ALL SELECT id FROM prompt_tags',
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await value.pool.query(
                "SELECT content,version,folder_id FROM prompts WHERE id='active'",
              )
            ).rows,
          ).toEqual([{ content: '逐字保留 é 与 é', version: 9, folder_id: null }]);
          const after = await data(value);
          expect(after.users).toEqual(before.users);
          expect(after.prompts.find((p) => p.id === 'deleted')).toEqual(
            before.prompts.find((p) => p.id === 'deleted'),
          );
          await migrateDatabase(value.db);
          expect(await backfillLegacyTaxonomy(value.db, { apply: true })).toMatchObject({
            selected: 0,
            cleaned: 0,
          });
          expect(await data(value)).toEqual(after);
          expect(await schema(value)).toEqual(canonicalSchema);
          expect(await ledger(value)).toEqual(expectedLedger);
          Object.assign(record, {
            status: 'passed',
            markers: markers.length,
            dataHash: digest(JSON.stringify(after)),
          });
        } catch (error) {
          Object.assign(record, { status: 'failed', error: String(error) });
          throw error;
        } finally {
          await value.close();
        }
      },
    );

    it.for([...new Set([1, 11, 22, 29, journal.entries.length - 1])])(
      'rolls back all pending migrations from prefix %s on a late database fault, then upgrades again',
      { timeout: 30000 },
      async (prefixCount, { expect }) => {
        const value = await database();
        const record: Record<string, unknown> = {
          tag: 'transaction-rollback',
          prefixCount,
          status: 'running',
        };
        results.push(record);
        try {
          await prefix(value, prefixCount);
          await seed(value);
          const before = {
            schema: await schema(value),
            ledger: await ledger(value),
            data: await data(value),
          };
          // Retain prior late faults, including 0029. Prefix 30 fails on 0030's
          // final trigger, after both session tables and the release function.
          await value.pool.query(`CREATE FUNCTION fail_upgrade_index() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()
        WHERE object_identity LIKE '%scheme_agent_history_idx'
          OR object_identity LIKE '%object_inventory_candidates_due_idx'
          OR object_identity LIKE '%object_inventory_candidates_ready_idx'
          OR (command_tag='CREATE TRIGGER' AND object_identity LIKE '%design_scheme_revisions_purge_identity%')
          OR (command_tag='CREATE TRIGGER' AND object_identity LIKE '%queue_deleted_login_release%')
          OR (command_tag='CREATE TRIGGER' AND object_identity LIKE '%package_imports_storage_lease%')
          OR (command_tag='CREATE FUNCTION' AND object_identity LIKE '%musefold_guard_storage_object%')
          OR (command_tag='ALTER TABLE' AND object_identity LIKE '%sync_taxonomy_tombstones')
          OR (command_tag='CREATE TRIGGER' AND object_identity LIKE '%prompt_usage_events_retention_parent%'))
        THEN RAISE EXCEPTION 'isolated upgrade fault'; END IF; END $$;
        CREATE EVENT TRIGGER upgrade_fault ON ddl_command_end WHEN TAG IN ('CREATE INDEX','ALTER TABLE','CREATE TRIGGER','CREATE FUNCTION') EXECUTE FUNCTION fail_upgrade_index()`);
          await expect(migrateDatabase(value.db)).rejects.toMatchObject({
            cause: { code: 'P0001', message: 'isolated upgrade fault' },
          });
          expect({
            schema: await schema(value),
            ledger: await ledger(value),
            data: await data(value),
          }).toEqual(before);
          await value.pool.query(
            'DROP EVENT TRIGGER upgrade_fault; DROP FUNCTION fail_upgrade_index()',
          );
          await migrateDatabase(value.db);
          expect(await schema(value)).toEqual(canonicalSchema);
          expect(await ledger(value)).toEqual(expectedLedger);
          expect(await data(value)).toEqual(before.data);
          record.status = 'passed';
        } catch (error) {
          Object.assign(record, { status: 'failed', error: String(error) });
          throw error;
        } finally {
          await value.close();
        }
      },
    );
  },
);
