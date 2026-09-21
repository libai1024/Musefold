import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDatabase } from '@musefold/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describe, expect, it } from 'vitest';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('inventory expand migration through the actual repository CLI', () => {
  it('preserves populated 0027 candidates and cursors while initializing deletion claims through two CLI runs', async () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const folder = join(root, 'packages/db/migrations');
    const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const index = journal.entries.findIndex(
      (entry) => entry.tag === '0028_object_inventory_execution',
    );
    expect(index).toBe(28);
    const directory = await mkdtemp(join(tmpdir(), 'musefold-inventory-claim-upgrade-'));
    const container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const database = createDatabase(container.getConnectionUri());
    try {
      await mkdir(join(directory, 'meta'));
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }),
      );
      for (const entry of journal.entries.slice(0, index))
        await copyFile(join(folder, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
      await migrate(database.db, { migrationsFolder: directory });
      await database.pool.query(`INSERT INTO object_inventory_candidates(scope_id,object_key,prefix,etag,modified_at,byte_size,first_observed_at,last_observed_at,eligible_at)
        VALUES(repeat('a',64),'owned-upgrade-candidate','users/','"owned-etag"','2020-01-01T00:00:00.123Z',20,'2021-01-01Z','2021-01-02Z','2021-01-03Z');
        INSERT INTO object_inventory_cursors(scope_id,prefix,mode,continuation_token) VALUES(repeat('a',64),'users/','record','owned-resume-token')`);
      const [before] = (await database.pool.query('SELECT * FROM object_inventory_candidates'))
        .rows;
      const cursors = (await database.pool.query('SELECT * FROM object_inventory_cursors')).rows;
      const migrationStart = (await database.pool.query('SELECT clock_timestamp() AS now')).rows[0]
        .now;
      let migrated: unknown;
      for (let run = 0; run < 2; run++) {
        const result = await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
          cwd: root,
          env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
          timeout: 60000,
        });
        expect(result.stdout).toContain('migrations applied successfully');
        const [after] = (await database.pool.query('SELECT * FROM object_inventory_candidates'))
          .rows;
        expect(after).toMatchObject({
          ...before,
          claim_token: null,
          claim_until: null,
          attempt_count: 0,
          last_attempt_at: null,
          last_error: null,
          abandoned_at: null,
        });
        expect(after.next_attempt_at.getTime()).toBeGreaterThanOrEqual(migrationStart.getTime());
        if (run === 0) migrated = after;
        else expect(after).toEqual(migrated);
        expect((await database.pool.query('SELECT * FROM object_inventory_cursors')).rows).toEqual(
          cursors,
        );
      }
      expect(
        (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
      ).toBe(journal.entries.length);
      console.info('[inventory execution migration]', {
        prefix: index,
        migrated: journal.entries.length,
        cliRuns: 2,
        preservedCandidates: 1,
        preservedCursors: cursors.length,
      });
    } finally {
      await database.pool.end();
      await container.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);

  it('upgrades an exact populated 0024 prefix, preserves prior data/outbox and is repeatable', async () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const folder = join(root, 'packages/db/migrations');
    const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const index = journal.entries.findIndex(
      (entry) => entry.tag === '0025_object_inventory_discovery',
    );
    expect(index).toBe(25);
    const directory = await mkdtemp(join(tmpdir(), 'musefold-inventory-migration-'));
    const container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const database = createDatabase(container.getConnectionUri());
    try {
      await mkdir(join(directory, 'meta'));
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }),
      );
      for (const entry of journal.entries.slice(0, index))
        await copyFile(join(folder, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
      await migrate(database.db, { migrationsFolder: directory });
      expect(
        (
          await database.pool.query(
            "SELECT to_regclass('object_inventory_candidates') AS table_name",
          )
        ).rows[0].table_name,
      ).toBeNull();
      await database.pool.query(
        `INSERT INTO "user"(id,name,email) VALUES ('owned','中文迁移','owned@example.test')`,
      );
      await database.pool.query(`INSERT INTO prompts(id,user_id,title,content,params,version)
        VALUES ('owned-prompt','owned','原始标题','原始正文 🌱','{"seed":42}',7)`);
      await database.pool.query(`INSERT INTO object_cleanup_queue(object_key,owner_id,object_type,reason,attempt_count,last_error)
        VALUES ('owned-preserved','owned','generation_reference','reference_expired',3,'OwnedFailure')`);
      const before = await database.pool.query('SELECT * FROM prompts');
      const outbox = await database.pool.query('SELECT * FROM object_cleanup_queue');
      const execute = promisify(execFile);
      for (let run = 0; run < 2; run++) {
        const result = await execute('pnpm', ['run', 'db:migrate'], {
          cwd: root,
          env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
          timeout: 60000,
        });
        expect(result.stdout).toContain('migrations applied successfully');
        expect((await database.pool.query('SELECT * FROM prompts')).rows).toEqual(before.rows);
        expect((await database.pool.query('SELECT * FROM object_cleanup_queue')).rows).toEqual(
          outbox.rows,
        );
      }
      const ledger = (
        await database.pool.query('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id')
      ).rows;
      const hashes = await Promise.all(
        journal.entries.map(async (entry) => ({
          hash: createHash('sha256')
            .update(await readFile(join(folder, `${entry.tag}.sql`)))
            .digest('hex'),
        })),
      );
      expect(ledger).toEqual(hashes);
      expect((await database.pool.query('SELECT * FROM object_inventory_candidates')).rows).toEqual(
        [],
      );
      expect((await database.pool.query('SELECT * FROM object_inventory_cursors')).rows).toEqual(
        [],
      );
      console.info('[inventory migration]', {
        prefix: index,
        migrated: ledger.length,
        cliRuns: 2,
        preservedPrompts: before.rowCount,
        preservedOutbox: outbox.rowCount,
      });
    } finally {
      await database.pool.end();
      await container.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
});
