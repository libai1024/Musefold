import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionBinding } from '@musefold/contracts';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../client.js';
import { lockGenerationExecutionAuthority } from '../generation-execution-authority.js';
import { migrateDatabase } from '../migrate.js';

/**
 * Opt-in PG integration. DATABASE_URL must identify the disposable PG service owned
 * by the test runner; this suite creates/drops only its own random database. It never
 * migrates the database named by DATABASE_URL and never uses a fallback connection.
 */
describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')(
  'generation execution receipts (real PostgreSQL)',
  () => {
    const databaseName = `receipt_test_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool | undefined;
    let runtime: ReturnType<typeof createDatabase> | undefined;
    let oldMigrations: string | undefined;
    let expectedMigrations: { hash: string; created_at: string }[] = [];
    let databaseCreated = false;
    const binding: ExecutionBinding = {
      apiIssuer: 'https://api.example.invalid',
      principalId: 'authority-principal',
      payer: { issuer: 'https://images.example.invalid', ownerId: 'authority-owner' },
      credential: { ref: 'authority-key', version: 1 },
      providerId: 'cloud-default',
      model: 'musefold-image-pro',
      capabilities: { image: true, text: false },
    };
    const authorityInput = {
      principalId: binding.principalId,
      apiIssuer: binding.apiIssuer,
      upstreamIssuer: binding.payer.issuer,
      authSessionId: 'authority-session',
      expectedBinding: binding,
      expectedAuthRevision: 1,
    };

    beforeAll(async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString)
        throw new Error('RUN_DATABASE_TESTS requires an explicit disposable DATABASE_URL');
      admin = new pg.Pool({ connectionString, max: 2 });
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      databaseCreated = true;
      const target = new URL(connectionString);
      target.pathname = `/${databaseName}`;
      runtime = createDatabase(target.toString(), { max: 4 });
      oldMigrations = await mkdtemp(join(tmpdir(), 'musefold-receipt-migrations-'));
      await mkdir(join(oldMigrations, 'meta'));
      const source = fileURLToPath(new URL('../../migrations/', import.meta.url));
      expectedMigrations = readMigrationFiles({ migrationsFolder: source }).map(
        ({ hash, folderMillis }) => ({ hash, created_at: String(folderMillis) }),
      );
      const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      journal.entries = journal.entries.filter((entry) => entry.idx <= 10);
      await writeFile(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
      await Promise.all(
        journal.entries.map((entry) =>
          copyFile(
            join(source, `${entry.tag}.sql`),
            join(oldMigrations as string, `${entry.tag}.sql`),
          ),
        ),
      );
      await migrate(runtime.db, { migrationsFolder: oldMigrations });
      await runtime.pool.query(`INSERT INTO "user" (id,name,email) VALUES
      ('legacy-principal','Synthetic legacy','legacy@example.invalid'),
      ('other-principal','Synthetic other','other@example.invalid'),
      ('authority-principal','Synthetic authority','authority@example.invalid')`);
      await runtime.pool.query(`INSERT INTO design_schemes
      (id,user_id,name,source_presentation,current_revision_id,fidelity)
      VALUES ('legacy-scheme','legacy-principal','Synthetic scheme','musefold-created','legacy-revision','verified')`);
      await runtime.pool.query(`INSERT INTO design_scheme_revisions
      (revision_id,scheme_id,user_id,schema_version,document,created_by)
      VALUES ('legacy-revision','legacy-scheme','legacy-principal',1,
      '{"revisionId":"legacy-revision","schemeId":"legacy-scheme"}','user')`);
      await runtime.pool.query(`INSERT INTO design_scheme_runs
      (run_id,user_id,scheme_id,revision_id,mode,status,policy)
      VALUES ('legacy-scheme-run','legacy-principal','legacy-scheme','legacy-revision','trial','completed','{}')`);
      await runtime.pool.query(`INSERT INTO generation_runs
      (id,user_id,request,idempotency_key,run_kind,design_scheme_run_id,status,upstream_request_sent,cost_points,parent_run_id)
      VALUES
      ('legacy-ordinary','legacy-principal','{"prompt":"synthetic"}','scheme:ordinary-key','free_generation',NULL,'queued',false,NULL,NULL),
      ('legacy-retry','legacy-principal','{"prompt":"synthetic"}','legacy-retry-key','retry',NULL,'failed',true,7,'legacy-ordinary'),
      ('legacy-refinement','legacy-principal','{"prompt":"synthetic"}','legacy-refinement-key','refinement',NULL,'failed',false,NULL,'legacy-ordinary'),
      ('legacy-scheme-generation','legacy-principal','{"prompt":"synthetic"}','no-prefix-scheme','free_generation','legacy-scheme-run','succeeded',false,9,NULL),
      ('legacy-unkeyed','legacy-principal','{"prompt":"synthetic"}',NULL,'free_generation',NULL,'failed',false,NULL,NULL)`);
      await migrateDatabase(runtime.db);
      await migrateDatabase(runtime.db);
    }, 30_000);

    afterAll(async () => {
      await runtime?.pool.end();
      try {
        if (databaseCreated) await admin?.query(`DROP DATABASE "${databaseName}"`);
      } finally {
        await admin?.end();
        if (oldMigrations) await rm(oldMigrations, { recursive: true, force: true });
      }
    }, 30_000);

    it('upgrades/replays populated 0010 through the current chain without inventing historical payer, operation or cost', async () => {
      const result =
        await runtime?.pool.query(`SELECT id,operation,source_run_id,binding_state,binding,
      authorizing_session_id,auth_revision,logical_input_digest,final_request_digest,
      dispatch,cost_provenance,cost_points FROM generation_execution_receipts ORDER BY id`);
      expect(result?.rows).toHaveLength(4);
      const receipts = new Map(result?.rows.map((row) => [row.id, row]));
      expect(receipts.get('legacy-ordinary')).toMatchObject({
        operation: 'ordinary_create',
        dispatch: 'not_started',
      });
      expect(receipts.get('legacy-retry')).toMatchObject({
        operation: 'legacy_unknown',
        dispatch: 'claimed',
        source_run_id: 'legacy-ordinary',
      });
      expect(receipts.get('legacy-refinement')).toMatchObject({
        operation: 'ordinary_create',
        source_run_id: null,
      });
      expect(
        (
          await runtime?.pool.query(
            "SELECT parent_run_id FROM generation_runs WHERE id='legacy-refinement'",
          )
        )?.rows[0].parent_run_id,
      ).toBe('legacy-ordinary');
      expect(receipts.get('legacy-scheme-generation')).toMatchObject({
        operation: 'scheme_run',
        dispatch: 'claimed',
        source_run_id: null,
      });
      for (const row of receipts.values())
        expect(row).toMatchObject({
          binding_state: 'legacy_unbound',
          binding: null,
          authorizing_session_id: null,
          auth_revision: null,
          logical_input_digest: null,
          final_request_digest: null,
          cost_provenance: 'unknown',
          cost_points: null,
        });
      expect(
        (await runtime?.pool.query('SELECT count(*)::int AS count FROM generation_runs'))?.rows[0]
          .count,
      ).toBe(5);
      expect(
        (
          await runtime?.pool.query(
            "SELECT execution_receipt_id FROM generation_runs WHERE id='legacy-unkeyed'",
          )
        )?.rows[0].execution_receipt_id,
      ).toBeNull();
      expect(
        (
          await runtime?.pool.query(
            'SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
          )
        )?.rows,
      ).toEqual(expectedMigrations);
    });

    it('enforces principal/key uniqueness while allowing the same key for another principal', async () => {
      const insert = `INSERT INTO generation_execution_receipts
      (id,principal_id,idempotency_key,operation,original_run_id,binding_state,status,cost_provenance)
      VALUES ($1,$2,'scheme:ordinary-key','ordinary_create',$1,'legacy_unbound','queued','unknown')`;
      await expect(
        runtime?.pool.query(insert, ['duplicate-receipt', 'legacy-principal']),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        runtime?.pool.query(insert, ['other-receipt', 'other-principal']),
      ).resolves.toMatchObject({ rowCount: 1 });
    });

    it('rejects bound rows without complete authority, unknown numeric bills and cross-principal run links', async () => {
      await expect(
        runtime?.pool.query(
          `UPDATE generation_execution_receipts
      SET binding_state='bound',binding=$1 WHERE id='legacy-ordinary'`,
          [JSON.stringify({ ...binding, principalId: 'legacy-principal' })],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runtime?.pool.query(
          "UPDATE generation_execution_receipts SET cost_points=0 WHERE id='legacy-retry'",
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runtime?.pool.query(
          "UPDATE generation_runs SET execution_receipt_id='other-receipt' WHERE id='legacy-ordinary'",
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        runtime?.pool.query(
          `UPDATE generation_execution_receipts SET binding_state='bound', binding=$1,
      authorizing_session_id='synthetic-session',auth_revision=1,logical_input_digest=$2,final_request_digest=$2
      WHERE id='legacy-retry'`,
          [JSON.stringify({ ...binding, principalId: 'legacy-principal' }), 'a'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('retains every receipt after run, scheme and user deletion and keeps the original key occupied', async () => {
      await runtime?.pool.query("DELETE FROM generation_runs WHERE user_id='legacy-principal'");
      await runtime?.pool.query("DELETE FROM design_scheme_runs WHERE user_id='legacy-principal'");
      await runtime?.pool.query("DELETE FROM design_schemes WHERE user_id='legacy-principal'");
      await runtime?.pool.query(
        "DELETE FROM \"user\" WHERE id IN ('legacy-principal','other-principal')",
      );
      expect(
        (
          await runtime?.pool.query(
            'SELECT count(*)::int AS count FROM generation_execution_receipts',
          )
        )?.rows[0].count,
      ).toBe(5);
      await expect(
        runtime?.pool.query(`INSERT INTO generation_execution_receipts
      (id,principal_id,idempotency_key,operation,original_run_id,binding_state,status,cost_provenance)
      VALUES ('replay-after-delete','legacy-principal','scheme:ordinary-key','ordinary_create',
      'replay-after-delete','legacy_unbound','queued','unknown')`),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('holds real account locks through a caller transaction and refuses a rotated credential afterwards', async () => {
      const r = runtime;
      if (!r) throw new Error('PostgreSQL fixture was not initialized');
      await r.pool.query(
        `INSERT INTO account_identities
      (user_id,api_issuer,upstream_issuer,upstream_owner_id,status,identity_version,verified_at)
      VALUES ($1,$2,$3,$4,'active',1,now())`,
        [binding.principalId, binding.apiIssuer, binding.payer.issuer, binding.payer.ownerId],
      );
      await r.pool.query(
        `INSERT INTO account_credentials
      (user_id,ciphertext,upstream_issuer,upstream_owner_id,credential_ref,credential_version,status,verified_at)
      VALUES ($1,'synthetic-envelope',$2,$3,$4,1,'active',now())`,
        [binding.principalId, binding.payer.issuer, binding.payer.ownerId, binding.credential.ref],
      );
      await r.pool.query(
        `INSERT INTO session (id,user_id,token,expires_at)
      VALUES ('authority-session',$1,'synthetic-session-token',now()+interval '1 hour')`,
        [binding.principalId],
      );
      await r.pool.query(
        `INSERT INTO account_session_authorizations (session_id,user_id,mode)
      VALUES ('authority-session',$1,'normal')`,
        [binding.principalId],
      );
      let release = () => {};
      let locked = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const transaction = r.db.transaction(async (tx) => {
        const result = await lockGenerationExecutionAuthority(tx, authorityInput);
        locked();
        await held;
        return result;
      });
      const writer = await r.pool.connect();
      try {
        await Promise.race([ready, transaction]);
        await writer.query("SET lock_timeout='100ms'");
        await expect(
          writer.query(
            "UPDATE account_credentials SET credential_version=2 WHERE user_id='authority-principal'",
          ),
        ).rejects.toMatchObject({ code: '55P03' });
      } finally {
        release();
        writer.release();
      }
      expect((await transaction).binding).toEqual(binding);
      await r.pool.query(
        "UPDATE account_credentials SET credential_version=2 WHERE user_id='authority-principal'",
      );
      await expect(
        r.db.transaction((tx) => lockGenerationExecutionAuthority(tx, authorityInput)),
      ).rejects.toMatchObject({ reason: 'binding_changed' });
    });
  },
);
