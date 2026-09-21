import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDesktopSyncApp } from '../../../__tests__/fixtures/desktop-sync-app.js';
import {
  purgeHttp,
  purgeLogin,
  seedPurgeScheme,
  waitForPgBlock,
} from '../../../__tests__/fixtures/scheme-purge.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('scheme purge through production API bin, Better Auth and real PostgreSQL', () => {
  let app: Awaited<ReturnType<typeof startDesktopSyncApp>>;
  let alice: Awaited<ReturnType<typeof purgeLogin>>, bob: Awaited<ReturnType<typeof purgeLogin>>;
  beforeAll(async () => {
    app = await startDesktopSyncApp();
    alice = await purgeLogin(app, 'b67-alice');
    bob = await purgeLogin(app, 'b67-bob');
  }, 180000);
  afterAll(async () => {
    await app?.close();
  });
  const seed = () => seedPurgeScheme(app.database, alice.id);
  const request = (schemeId: string, expectedVersion = 2) =>
    purgeHttp(app, alice.token, { schemeId, expectedVersion });
  const exists = async (id: string) =>
    (await app.database.pool.query('SELECT id FROM design_schemes WHERE id=$1', [id])).rowCount;

  it('rejects missing authentication, another owner, invalid input, stale versions and live schemes', async () => {
    const f = await seed();
    const body = { schemeId: f.schemeId, expectedVersion: 2 };
    expect((await purgeHttp(app, undefined, body)).status).toBe(401);
    expect((await purgeHttp(app, bob.token, body)).status).toBe(404);
    expect((await purgeHttp(app, alice.token, { ...body, confirmed: true })).status).toBe(400);
    expect((await request(f.schemeId, 1)).status).toBe(409);
    await app.database.pool.query('UPDATE design_schemes SET deleted_at=NULL WHERE id=$1', [
      f.schemeId,
    ]);
    expect((await request(f.schemeId)).status).toBe(400);
    expect(await exists(f.schemeId)).toBe(1);
  });

  it('preserves generation cost, frozen references and readable run receipts while deleting imported sources', async () => {
    const f = await seed(),
      generationId = randomUUID();
    await app.database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,design_scheme_run_id,cost_points)
      VALUES($1,$2,'succeeded','{}',$3,37)`,
      [generationId, alice.id, f.runId],
    );
    await app.database.pool.query(
      `INSERT INTO design_scheme_generation_references
      (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
      VALUES($1,$2,$3,0,$4,'Frozen.png','image/png',5,$5)`,
      [generationId, alice.id, randomUUID(), f.assetKey, 'a'.repeat(64)],
    );
    const before = (
      await app.database.pool.query('SELECT * FROM generation_runs WHERE id=$1', [generationId])
    ).rows;
    const response = await request(f.schemeId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemeId: f.schemeId,
      purged: true,
      retiredKeys: 1,
      deferredKeys: 1,
    });
    expect(await exists(f.schemeId)).toBe(0);
    expect(
      (await app.database.pool.query('SELECT * FROM generation_runs WHERE id=$1', [generationId]))
        .rows,
    ).toEqual(before);
    expect(
      (
        await app.database.pool.query(
          'SELECT scheme_id,revision_id,origin_scheme_id,origin_revision_id,result FROM design_scheme_runs WHERE run_id=$1',
          [f.runId],
        )
      ).rows[0],
    ).toEqual({
      scheme_id: null,
      revision_id: null,
      origin_scheme_id: f.schemeId,
      origin_revision_id: f.revisionId,
      result: f.result,
    });
    const read = await fetch(`${app.ready.baseUrl}/api/v1/design-schemes/runs/${f.runId}`, {
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(f.result);
    expect(
      (
        await app.database.pool.query('SELECT id FROM design_scheme_source_snapshots WHERE id=$1', [
          f.snapshotId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await app.database.pool.query(
          'SELECT reason FROM object_cleanup_queue WHERE object_key=$1',
          [f.sourceKey],
        )
      ).rows,
    ).toEqual([{ reason: 'design_scheme_purge' }]);
  });

  it('refuses active runs without cancelling or changing their paid execution', async () => {
    const f = await seed();
    await app.database.pool.query(
      "UPDATE design_scheme_runs SET status='executing' WHERE run_id=$1",
      [f.runId],
    );
    expect((await request(f.schemeId)).status).toBe(409);
    expect(await exists(f.schemeId)).toBe(1);
    await app.database.pool.query(
      "UPDATE design_scheme_runs SET status='completed' WHERE run_id=$1",
      [f.runId],
    );
    expect((await request(f.schemeId)).status).toBe(200);
  });

  it('serializes repeated requests and fences scheme/revision identity resurrection', async () => {
    const f = await seed();
    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const r = await request(f.schemeId);
        expect(r.status).toBe(200);
        return r.json();
      }),
    );
    for (const result of results)
      expect(result).toEqual({
        schemeId: f.schemeId,
        purged: true,
        retiredKeys: 2,
        deferredKeys: 0,
      });
    expect((await request(f.schemeId, 1)).status).toBe(409);
    expect(
      (await purgeHttp(app, bob.token, { schemeId: f.schemeId, expectedVersion: 2 })).status,
    ).toBe(404);
    await expect(
      app.database.pool.query(
        `INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity)
      VALUES($1,$2,'Resurrect','musefold-created',$3,'faithful')`,
        [f.schemeId, alice.id, f.revisionId],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    const other = await seed();
    await expect(
      app.database.pool.query(
        `INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
      VALUES($1,$2,$3,1,$4,'user')`,
        [
          f.revisionId,
          other.schemeId,
          alice.id,
          JSON.stringify({ schemeId: other.schemeId, revisionId: f.revisionId }),
        ],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('keeps shared snapshots until their final scheme binding is removed', async () => {
    const first = await seed(),
      second = await seed();
    await app.database.pool.query(
      `INSERT INTO design_scheme_source_bindings(revision_id,source_snapshot_id,user_id,role) VALUES($1,$2,$3,'reference')`,
      [second.revisionId, first.snapshotId, alice.id],
    );
    expect((await request(first.schemeId)).status).toBe(200);
    expect(
      (
        await app.database.pool.query(
          'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
          [first.snapshotId],
        )
      ).rows,
    ).toEqual([{ object_key: first.sourceKey }]);
    expect(
      (
        await app.database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [first.sourceKey],
        )
      ).rowCount,
    ).toBe(0);
    expect((await request(second.schemeId)).status).toBe(200);
    expect(
      (
        await app.database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [first.sourceKey],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('rolls back references, detached runs, tombstones and retirement on an outbox failure', async () => {
    const f = await seed();
    await app.database.pool.query(`CREATE FUNCTION purge_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.object_key='${f.sourceKey}' THEN RAISE EXCEPTION 'Synthetic outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER purge_test_fail BEFORE INSERT ON object_cleanup_queue FOR EACH ROW EXECUTE FUNCTION purge_test_fail()`);
    try {
      expect((await request(f.schemeId)).status).toBe(500);
      expect(await exists(f.schemeId)).toBe(1);
      expect(
        (
          await app.database.pool.query(
            'SELECT scheme_id,revision_id FROM design_scheme_runs WHERE run_id=$1',
            [f.runId],
          )
        ).rows[0],
      ).toEqual({ scheme_id: f.schemeId, revision_id: f.revisionId });
      expect(
        (
          await app.database.pool.query(
            'SELECT scheme_id FROM design_scheme_purge_identities WHERE scheme_id=$1',
            [f.schemeId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await app.database.pool.query(
            "SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
            [f.assetKey],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await app.database.pool.query(
        'DROP TRIGGER purge_test_fail ON object_cleanup_queue; DROP FUNCTION purge_test_fail()',
      );
    }
    expect((await request(f.schemeId)).status).toBe(200);
  });

  it('leaves prepared source bytes under their existing upload and confirmation lifetime', async () => {
    const f = await seed();
    await app.database.pool.query(
      `INSERT INTO design_scheme_source_preparations
      (user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,expires_at,upload_lease_until)
      VALUES($1,$2,$3,$4,'{}','reading',$5,now()+interval '1 hour',now()+interval '10 minutes')`,
      [alice.id, randomUUID(), randomUUID(), 'a'.repeat(64), f.snapshotId],
    );
    const response = await request(f.schemeId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retiredKeys: 1, deferredKeys: 0 });
    expect(
      (
        await app.database.pool.query(
          'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
          [f.snapshotId],
        )
      ).rows,
    ).toEqual([{ object_key: f.sourceKey }]);
    expect(
      (
        await app.database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [f.sourceKey],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('observes a committed concurrent version change after waiting for the actual row lock', async () => {
    const f = await seed(),
      blocker = await app.database.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM design_schemes WHERE id=$1 FOR UPDATE', [f.schemeId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = request(f.schemeId);
      await waitForPgBlock(app.database, pid);
      await blocker.query('UPDATE design_schemes SET version=3 WHERE id=$1', [f.schemeId]);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(409);
      expect(await exists(f.schemeId)).toBe(1);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  });

  it('rejects a late binding after purge locks and removes the final imported snapshot', async () => {
    const f = await seed(),
      other = await seed(),
      blocker = await app.database.pool.connect();
    let pending: Promise<Response> | undefined;
    let binding: Promise<{ ok: boolean }> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT musefold_lock_storage_key($1)', [f.assetKey]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = request(f.schemeId);
      const purger = await waitForPgBlock(app.database, pid);
      binding = app.database.pool
        .query(
          `INSERT INTO design_scheme_source_bindings(revision_id,source_snapshot_id,user_id,role)
        VALUES($1,$2,$3,'reference')`,
          [other.revisionId, f.snapshotId, alice.id],
        )
        .then(
          () => ({ ok: true }),
          (error) => {
            expect(error.code).toBe('23503');
            return { ok: false };
          },
        );
      await waitForPgBlock(app.database, purger);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(200);
      expect(await binding).toEqual({ ok: false });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await binding;
    }
  });

  it('rejects a session whose authority was revoked without deleting data', async () => {
    const f = await seed();
    await app.database.pool.query(
      "UPDATE account_session_authorizations SET mode='recovery_only' WHERE user_id=$1",
      [alice.id],
    );
    try {
      expect((await request(f.schemeId)).status).toBeGreaterThanOrEqual(400);
      expect(await exists(f.schemeId)).toBe(1);
    } finally {
      await app.database.pool.query(
        "UPDATE account_session_authorizations SET mode='normal' WHERE user_id=$1",
        [alice.id],
      );
    }
  });
});
