import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { accountModelCatalogSchema, generationJobSchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import { runMigrations } from 'graphile-worker';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
function catalog(price = 0.04) {
  return {
    models: ['image-a', 'image-b'],
    pricing: {
      pricing_version: 'unchanged-protocol-version',
      group_ratio: { default: 3, vip: 1 },
      data: ['image-a', 'image-b'].map((name, index) => ({
        model_name: name,
        quota_type: 1,
        model_price: index ? 0.6 : price,
        enable_groups: ['default', 'vip'],
        supported_endpoint_types: ['image-generation'],
      })),
    },
  };
}

describeDb('account model catalog (real PG, Better Auth and loopback upstream)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
  let app: OpenAPIHono<AuthedEnv>;
  let afterCatalogRead: () => Promise<void> = async () => undefined;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 8 });
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
  }, 120_000);
  beforeEach(async () => {
    afterCatalogRead = async () => undefined;
    await database.pool.query('TRUNCATE "user" CASCADE');
    // Durable execution receipts deliberately survive account/result deletion.
    await database.pool.query('DELETE FROM generation_execution_receipts');
    await database.pool.query('DELETE FROM rate_limit_buckets');
    fixture = await startNewApiIdentityFixture();
    for (const [id, username, group] of [
      [42, 'alice', 'default'],
      [84, 'bob', 'vip'],
    ] as const) {
      fixture.addOwner({ id, username, group });
      fixture.mapUsername(username, id);
      fixture.setModelCatalog(id, catalog());
    }
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-models-auth-secret',
      NEW_API_BASE_URL: fixture.baseUrl,
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-models-encryption',
    });
    const newApi = createNewApiClient(fixture.baseUrl);
    const account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: API,
      upstreamIssuer: fixture.baseUrl,
    });
    const auth = createAuth({
      env,
      db: database.db,
      newApi,
      hooks: {
        prepareLogin: (input) => account.prepareLogin(input),
        commitLogin: (input) => account.commitLogin(input),
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    app = new OpenAPIHono<AuthedEnv>();
    app.onError((error, c) => {
      const safe =
        error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Test failure', 500);
      return c.json(toErrorBody(safe, 'model-test'), safe.status as 400);
    });
    app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    const api = new OpenAPIHono<AuthedEnv>();
    api.use('*', requireSession(auth, [API], account));
    api.route(
      '/',
      accountRoutes(account, new RateLimiter(database.db, 'synthetic-models-rate-key')),
    );
    const forbiddenIo = async (): Promise<never> => {
      throw new Error('No image or object IO in admission tests');
    };
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        sign: forbiddenIo,
        readObject: forbiddenIo,
        putObject: forbiddenIo,
        removeObjects: forbiddenIo,
      },
      { apiIssuer: API, upstreamIssuer: fixture.baseUrl },
      async (sessionId) => {
        const result = await account.getModelCatalog(sessionId);
        await afterCatalogRead();
        return result;
      },
    );
    api.route('/', generationRoutes(generation));
    app.route('/api/v1', api);
  });
  afterEach(async () => {
    await fixture.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  async function login(username = 'alice') {
    const response = await app.request(`${API}/api/auth/sign-in/new-api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: username, password: 'fixture-password' }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string; user: { id: string } };
  }
  const read = (token: string) =>
    app.request(`${API}/api/v1/account/models`, { headers: { authorization: `Bearer ${token}` } });

  const post = (token: string, path: string, body: unknown, key = randomUUID()) =>
    app.request(`${API}/api/v1${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        origin: API,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
  const create = (token: string, model: string, key = randomUUID(), extra = {}) =>
    post(token, '/generations', { prompt: 'account-selected image', model, ...extra }, key);
  async function admissions() {
    return (
      await database.pool.query(`SELECT (SELECT count(*)::int FROM generation_runs) AS runs,
      (SELECT count(*)::int FROM generation_execution_receipts) AS receipts`)
    ).rows[0];
  }

  it('freezes two selected models, distinguishes idempotency keys, and replays without a live catalog', async () => {
    const { token } = await login();
    const key = randomUUID();
    const firstResponse = await create(token, 'image-a', key);
    expect(firstResponse.status).toBe(201);
    const first = generationJobSchema.parse(await firstResponse.json());
    expect(first).toMatchObject({
      request: { model: 'image-a' },
      providerModel: 'image-a',
      costPoints: null,
    });
    const second = await create(token, 'image-b');
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({
      request: { model: 'image-b' },
      providerModel: 'image-b',
    });
    const rows = (
      await database.pool.query(
        'SELECT binding, cost_points FROM generation_execution_receipts ORDER BY created_at',
      )
    ).rows;
    expect(rows.map((row) => row.binding.model)).toEqual(['image-a', 'image-b']);
    expect(rows.every((row) => row.cost_points === null)).toBe(true);
    fixture.setModelCatalog(42, { models: [], pricing: { invalid: true } });
    const queries = fixture.count({ operation: 'pricing' });
    const replay = await create(token, 'image-a', key);
    expect(replay.status).toBe(201);
    expect(generationJobSchema.parse(await replay.json()).id).toBe(first.id);
    expect((await create(token, 'image-b', key)).status).toBe(409);
    expect(fixture.count({ operation: 'pricing' })).toBe(queries);
    expect(await admissions()).toEqual({ runs: 2, receipts: 2 });
  });

  it.each(['unlisted', 'chat-only', 'missing-price', 'disabled-group', 'expected-model'] as const)(
    'rejects %s before admitting a run or charge receipt',
    async (condition) => {
      const { token } = await login();
      const price = catalog();
      const first = price.pricing.data[0];
      if (!first) throw new Error('Missing test model');
      if (condition === 'chat-only') first.supported_endpoint_types = ['openai'];
      if (condition === 'missing-price') price.pricing.data.splice(0, 1);
      if (condition === 'disabled-group') first.enable_groups = ['vip'];
      fixture.setModelCatalog(42, price);
      const current = accountModelCatalogSchema.parse(await (await read(token)).json());
      const extra =
        condition === 'expected-model'
          ? {
              expectedBinding: {
                ...current.identity,
                providerId: 'cloud-default',
                model: 'image-b',
                capabilities: { image: true, text: false },
              },
            }
          : {};
      const result = await create(
        token,
        condition === 'unlisted' ? 'not-listed' : 'image-a',
        randomUUID(),
        extra,
      );
      expect(result.status).toBe(
        ['missing-price', 'disabled-group'].includes(condition) ? 503 : 409,
      );
      expect(await admissions()).toEqual({ runs: 0, receipts: 0 });
    },
  );

  it('rechecks cloud prices for each new intent while keeping retry model and original fee facts', async () => {
    const { token } = await login();
    const firstResponse = await create(token, 'image-b');
    expect(firstResponse.status).toBe(201);
    const first = generationJobSchema.parse(await firstResponse.json());
    expect((await post(token, `/generations/${first.id}/cancel`, {})).status).toBe(200);
    const updated = catalog(0.7);
    updated.models.reverse();
    fixture.setModelCatalog(42, updated);
    const queries = fixture.count({ operation: 'pricing' });
    const retried = await post(token, `/generations/${first.id}/retry`, {});
    expect(retried.status).toBe(201);
    expect(await retried.json()).toMatchObject({
      parentRunId: first.id,
      request: { model: 'image-b' },
      providerModel: 'image-b',
    });
    expect(fixture.count({ operation: 'pricing' })).toBe(queries + 1);
    const rows = (
      await database.pool.query(
        'SELECT binding, cost_points, cost_provenance FROM generation_execution_receipts ORDER BY created_at',
      )
    ).rows;
    expect(rows[0]).toMatchObject({
      binding: { model: 'image-b' },
      cost_points: 0,
      cost_provenance: 'not_sent',
    });
    expect(rows[1]).toMatchObject({ binding: { model: 'image-b' }, cost_points: null });
    updated.models = ['image-a'];
    fixture.setModelCatalog(42, updated);
    expect((await post(token, `/generations/${first.id}/retry`, {})).status).toBe(409);
    expect(await admissions()).toEqual({ runs: 2, receipts: 2 });
  });

  it('rejects a catalog that becomes stale before the account authority transaction locks', async () => {
    const { token, user } = await login();
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    afterCatalogRead = async () => {
      entered();
      await barrier;
    };
    const pending = create(token, 'image-a');
    try {
      await reached;
      await database.pool.query(
        'UPDATE account_credentials SET credential_version=credential_version+1 WHERE user_id=$1',
        [user.id],
      );
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    expect(await admissions()).toEqual({ runs: 0, receipts: 0 });
  });

  it('requires a session without querying public pricing as a fallback', async () => {
    expect((await read('invalid-session')).status).toBe(401);
    expect(fixture.count({ operation: 'pricing' })).toBe(0);
  });
  it('returns each account model list and group prices without secrets or generation side effects', async () => {
    for (const [name, quota, owner] of [
      ['alice', 60000, 42],
      ['bob', 20000, 84],
    ] as const) {
      const signedIn = await login(name);
      const response = await read(signedIn.token);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const text = await response.text();
      const result = accountModelCatalogSchema.parse(JSON.parse(text));
      expect(result.identity.principalId).toBe(signedIn.user.id);
      expect(result.identity.payer.ownerId).toBe(String(owner));
      expect(result.models.map((m) => m.model)).toEqual(['image-a', 'image-b']);
      expect(result.models[0]?.pricing).toMatchObject({ kind: 'per_call', quotaPerCall: quota });
      expect(text).not.toMatch(/fixture-jwt|fixture-refresh|sk-fixture/);
      expect(fixture.count({ operation: 'pricing', ownerId: owner })).toBe(1);
    }
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
    ).toBe(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_execution_receipts'))
        .rows[0].n,
    ).toBe(0);
  });
  it('refreshes changed prices and added models even when the protocol version is unchanged', async () => {
    const { token } = await login();
    expect((await read(token)).status).toBe(200);
    const updated = catalog(0.1);
    updated.models.push('new-cloud-model');
    fixture.setModelCatalog(42, updated);
    const result = accountModelCatalogSchema.parse(await (await read(token)).json());
    expect(result.models[0]?.pricing).toMatchObject({ quotaPerCall: 150000 });
    expect(result.models[2]).toMatchObject({
      model: 'new-cloud-model',
      pricing: { kind: 'unavailable', reason: 'missing_price' },
    });
    expect(fixture.count({ operation: 'pricing', ownerId: 42 })).toBe(2);
  });
  it('rejects malformed price data instead of returning a cached or free price', async () => {
    const { token } = await login();
    expect((await read(token)).status).toBe(200);
    const invalid = catalog();
    const first = invalid.pricing.data[0];
    if (!first) throw new Error('Missing test model');
    Reflect.deleteProperty(first, 'model_price');
    fixture.setModelCatalog(42, invalid);
    const response = await read(token);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/model_price|fixture-jwt|quotaPerCall/);
  });
  it.each(['logout', 'credential', 'group'] as const)(
    'rejects a delayed catalog after %s changes',
    async (change) => {
      const signedIn = await login();
      const barrier = fixture.pauseNext({ operation: 'pricing', ownerId: 42 }, { phase: 'after' });
      const pending = read(signedIn.token);
      try {
        await barrier.reached;
        if (change === 'logout') {
          const out = await app.request(`${API}/api/auth/sign-out`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${signedIn.token}`,
              origin: API,
              'content-type': 'application/json',
            },
            body: '{}',
          });
          expect(out.status).toBe(200);
        } else if (change === 'credential') {
          await database.pool.query(
            'UPDATE account_credentials SET credential_version = credential_version + 1 WHERE user_id = $1',
            [signedIn.user.id],
          );
        } else fixture.setGroup(42, 'vip');
      } finally {
        barrier.release();
      }
      const response = await pending;
      expect(response.status).toBe(change === 'logout' ? 401 : 409);
      expect(await response.text()).not.toContain('quotaPerCall');
    },
  );
});
