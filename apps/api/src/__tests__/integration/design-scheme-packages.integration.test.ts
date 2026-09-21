import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, retireDesignSchemePackageStages } from '@musefold/db';
import { designSchemePackageStageSchema, type DesignSchemePackageStage } from '@musefold/contracts';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import { designSchemePackageRoutes } from '../../modules/design-scheme-packages/routes.js';
import { packageFixture } from '../../modules/design-scheme-packages/__tests__/fixture.js';
import { packageHash } from '../../modules/design-scheme-packages/bytes.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import {
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const OWNER = 'package-owner';
const OTHER = 'package-other';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });

describeDb('cloud package staging: actual PG, S3 SDK and binary HTTP', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let service: DesignSchemePackageService;
  let bytes: Buffer;
  let server: ReturnType<typeof serve>;
  let base: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    });
    for (const id of [OWNER, OTHER]) {
      await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
        id,
        `${id}@example.test`,
      ]);
      await seedGenerationAuthority(database.db, { principalId: id, ownerId: id });
    }
    s3 = await startS3Fixture(256 * 1024 * 1024);
    service = new DesignSchemePackageService(database.db, s3.storage);
    bytes = await packageFixture();
    const app = new OpenAPIHono<AuthedEnv>();
    // Explicit synthetic session resolution; service still locks real identity/session/auth rows.
    app.use('*', async (c, next) => {
      const owner = c.req.header('x-test-owner');
      if (!owner || ![OWNER, OTHER].includes(owner)) return c.json({ error: 'unauthorized' }, 401);
      c.set('userId', owner);
      c.set('sessionId', generationAuthSession(owner));
      await next();
    });
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'package-test'), error.status as 400);
      throw error;
    });
    app.route('/', designSchemePackageRoutes(service));
    app.post('/unrelated-json', async (c) => c.json({ length: (await c.req.text()).length }));
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    base = `http://127.0.0.1:${address.port}/design-schemes/packages`;
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM design_scheme_package_stages');
    await database.pool.query('DELETE FROM generation_reference_uploads');
    await database.pool.query('DELETE FROM object_cleanup_queue');
    s3.objects.clear();
    s3.writes.length = 0;
    s3.state.failPutAfterWrite = false;
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='normal', revision=1",
    );
  });
  afterAll(async () => {
    if (server) {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await s3?.close();
    await database?.pool.end();
    await container?.stop();
  });
  const intent = () => ({
    requestId: randomUUID(),
    packageHash: packageHash(bytes),
    sizeBytes: bytes.length,
    formatVersion: 2 as const,
  });
  async function begin() {
    return service.begin(OWNER, generationAuthSession(OWNER), intent());
  }
  async function ready() {
    const stage = await begin();
    return service.upload(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      stream(bytes),
    );
  }
  function decision(stage: DesignSchemePackageStage) {
    if (!stage.confirmationHash) throw new Error('Missing confirmation');
    return {
      packageHash: stage.packageHash,
      formatVersion: stage.formatVersion,
      parserVersion: stage.parserVersion,
      confirmationHash: stage.confirmationHash,
      decision: 'confirm' as const,
    };
  }
  async function row(id: string) {
    return (
      await database.pool.query('SELECT * FROM design_scheme_package_stages WHERE id=$1', [id])
    ).rows[0];
  }

  it('registers owner/request/object/outbox before PUT, streams unknown length HTTP, and confirms exact durable content', async () => {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-owner': OWNER },
      body: JSON.stringify(intent()),
    });
    expect(response.status).toBe(200);
    const staged = designSchemePackageStageSchema.parse(await response.json());
    const stored = await row(staged.stagedPackageId);
    expect(staged.status).toBe('awaiting_upload');
    expect(s3.writes).toHaveLength(0);
    expect(
      (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
          stored.object_key,
        ])
      ).rows,
    ).toHaveLength(1);
    const uploaded = await fetch(`${base}/${staged.stagedPackageId}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-test-owner': OWNER },
      body: stream(bytes),
      duplex: 'half',
    } as RequestInit);
    expect(uploaded.status).toBe(200);
    const stage = designSchemePackageStageSchema.parse(await uploaded.json());
    expect(stage.status).toBe('ready');
    expect(stage.preview?.name).toBe('导入方案');
    expect(s3.objects.get(stored.object_key)).toEqual(bytes);
    expect(JSON.stringify(stage)).not.toMatch(/objectKey|object_key|authorityHash|token/);
    const fresh = new DesignSchemePackageService(database.db, s3.storage);
    expect(await fresh.get(OWNER, stage.stagedPackageId)).toEqual(stage);
    const confirmed = await fresh.decide(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      decision(stage),
    );
    expect(confirmed.status).toBe('confirmed');
    expect(
      await fresh.decide(
        OWNER,
        generationAuthSession(OWNER),
        stage.stagedPackageId,
        decision(stage),
      ),
    ).toEqual(confirmed);
    expect((await database.pool.query('SELECT count(*) FROM design_schemes')).rows[0].count).toBe(
      '0',
    );
  });
  it('deduplicates concurrent begins while refusing changed bytes under the same request', async () => {
    const input = intent();
    const result = await Promise.all(
      Array.from({ length: 5 }, () => service.begin(OWNER, generationAuthSession(OWNER), input)),
    );
    expect(new Set(result.map((s) => s.stagedPackageId)).size).toBe(1);
    await expect(
      service.begin(OWNER, generationAuthSession(OWNER), { ...input, packageHash: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await database.pool.query('SELECT count(*) FROM generation_reference_uploads')).rows[0]
        .count,
    ).toBe('1');
  });
  it('rejects unauthenticated HTTP and cross-owner status, upload and confirmation without object writes', async () => {
    const stage = await begin();
    expect((await fetch(`${base}/${stage.stagedPackageId}`)).status).toBe(401);
    expect(
      (await fetch(`${base}/${stage.stagedPackageId}`, { headers: { 'x-test-owner': OTHER } }))
        .status,
    ).toBe(404);
    await expect(
      service.upload(OTHER, generationAuthSession(OTHER), stage.stagedPackageId, stream(bytes)),
    ).rejects.toMatchObject({ status: 404 });
    expect(s3.writes).toHaveLength(0);
  });
  it.each(['truncated', 'oversized', 'wrong-hash', 'not-zip'] as const)(
    'rejects %s using actual bytes and retains cleanup identity',
    async (fault) => {
      let input = intent();
      let actual = bytes;
      if (fault === 'truncated') actual = bytes.subarray(1);
      if (fault === 'oversized') actual = Buffer.concat([bytes, Buffer.from('x')]);
      if (fault === 'wrong-hash') input.packageHash = 'f'.repeat(64);
      if (fault === 'not-zip') {
        actual = Buffer.from('invalid archive');
        input = { ...input, sizeBytes: actual.length, packageHash: packageHash(actual) };
      }
      const stage = await service.begin(OWNER, generationAuthSession(OWNER), input);
      await expect(
        service.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(actual)),
      ).rejects.toBeInstanceOf(AppError);
      expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('failed');
      expect(s3.writes).toHaveLength(0);
      expect(
        (await database.pool.query('SELECT count(*) FROM object_cleanup_queue')).rows[0].count,
      ).toBe('1');
    },
  );
  it('does not overwrite a package on concurrent uploads or replay', async () => {
    const stage = await begin();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(bytes)),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s3.writes).toHaveLength(1);
    expect(
      (
        await service.upload(
          OWNER,
          generationAuthSession(OWNER),
          stage.stagedPackageId,
          stream(Buffer.from('other')),
        )
      ).status,
    ).toBe('ready');
    expect(s3.writes).toHaveLength(1);
  });
  it('cancellation wins against a PUT completing later and keeps cleanup fenced', async () => {
    const stage = await begin();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const held = new Promise<void>((r) => {
      release = r;
    });
    const delayed = new DesignSchemePackageService(database.db, {
      read: (key) => s3.storage.read(key),
      put: async (...args) => {
        entered();
        await held;
        await s3.storage.put(...args);
      },
    });
    const result = delayed.upload(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      stream(bytes),
    );
    const rejected = expect(result).rejects.toMatchObject({ status: 409 });
    await started;
    expect(
      (await service.cancel(OWNER, generationAuthSession(OWNER), stage.stagedPackageId)).status,
    ).toBe('cancelled');
    const record = await row(stage.stagedPackageId);
    expect(record.upload_lease_until.getTime()).toBeGreaterThan(Date.now());
    release();
    await rejected;
    expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('cancelled');
    expect(
      (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
          record.object_key,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('refuses changed confirmation, stored bytes, expired staging and changed authorization', async () => {
    const stage = await ready();
    const record = await row(stage.stagedPackageId);
    await expect(
      service.decide(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, {
        ...decision(stage),
        confirmationHash: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ status: 409 });
    s3.objects.set(record.object_key, Buffer.from('replaced object'));
    await expect(
      service.decide(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, decision(stage)),
    ).rejects.toMatchObject({ status: 400 });
    s3.objects.set(record.object_key, bytes);
    await database.pool.query(
      'UPDATE account_session_authorizations SET revision=revision+1 WHERE user_id=$1',
      [OWNER],
    );
    await expect(
      service.decide(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, decision(stage)),
    ).rejects.toMatchObject({ status: 409 });
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET expires_at=now()-interval '1 second' WHERE id=$1",
      [stage.stagedPackageId],
    );
    await expect(
      service.decide(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, decision(stage)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await retireDesignSchemePackageStages(database.db)).toBe(1);
    expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('expired');
  });
  it('retains ambiguous S3 PUT cleanup after a failure without exposing transport secrets', async () => {
    s3.state.failPutAfterWrite = true;
    const stage = await begin();
    await expect(
      service.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(bytes)),
    ).rejects.toMatchObject({ status: 503 });
    expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('failed');
    expect(s3.objects.size).toBe(1);
    expect(
      (await database.pool.query('SELECT count(*) FROM object_cleanup_queue')).rows[0].count,
    ).toBe('1');
  });
  it('bounds per-owner active packages and permits cancelling to release admission', async () => {
    const stages = await Promise.all([1, 2, 3].map(() => begin()));
    await expect(begin()).rejects.toMatchObject({ status: 429 });
    await service.cancel(OWNER, generationAuthSession(OWNER), stages[0].stagedPackageId);
    expect((await begin()).status).toBe('awaiting_upload');
  });
  it('rejects an oversized JSON intent before parsing and registering it', async () => {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-owner': OWNER },
      body: JSON.stringify({ ...intent(), padding: 'x'.repeat(9000) }),
    });
    expect(response.status).toBe(413);
    expect(
      (await database.pool.query('SELECT count(*) FROM design_scheme_package_stages')).rows[0]
        .count,
    ).toBe('0');
  });
  it.each(['hold', 'hold-after-put'])(
    'persists %s across SIGKILL and a genuinely different Node process',
    async (mode) => {
      const stage = await begin();
      const cwd = fileURLToPath(new URL('../../..', import.meta.url));
      const env = {
        ...process.env,
        DATABASE_URL: container.getConnectionUri(),
        BETTER_AUTH_SECRET: 'fixture-auth-secret',
        NEW_API_BASE_URL: 'http://127.0.0.1:1',
        CREDENTIAL_ENCRYPTION_KEY: 'fixture-encryption-key',
        S3_ENDPOINT: s3.endpoint,
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'test-scheme-assets',
        S3_ACCESS_KEY_ID: 'fixture-key',
        S3_SECRET_ACCESS_KEY: 'fixture-secret',
      };
      const args = ['exec', 'tsx', 'src/__tests__/fixtures/package-stage-process.ts'];
      const child = spawn(
        'pnpm',
        [...args, mode, OWNER, generationAuthSession(OWNER), stage.stagedPackageId],
        { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      const exited = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', () => resolve());
      });
      let pid = 0;
      try {
        await expect
          .poll(async () => (await row(stage.stagedPackageId)).status, { timeout: 15_000 })
          .toBe('uploading');
        if (mode === 'hold-after-put')
          await expect.poll(() => s3.writes.length, { timeout: 15_000 }).toBe(1);
        pid = Number(stdout.match(/PACKAGE_PID=(\d+)/)?.[1]);
        expect(pid).toBeGreaterThan(0);
        process.kill(pid, 'SIGKILL');
        await exited;
        const next = await promisify(execFile)(
          'pnpm',
          [...args, 'get', OWNER, generationAuthSession(OWNER), stage.stagedPackageId],
          { cwd, env },
        );
        expect(Number(next.stdout.match(/PACKAGE_PID=(\d+)/)?.[1])).not.toBe(pid);
        const recovered = JSON.parse(next.stdout.match(/PACKAGE_RESULT=(.+)/)?.[1] ?? '{}');
        expect(recovered.status).toBe('uploading');
        expect(s3.writes).toHaveLength(mode === 'hold-after-put' ? 1 : 0);
        // Explicit clock boundary injection after real process death; no automatic re-upload.
        await database.pool.query(
          "UPDATE design_scheme_package_stages SET upload_lease_until=now()-interval '1 second' WHERE id=$1",
          [stage.stagedPackageId],
        );
        expect(await retireDesignSchemePackageStages(database.db)).toBe(1);
        await expect(
          service.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(bytes)),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
        child.kill();
        await exited;
      }
    },
    30_000,
  );
  it('scopes metadata limits to package endpoints so other API bodies retain their own policy', async () => {
    const response = await fetch(base.replace('/design-schemes/packages', '/unrelated-json'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-owner': OWNER },
      body: 'x'.repeat(9000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ length: 9000 });
  });
  it('stages a real legacy v1 ZIP while keeping preview images separate from formal/trial authority', async () => {
    const old = await readFile(new URL('../fixtures/legacy-design-package.bin', import.meta.url));
    const stage = await service.begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      sizeBytes: old.length,
      packageHash: packageHash(old),
      formatVersion: 1,
    });
    const uploaded = await service.upload(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      stream(old),
    );
    expect(uploaded).toMatchObject({
      status: 'ready',
      formatVersion: 1,
      preview: { legacyPreviewCount: 1, sourceCount: 0, imageCount: 0 },
    });
    expect(
      (
        await service.decide(
          OWNER,
          generationAuthSession(OWNER),
          stage.stagedPackageId,
          decision(uploaded),
        )
      ).status,
    ).toBe('confirmed');
    expect(
      (await database.pool.query('SELECT count(*) FROM design_scheme_assets')).rows[0].count,
    ).toBe('0');
  });
  it('rolls back ready metadata and registry finalization together if the final transaction fails', async () => {
    const stage = await begin();
    await database.pool.query(`CREATE FUNCTION reject_package_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic finalization failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_package_ready BEFORE UPDATE ON design_scheme_package_stages FOR EACH ROW EXECUTE FUNCTION reject_package_ready()`);
    try {
      await expect(
        service.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(bytes)),
      ).rejects.toMatchObject({ status: 503 });
      const stored = await row(stage.stagedPackageId);
      expect(stored).toMatchObject({ status: 'failed', preview: null, confirmation_hash: null });
      expect(
        (
          await database.pool.query('SELECT status FROM generation_reference_uploads WHERE id=$1', [
            stage.stagedPackageId,
          ])
        ).rows[0].status,
      ).toBe('cleanup_pending');
      expect(s3.objects.has(stored.object_key)).toBe(true);
      expect(
        (await database.pool.query('SELECT count(*) FROM object_cleanup_queue')).rows[0].count,
      ).toBe('1');
    } finally {
      await database.pool.query(
        'DROP TRIGGER reject_package_ready ON design_scheme_package_stages; DROP FUNCTION reject_package_ready()',
      );
    }
  });
  it('rechecks authorization after a real PUT instead of trusting the session admitted before IO', async () => {
    const stage = await begin();
    const changing = new DesignSchemePackageService(database.db, {
      read: (key) => s3.storage.read(key),
      put: async (...args) => {
        await s3.storage.put(...args);
        await database.pool.query(
          'UPDATE account_session_authorizations SET revision=revision+1 WHERE user_id=$1',
          [OWNER],
        );
      },
    });
    await expect(
      changing.upload(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, stream(bytes)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('failed');
    expect(s3.objects.size).toBe(1);
  });
});
