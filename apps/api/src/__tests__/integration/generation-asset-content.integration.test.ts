import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createDatabase, migrateDatabase } from '@musefold/db';
import type { NewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { type AuthedEnv, requireSession } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { MAX_GENERATION_ASSET_BYTES } from '../../modules/generation/asset-content.js';
import { startAssetS3Fixture } from '../../modules/generation/__tests__/asset-s3-fixture.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import { GenerationService } from '../../modules/generation/service.js';
import { inspectSchemeImage } from '../../modules/design-scheme-assets/image.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'asset-content-owner';
const FOREIGN = 'asset-content-foreign';

describeDb('same-origin generation content (real BA, PostgreSQL and local S3 HTTP)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof startAssetS3Fixture>>;
  let app: OpenAPIHono<AuthedEnv>;
  let generation: GenerationService;
  let png: Buffer;
  let runId: string;
  let assetId: string;
  let objectKey: string;
  let upstreamCalls = 0;
  let poolErrors = 0;
  const connectionEnds: Promise<void>[] = [];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 8 });
    database.pool.on('error', () => {
      poolErrors += 1;
    });
    database.pool.on('connect', (client) => {
      connectionEnds.push(new Promise<void>((done) => client.once('end', done)));
    });
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
    storage = await startAssetS3Fixture(30_000);
    png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#aabbcc' } })
      .png()
      .toBuffer();
    const newApi = new Proxy({} as NewApiClient, {
      get() {
        return () => {
          upstreamCalls += 1;
          throw new Error('Unexpected New API call');
        };
      },
    });
    const account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: storage.env.CREDENTIAL_ENCRYPTION_KEY,
      ...GENERATION_TEST_ISSUERS,
    });
    const auth = createAuth({
      db: database.db,
      env: storage.env,
      newApi,
      hooks: {
        prepareLogin: (input) => account.prepareLogin(input),
        commitLogin: (input) => account.commitLogin(input),
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    generation = new GenerationService(database.db, storage.signer, GENERATION_TEST_ISSUERS);
    app = new OpenAPIHono<AuthedEnv>();
    app.use('/api/v1/*', requireSession(auth, [], account));
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'asset-content-fixture'), error.status as 400);
      throw error;
    });
    app.route('/api/v1', generationRoutes(generation));
  }, 120_000);

  beforeEach(async () => {
    storage.reset();
    storage.state.bytes = png;
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('DELETE FROM generation_execution_receipts');
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$1),($2,$2,$2)', [
      OWNER,
      FOREIGN,
    ]);
    for (const [principalId, ownerId] of [
      [OWNER, '42'],
      [FOREIGN, '84'],
    ]) {
      await seedGenerationAuthority(database.db, { principalId, ownerId });
      tokens.set(
        principalId,
        (
          await database.pool.query('SELECT token FROM session WHERE id=$1', [
            generationAuthSession(principalId),
          ])
        ).rows[0].token,
      );
    }
    runId = randomUUID();
    assetId = randomUUID();
    objectKey = `users/${OWNER}/generations/${runId}/${assetId}`;
    await database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,progress,request,finished_at)
      VALUES ($1,$2,'succeeded',100,'{"prompt":"Synthetic completed output","size":"auto","quality":"auto","count":1,"referenceImages":[]}',now())`,
      [runId, OWNER],
    );
    await database.pool.query(
      `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256)
      VALUES ($1,$2,$3,$4,'image/png',3,2,$5,$6)`,
      [
        assetId,
        runId,
        OWNER,
        objectKey,
        png.length,
        createHash('sha256').update(png).digest('hex'),
      ],
    );
  });

  afterAll(async () => {
    const cleanup = await Promise.allSettled([
      storage?.close(),
      (async () => {
        await database?.pool.end();
        await Promise.all(connectionEnds);
      })(),
    ]);
    await container?.stop();
    for (const outcome of cleanup) if (outcome.status === 'rejected') throw outcome.reason;
    expect(poolErrors).toBe(0);
    expect(upstreamCalls).toBe(0);
  });

  function get(principal = OWNER, id = assetId, signal?: AbortSignal) {
    return Promise.resolve(
      app.request(`/api/v1/assets/${encodeURIComponent(id)}/content`, {
        method: 'GET',
        headers: { authorization: `Bearer ${tokens.get(principal)}` },
        signal,
      }),
    );
  }

  async function financialCounts() {
    return (
      await database.pool.query(`SELECT
      (SELECT count(*)::int FROM generation_execution_receipts) AS receipts,
      (SELECT count(*)::int FROM generation_events) AS events,
      (SELECT count(*)::int FROM graphile_worker._private_jobs) AS jobs`)
    ).rows[0];
  }

  it('returns fully verified bytes from an internal S3 origin with attachment/security headers and no execution writes', async () => {
    const before = await financialCounts();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="musefold-image.png"',
    );
    expect(response.headers.get('content-length')).toBe(String(png.length));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(storage.requests).toEqual([
      { method: 'GET', path: `/test-generation-assets/${objectKey}` },
    ]);
    expect(await financialCounts()).toEqual(before);
  });

  it('allows a valid worker output above 20 MiB while retaining the upload decoder default', async () => {
    const large = await sharp(Buffer.alloc(3000 * 2500 * 3), {
      raw: { width: 3000, height: 2500, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(large.length).toBeGreaterThan(20 * 1024 * 1024);
    expect(large.length).toBeLessThanOrEqual(MAX_GENERATION_ASSET_BYTES);
    await expect(inspectSchemeImage(large)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    storage.state.bytes = large;
    await database.pool.query(
      'UPDATE generation_assets SET width=3000,height=2500,byte_size=$1,checksum_sha256=$2 WHERE id=$3',
      [large.length, createHash('sha256').update(large).digest('hex'), assetId],
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
    ).toBe(createHash('sha256').update(large).digest('hex'));
    expect(await financialCounts()).toEqual({ receipts: 0, events: 0, jobs: 0 });
  });

  it.each(['foreign', 'unknown', 'restricted'] as const)(
    'rejects %s before any S3 read',
    async (kind) => {
      if (kind === 'restricted')
        await database.pool.query(
          "UPDATE account_session_authorizations SET mode='recovery_only',revision=revision+1 WHERE session_id=$1",
          [generationAuthSession(OWNER)],
        );
      const response = await get(
        kind === 'foreign' ? FOREIGN : OWNER,
        kind === 'unknown' ? randomUUID() : assetId,
      );
      expect(response.status).toBe(kind === 'restricted' ? 403 : 404);
      expect(storage.requests).toHaveLength(0);
      expect(await financialCounts()).toEqual({ receipts: 0, events: 0, jobs: 0 });
    },
  );

  it('requires a real BA session before accessing content', async () => {
    const response = await app.request(`/api/v1/assets/${assetId}/content`);
    expect(response.status).toBe(401);
    expect(storage.requests).toHaveLength(0);
  });

  it('rejects malformed identifiers and caller-supplied URLs/object keys before S3', async () => {
    expect((await get(OWNER, 'x'.repeat(65))).status).toBe(400);
    for (const query of ['url=https%3A%2F%2Funtrusted.test%2Fimage', 'objectKey=another-owner']) {
      const response = await app.request(`/api/v1/assets/${assetId}/content?${query}`, {
        headers: { authorization: `Bearer ${tokens.get(OWNER)}` },
      });
      expect(response.status).toBe(400);
    }
    expect(storage.requests).toHaveLength(0);
  });

  it('preserves owner access to soft-deleted history and rejects a purged asset before S3', async () => {
    await generation.remove(OWNER, runId);
    expect((await get()).status).toBe(200);
    await generation.purge(OWNER, runId);
    storage.reset();
    expect((await get()).status).toBe(404);
    expect(storage.requests).toHaveLength(0);
  });

  it('preserves the existing signed redirect endpoint', async () => {
    const response = await app.request(`/api/v1/assets/${assetId}/url`, {
      headers: { authorization: `Bearer ${tokens.get(OWNER)}` },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe(
      `/test-generation-assets/${objectKey}`,
    );
    expect(storage.requests).toHaveLength(0);
  });

  it('propagates a real HTTP client disconnect through the Hono request signal to the S3 socket', async () => {
    storage.state.mode = 'hold';
    const listener = createServer(getRequestListener(app.fetch));
    await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
    const address = listener.address() as AddressInfo;
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${address.port}/api/v1/assets/${assetId}/content`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${tokens.get(OWNER)}` },
    }).then(
      () => 'response',
      () => 'disconnected',
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const errors: unknown[] = [];
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('HTTP disconnect did not close the S3 socket')),
        2000,
      );
    });
    try {
      await Promise.race([
        storage.reached,
        pending.then(() => {
          throw new Error('HTTP read ended before S3 barrier');
        }),
        deadline,
      ]);
      controller.abort();
      expect(await pending).toBe('disconnected');
      // The production S3 deadline is 30 seconds. Closure inside this independent
      // 2-second window must originate from the actual incoming HTTP abort.
      await Promise.race([storage.closed, deadline]);
      expect(storage.requests).toHaveLength(1);
      expect(await financialCounts()).toEqual({ receipts: 0, events: 0, jobs: 0 });
    } catch (error) {
      errors.push(error);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      storage.release();
      listener.closeAllConnections();
      const outcomes = await Promise.allSettled([
        pending,
        new Promise<void>((done, reject) =>
          listener.close((error) => (error ? reject(error) : done())),
        ),
      ]);
      for (const outcome of outcomes)
        if (outcome.status === 'rejected') errors.push(outcome.reason);
    }
    if (errors.length) throw new AggregateError(errors, 'Actual HTTP disconnect regression');
  });

  it.each(['bytes', 'pixels', 'checksum'] as const)(
    'rejects invalid stored %s metadata before S3',
    async (kind) => {
      if (kind === 'bytes')
        await database.pool.query('UPDATE generation_assets SET byte_size=$1 WHERE id=$2', [
          MAX_GENERATION_ASSET_BYTES + 1,
          assetId,
        ]);
      if (kind === 'pixels')
        await database.pool.query(
          'UPDATE generation_assets SET width=16384,height=16384 WHERE id=$1',
          [assetId],
        );
      if (kind === 'checksum')
        await database.pool.query(
          "UPDATE generation_assets SET checksum_sha256='not-a-checksum' WHERE id=$1",
          [assetId],
        );
      const response = await get();
      expect(response.status).toBe(503);
      expect(storage.requests).toHaveLength(0);
    },
  );

  it.each(['invalid', 'truncated', 'hash', 'mime', 'geometry', 'size'] as const)(
    'rejects %s content inconsistencies instead of returning unverified bytes',
    async (kind) => {
      if (kind === 'invalid')
        storage.state.bytes = Buffer.from(
          '<svg><script>private-endpoint-and-object-key</script></svg>',
        );
      if (kind === 'truncated') storage.state.bytes = png.subarray(0, png.length - 20);
      if (kind === 'hash')
        storage.state.bytes = await sharp({
          create: { width: 3, height: 2, channels: 4, background: '#ccddee' },
        })
          .png()
          .toBuffer();
      if (kind === 'mime')
        await database.pool.query(
          "UPDATE generation_assets SET mime_type='image/jpeg' WHERE id=$1",
          [assetId],
        );
      if (kind === 'geometry')
        await database.pool.query('UPDATE generation_assets SET width=4 WHERE id=$1', [assetId]);
      if (kind === 'size')
        await database.pool.query(
          'UPDATE generation_assets SET byte_size=byte_size+1 WHERE id=$1',
          [assetId],
        );
      const response = await get();
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: 'GENERATION_STORAGE_FAILED', message: '生成资产暂时无法读取，请重试' },
      });
      expect(JSON.stringify(body).includes(objectKey)).toBe(false);
      expect(JSON.stringify(body).includes('private-endpoint')).toBe(false);
      expect(await financialCounts()).toEqual({ receipts: 0, events: 0, jobs: 0 });
    },
  );

  it.each(['empty-missing', 'xml-missing'] as const)(
    'returns 404 when S3 reports %s',
    async (mode) => {
      storage.state.mode = mode;
      const response = await get();
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'GENERATION_NOT_FOUND', message: '生成资产不存在或已清理' },
      });
    },
  );

  it.each(['purge', 'replace'] as const)(
    'does not hold a DB transaction during S3 and rejects concurrent %s at the final read',
    async (change) => {
      storage.state.mode = 'hold';
      const pending = get();
      const errors: unknown[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          storage.reached,
          pending.then((response) => {
            throw new Error(`Read ended before barrier: HTTP ${response.status}`);
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('S3 read barrier missing')), 1000);
          }),
        ]);
        if (change === 'purge') {
          await generation.remove(OWNER, runId);
          await generation.purge(OWNER, runId);
        } else
          await database.pool.query(
            "UPDATE generation_assets SET object_key=object_key||'-replacement' WHERE id=$1",
            [assetId],
          );
        storage.release();
        const response = await pending;
        expect(response.status).toBe(404);
        expect(await financialCounts()).toEqual({ receipts: 0, events: 0, jobs: 0 });
      } catch (error) {
        errors.push(error);
      } finally {
        if (timer) clearTimeout(timer);
        storage.release();
        const outcomes = await Promise.allSettled([pending]);
        for (const outcome of outcomes)
          if (outcome.status === 'rejected') errors.push(outcome.reason);
      }
      if (errors.length) throw new AggregateError(errors, 'Concurrent content access regression');
    },
  );
  async function uploadOwnedReference() {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(png)], 'owned-reference.png', { type: 'image/png' }));
    const response = await app.request('/api/v1/reference-images', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.get(OWNER)}` },
      body: form,
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Awaited<
      ReturnType<GenerationService['uploadReferenceImage']>
    >;
  }
  const releaseReference = (id: string, principal = OWNER) =>
    app.request(`/api/v1/reference-images/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokens.get(principal)}` },
    });
  async function referenceFacts(id: string) {
    return (
      await database.pool.query(
        'SELECT id,user_id,object_key,status,expires_at FROM generation_reference_uploads WHERE id=$1',
        [id],
      )
    ).rows[0];
  }
  it('reference release protocol: own unused upload expires without direct object IO or execution writes', async () => {
    const reference = await uploadOwnedReference();
    const before = await referenceFacts(reference.id);
    expect(before.expires_at.getTime()).toBeGreaterThan(Date.now());
    const io = [...storage.requests];
    const money = await financialCounts();
    const response = await releaseReference(reference.id);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const after = await referenceFacts(reference.id);
    expect(after).toEqual({ ...before, expires_at: expect.any(Date) });
    // Release uses PostgreSQL CURRENT_TIMESTAMP. The Docker and host clocks can
    // differ, so check actual expiry against the same authoritative clock.
    expect(
      (
        await database.pool.query(
          'SELECT expires_at <= clock_timestamp() AS expired FROM generation_reference_uploads WHERE id=$1',
          [reference.id],
        )
      ).rows,
    ).toEqual([{ expired: true }]);
    expect(storage.requests).toEqual(io);
    expect(await financialCounts()).toEqual(money);
  });
  it('reference release protocol: missing, foreign and repeated identities cannot extend or release another owner upload', async () => {
    const reference = await uploadOwnedReference();
    const before = await referenceFacts(reference.id);
    expect((await releaseReference(reference.id, FOREIGN)).status).toBe(204);
    expect(await referenceFacts(reference.id)).toEqual(before);
    expect((await releaseReference(randomUUID())).status).toBe(204);
    expect((await releaseReference(reference.id)).status).toBe(204);
    const released = await referenceFacts(reference.id);
    expect((await releaseReference(reference.id)).status).toBe(204);
    expect(await referenceFacts(reference.id)).toEqual(released);
  });
  it('reference release protocol: unauthenticated and invalid inputs do not alter the upload', async () => {
    const reference = await uploadOwnedReference();
    const before = await referenceFacts(reference.id);
    expect(
      (await app.request(`/api/v1/reference-images/${reference.id}`, { method: 'DELETE' })).status,
    ).toBe(401);
    expect((await releaseReference('bad')).status).toBe(400);
    expect((await releaseReference(reference.id + '?path=other')).status).toBe(400);
    expect(await referenceFacts(reference.id)).toEqual(before);
  });
  it('reference release protocol: accepted run keeps its reference and result readable after upload release', async () => {
    const reference = await uploadOwnedReference();
    const accepted = await generation.create(
      OWNER,
      { prompt: 'Keep frozen input', referenceImages: [reference] },
      randomUUID(),
      generationAuthSession(OWNER),
    );
    const links = (
      await database.pool.query('SELECT * FROM generation_reference_links WHERE reference_id=$1', [
        reference.id,
      ])
    ).rows;
    expect(links).toHaveLength(1);
    const money = await financialCounts();
    expect((await releaseReference(reference.id)).status).toBe(204);
    expect((await referenceFacts(reference.id)).status).toBe('available');
    expect(
      (
        await database.pool.query(
          'SELECT * FROM generation_reference_links WHERE reference_id=$1',
          [reference.id],
        )
      ).rows,
    ).toEqual(links);
    expect((await generation.get(OWNER, accepted.id)).request.referenceImages).toEqual([reference]);
    const signed = await app.request(`/api/v1/reference-images/${reference.id}/url`, {
      headers: { authorization: `Bearer ${tokens.get(OWNER)}` },
    });
    expect(signed.status).toBe(302);
    expect(await financialCounts()).toEqual(money);
  });
  it('reference release protocol: unused released input cannot authorize a fresh generation', async () => {
    const reference = await uploadOwnedReference();
    expect((await releaseReference(reference.id)).status).toBe(204);
    const money = await financialCounts();
    await expect(
      generation.create(
        OWNER,
        { prompt: 'Obsolete input', referenceImages: [reference] },
        randomUUID(),
        generationAuthSession(OWNER),
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
    expect(await financialCounts()).toEqual(money);
  });

  it('reference release protocol: real generation adoption row lock delays release until its reference commits', async () => {
    const reference = await uploadOwnedReference();
    const client = await database.pool.connect();
    const pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const originalQuery = client.query;
    let signalReached!: () => void;
    let resume!: () => void;
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let armed = true;
    client.query = new Proxy(originalQuery, {
      async apply(target, self, args) {
        const result = await Reflect.apply(target, self, args);
        const text = typeof args[0] === 'string' ? args[0] : args[0].text;
        if (
          armed &&
          text.startsWith('select') &&
          text.includes('"generation_reference_uploads"') &&
          text.includes('for update')
        ) {
          armed = false;
          signalReached();
          await gate;
        }
        return result;
      },
    });
    client.release();
    const adopting = generation
      .create(
        OWNER,
        { prompt: 'Adoption before release', referenceImages: [reference] },
        randomUUID(),
        generationAuthSession(OWNER),
      )
      .then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
    let releasing: Promise<Response> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        reached,
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Adoption row lock was not observed')), 3000);
        }),
      ]);
      releasing = Promise.resolve(releaseReference(reference.id));
      const until = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < until) {
        const waiting = await database.pool.query(
          'SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if (waiting.rows.length) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      resume();
      const adopted = await adopting;
      if (adopted.error) throw adopted.error;
      expect(adopted.value).toBeDefined();
      expect((await releasing).status).toBe(204);
      const links = (
        await database.pool.query(
          'SELECT run_id FROM generation_reference_links WHERE reference_id=$1',
          [reference.id],
        )
      ).rows;
      expect(links).toEqual([{ run_id: adopted.value!.id }]);
      expect((await referenceFacts(reference.id)).status).toBe('available');
      expect((await generation.get(OWNER, adopted.value!.id)).request.referenceImages).toEqual([
        reference,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      resume();
      await Promise.allSettled([adopting, ...(releasing ? [releasing] : [])]);
      client.query = originalQuery;
    }
  });
});
