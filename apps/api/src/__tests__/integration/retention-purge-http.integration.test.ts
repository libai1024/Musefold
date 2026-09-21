import { setTimeout as delay } from 'node:timers/promises';
import {
  cloudGenerationRequestSchema,
  generationExecutionReceiptSchema,
  syncBootstrapPageSchema,
} from '@musefold/contracts';
import { purgeGenerationRetentionBatch, purgePromptRetentionBatch } from '@musefold/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startDesktopSyncApp } from '../fixtures/desktop-sync-app.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const identitySchema = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string().min(1) }),
});
describeDb('irreversible retention across actual HTTP/auth, reads and restores', () => {
  let app: Awaited<ReturnType<typeof startDesktopSyncApp>>;
  let identity: z.infer<typeof identitySchema>;
  beforeEach(async () => {
    app = await startDesktopSyncApp();
    const login = await fetch(`${app.ready.baseUrl}/api/auth/sign-in/new-api`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: app.ready.baseUrl,
        'x-musefold-login-binding': 'synthetic-retention-main-process-binding-123456',
      },
      body: JSON.stringify({ email: 'b67-alice', password: 'fixture-password' }),
    });
    expect(login.status).toBe(200);
    identity = identitySchema.parse(await login.json());
    expect(
      (await request('/account/login-sessions/touch', 'POST', { acknowledge: true })).status,
    ).toBe(200);
  }, 180000);
  afterEach(async () => {
    await app?.close();
  });
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${app.ready.baseUrl}/api/v1${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${identity.token}`,
        origin: app.ready.baseUrl,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function seed(cost: 'known' | 'unknown' = 'known') {
    const pool = app.database.pool;
    // Owned historical SQL records exercise retention; no upstream generation or paid admission.
    await pool.query(
      `INSERT INTO generation_execution_receipts(id,principal_id,idempotency_key,operation,original_run_id,binding_state,status,dispatch,cost_provenance,cost_points,terminal_at)
      VALUES ('owned-receipt',$1,'owned-retention-key','ordinary_create','owned-run','legacy_unbound',$2,'claimed',$3,$4,now())`,
      [
        identity.user.id,
        cost === 'known' ? 'succeeded' : 'failed',
        cost === 'known' ? 'provider_reported' : 'unknown',
        cost === 'known' ? 3 : null,
      ],
    );
    await pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,cost_points,execution_receipt_id,idempotency_key)
      VALUES ('owned-run',$1,$2,$3,now()-interval '31 days',$4,'owned-receipt','owned-retention-key')`,
      [
        identity.user.id,
        cost === 'known' ? 'succeeded' : 'failed',
        JSON.stringify(cloudGenerationRequestSchema.parse({ prompt: 'Owned historical prompt' })),
        cost === 'known' ? 3 : null,
      ],
    );
    await pool.query(
      `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
      SELECT 'asset-'||lpad(n::text,4,'0'),'owned-run',$1,'owned/retention/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(0,1000) n`,
      [identity.user.id],
    );
    await pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ('owned-prompt',$1,'Owned','Full original content',now()-interval '31 days')`,
      [identity.user.id],
    );
    await pool.query(
      `INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
      SELECT $1,'usage-'||n,'owned-prompt','copy' FROM generate_series(0,1000) n`,
      [identity.user.id],
    );
  }
  async function receipt() {
    const response = await request('/generations/receipts/by-key?key=owned-retention-key');
    expect(response.status).toBe(200);
    return generationExecutionReceiptSchema.parse(await response.json());
  }

  it.each(['known', 'unknown'] as const)(
    '%s cost remains while partial results disappear from reads/restores and cleanup resumes',
    async (cost) => {
      await seed(cost);
      expect((await request('/prompts/owned-prompt')).status).toBe(200);
      expect((await request('/generations/owned-run')).status).toBe(200);
      const before = await receipt();
      expect((await purgeGenerationRetentionBatch(app.database.db)).purged).toBe(0);
      expect(await purgePromptRetentionBatch(app.database.db)).toEqual({ purged: 0 });
      for (const path of [
        '/prompts/owned-prompt',
        '/generations/owned-run',
        '/assets/asset-1000/url',
        '/assets/asset-1000/content',
      ]) {
        expect((await request(path)).status, path).toBe(404);
      }
      for (const path of [
        '/prompts/owned-prompt/restore',
        '/generations/owned-run/restore',
        '/prompts/owned-prompt/purge',
        '/generations/owned-run/purge',
      ]) {
        expect((await request(path, 'POST', {})).status, path).toBe(404);
      }
      for (const path of ['/prompts?includeDeleted=true', '/generations?includeDeleted=true']) {
        const response = await request(path);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ items: [] });
      }
      const bootstrap = await request('/sync/bootstrap?entity=prompt&limit=100');
      expect(bootstrap.status).toBe(200);
      expect(syncBootstrapPageSchema.parse(await bootstrap.json()).items).toEqual([]);
      expect(await (await request('/prompts/empty-trash', 'POST', {})).json()).toEqual({
        purged: 0,
      });
      expect(
        await (await request('/generations/cleanup', 'POST', { scope: 'empty-trash' })).json(),
      ).toEqual({ affected: 0 });
      const after = await receipt();
      expect(after).toEqual({
        ...before,
        purgedAt: expect.any(String),
        updatedAt: expect.any(String),
        revision: before.revision + 1,
      });
      expect((await purgeGenerationRetentionBatch(app.database.db)).purged).toBe(1);
      expect(await purgePromptRetentionBatch(app.database.db)).toEqual({ purged: 1 });
      expect(await receipt()).toEqual(after);
      expect(
        (await app.database.pool.query('SELECT count(*)::int AS n FROM object_cleanup_queue'))
          .rows[0].n,
      ).toBe(1001);
    },
  );

  it('restoring before the first batch keeps all children and the original receipt', async () => {
    await seed();
    const before = await receipt();
    expect((await request('/generations/owned-run/restore', 'POST', {})).status).toBe(200);
    expect((await request('/prompts/owned-prompt/restore', 'POST', {})).status).toBe(200);
    expect(await purgeGenerationRetentionBatch(app.database.db)).toEqual({
      purged: 0,
      objectKeys: [],
    });
    expect(await purgePromptRetentionBatch(app.database.db)).toEqual({ purged: 0 });
    expect(
      (await app.database.pool.query('SELECT count(*)::int AS n FROM generation_assets')).rows[0].n,
    ).toBe(1001);
    expect(
      (await app.database.pool.query('SELECT count(*)::int AS n FROM prompt_usage_events')).rows[0]
        .n,
    ).toBe(1001);
    expect(await receipt()).toEqual(before);
  });

  it('a restore already waiting behind maintenance cannot revive its newly partial result', async () => {
    await seed();
    const holder = await app.database.pool.connect();
    let maintenance: ReturnType<typeof purgeGenerationRetentionBatch> | undefined;
    let restore: Promise<Response> | undefined;
    const waitForLock = async (fragment: string) => {
      const until = Date.now() + 1200;
      while (Date.now() < until) {
        const rows = await app.database.pool.query(
          `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,
          [`%${fragment}%`],
        );
        if (rows.rowCount) return;
        await delay(10);
      }
      throw new Error('Owned operation did not reach its row-lock barrier');
    };
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT id FROM generation_assets WHERE id='asset-0000' FOR UPDATE");
      maintenance = purgeGenerationRetentionBatch(app.database.db);
      await waitForLock('DELETE FROM "generation_assets"');
      restore = request('/generations/owned-run/restore', 'POST', {});
      await waitForLock('update "generation_runs"');
      await holder.query('COMMIT');
      expect((await maintenance).purged).toBe(0);
      expect((await restore).status).toBe(404);
      expect(
        (
          await app.database.pool.query(
            "SELECT deleted_at,purge_started_at FROM generation_runs WHERE id='owned-run'",
          )
        ).rows[0],
      ).toMatchObject({ deleted_at: expect.any(Date), purge_started_at: expect.any(Date) });
    } finally {
      await holder.query('ROLLBACK');
      await Promise.allSettled([maintenance, restore]);
      holder.release();
    }
  });
});
