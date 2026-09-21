import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../client.js';
import { migrateDatabase } from '../migrate.js';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')(
  'retention progress migration and database write fences',
  () => {
    const name = `retention_test_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool;
    let database: ReturnType<typeof createDatabase>;
    let prefix: string;
    let created = false;
    let oldFacts: Record<string, pg.QueryResultRow[]>;
    let newFacts: Record<string, pg.QueryResultRow[]>;
    const facts = async () => {
      const result: Record<string, pg.QueryResultRow[]> = {};
      for (const table of [
        'prompts',
        'generation_runs',
        'generation_assets',
        'prompt_usage_events',
      ]) {
        result[table] = (
          await database.pool.query(`SELECT * FROM ${table} ORDER BY row_to_json(${table})::text`)
        ).rows;
      }
      return result;
    };
    async function seed() {
      await database.pool.query(
        `INSERT INTO "user"(id,name,email) VALUES ('owned-retention','Owned','retention@example.test')`,
      );
      await database.pool.query(
        `INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ('prompt','owned-retention','Owned','Preserve full text',now()-interval '31 days')`,
      );
      await database.pool.query(
        `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,cost_points) VALUES ('run','owned-retention','succeeded','{"prompt":"Owned"}',now()-interval '31 days',7)`,
      );
      await database.pool.query(
        `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256) VALUES ('asset','run','owned-retention','owned/image','image/png',1,1,repeat('a',64))`,
      );
      await database.pool.query(
        `INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action) VALUES ('owned-retention','event','prompt','copy')`,
      );
      await database.pool.query(
        `INSERT INTO prompt_tags(id,user_id,name) VALUES ('tag','owned-retention','Owned')`,
      );
      await database.pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at) VALUES ('reference','owned-retention','owned/reference','Owned','image/png',4,'available',now()+interval '1 day')`,
      );
    }
    beforeAll(async () => {
      if (!process.env.DATABASE_URL)
        throw new Error('Supply an explicit owned disposable DATABASE_URL');
      admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      const target = new URL(process.env.DATABASE_URL);
      target.pathname = `/${name}`;
      database = createDatabase(target.toString());
      prefix = await mkdtemp(join(tmpdir(), 'musefold-retention-prefix-'));
      await mkdir(join(prefix, 'meta'));
      const source = fileURLToPath(new URL('../../migrations/', import.meta.url));
      const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      journal.entries = journal.entries.filter((entry) => entry.idx <= 23);
      await writeFile(join(prefix, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(join(source, `${entry.tag}.sql`), join(prefix, `${entry.tag}.sql`));
      await migrate(database.db, { migrationsFolder: prefix });
      await seed();
      oldFacts = await facts();
      await migrateDatabase(database.db);
      await migrateDatabase(database.db);
      newFacts = await facts();
    }, 60000);
    beforeEach(async () => {
      await database.pool.query('TRUNCATE "user" CASCADE');
      await seed();
    });
    afterAll(async () => {
      await database?.pool.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin?.end();
      if (prefix) await rm(prefix, { recursive: true, force: true });
    });

    it('expands populated 0023 and replays without retiring, changing or removing original data', async () => {
      for (const table of Object.keys(oldFacts)) {
        expect(newFacts[table]).toEqual(
          oldFacts[table].map((row) =>
            table === 'prompts' || table === 'generation_runs'
              ? { ...row, purge_started_at: null }
              : row,
          ),
        );
      }
      const indexes = await database.pool.query(
        "SELECT indexname FROM pg_indexes WHERE indexname IN ('generation_assets_retention_idx','prompt_usage_events_retention_idx') ORDER BY indexname",
      );
      expect(indexes.rows).toHaveLength(2);
    });

    it.each(['generation_runs', 'prompts'])(
      '%s rejects restoring or resetting an irreversible marker',
      async (table) => {
        await database.pool.query(`UPDATE ${table} SET purge_started_at=now()`);
        const before = (await database.pool.query(`SELECT * FROM ${table}`)).rows;
        for (const assignment of [
          'purge_started_at=NULL',
          'deleted_at=NULL',
          "purge_started_at=now()+interval '1 second'",
        ]) {
          await expect(
            database.pool.query(`UPDATE ${table} SET ${assignment}`),
          ).rejects.toMatchObject({ code: '23514' });
          expect((await database.pool.query(`SELECT * FROM ${table}`)).rows).toEqual(before);
        }
      },
    );

    it.each([
      [
        'generation_assets',
        "INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256) VALUES ('late','run','owned-retention','owned/late','image/png',1,1,repeat('a',64))",
      ],
      [
        'generation_events',
        "INSERT INTO generation_events(run_id,user_id,event_type) VALUES ('run','owned-retention','generation.progress')",
      ],
      [
        'generation_reference_links',
        "INSERT INTO generation_reference_links(run_id,user_id,reference_id) VALUES ('run','owned-retention','reference')",
      ],
      [
        'design_scheme_generation_references',
        "INSERT INTO design_scheme_generation_references(generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash) VALUES ('run','owned-retention','late',0,'owned/ref','Owned','image/png',4,repeat('b',64))",
      ],
      [
        'prompt_tag_links',
        "INSERT INTO prompt_tag_links(prompt_id,tag_id) VALUES ('prompt','tag')",
      ],
      [
        'prompt_usage_events',
        "INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action) VALUES ('owned-retention','late','prompt','copy')",
      ],
    ])(
      '%s rejects a valid late child after the parent has entered purge',
      async (table, statement) => {
        await database.pool.query('UPDATE generation_runs SET purge_started_at=now()');
        await database.pool.query('UPDATE prompts SET purge_started_at=now()');
        const before = (await database.pool.query(`SELECT * FROM ${table}`)).rows;
        await expect(database.pool.query(statement)).rejects.toMatchObject({ code: '23514' });
        expect((await database.pool.query(`SELECT * FROM ${table}`)).rows).toEqual(before);
      },
    );
  },
);
