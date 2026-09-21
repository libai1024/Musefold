import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudMcpOAuthReviewSchema, cloudMcpOAuthRedirectSchema } from '@musefold/contracts';
import { z } from 'zod';
import { createAuth } from '../../auth/index.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { CloudMcpService } from '../../modules/cloud-mcp/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
const CALLBACK = 'http://127.0.0.1:54321/callback';
const BEARER = 'synthetic-browser-session';
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');

describeDb('OAuth browser review (real Better Auth and isolated PG)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let auth: ReturnType<typeof createAuth>;
  const upstreamFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('No paid upstream'));

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-browser-oauth-secret',
      NEW_API_BASE_URL: 'http://127.0.0.1:1',
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-browser-encryption',
    });
    const newApi = createNewApiClient(env.NEW_API_BASE_URL, { fetchImpl: upstreamFetch });
    const account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: API,
      upstreamIssuer: env.NEW_API_BASE_URL,
    });
    auth = createAuth({
      env,
      db: database.db,
      newApi,
      hooks: {
        prepareLogin: (input) => account.prepareLogin(input),
        commitLogin: (input) => account.commitLogin(input),
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    await auth.$context;
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE "user", oauth_client, oauth_resource, verification, jwks CASCADE',
    );
    await database.pool.query(
      "INSERT INTO \"user\" (id,name,email) VALUES ('browser-user','Browser User','browser@example.test')",
    );
    await database.pool.query(
      "INSERT INTO session (id,user_id,token,expires_at,created_at) VALUES ('browser-session','browser-user',$1,now()+interval '1 day',now()-interval '1 hour')",
      [BEARER],
    );
    await database.pool.query(
      "INSERT INTO account_identities (user_id,api_issuer,upstream_issuer,upstream_owner_id,status,verified_at) VALUES ('browser-user',$1,'http://127.0.0.1:1','42','active',now())",
      [API],
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations (session_id,user_id,mode) VALUES ('browser-session','browser-user','normal')",
    );
    await database.pool.query(
      'INSERT INTO oauth_resource (id,identifier,name,allowed_scopes) VALUES ($1,$2,$1,$3)',
      ['browser-resource', `${API}/mcp`, ['prompts:read', 'offline_access']],
    );
    for (const id of ['client-a', 'client-b']) {
      await database.pool.query(
        "INSERT INTO oauth_client (id,client_id,name,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) VALUES ($1,$1,$2,$3,$4,$5,$6,'none',true)",
        [
          id,
          `App ${id}`,
          [CALLBACK],
          ['prompts:read', 'offline_access'],
          ['authorization_code', 'refresh_token'],
          ['code'],
        ],
      );
      await database.pool.query(
        'INSERT INTO oauth_client_resource (id,client_id,resource_id) VALUES ($1,$1,$2)',
        [id, `${API}/mcp`],
      );
    }
    upstreamFetch.mockClear();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const post = (
    path: string,
    body: unknown,
    authenticated = true,
    extra: Record<string, string> = {},
  ) =>
    auth.handler(
      new Request(`${API}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: API,
          ...(authenticated ? { authorization: `Bearer ${BEARER}` } : {}),
          ...extra,
        },
        body: JSON.stringify(body),
      }),
    );
  async function request(client = 'client-a', authenticated = true, prompt = 'consent') {
    const verifier = hash(randomUUID());
    const state = randomUUID();
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: CALLBACK,
      response_type: 'code',
      scope: 'prompts:read offline_access',
      resource: `${API}/mcp`,
      code_challenge: hash(verifier),
      code_challenge_method: 'S256',
      state,
      prompt,
    });
    const response = await auth.handler(
      new Request(`${API}/api/auth/oauth2/authorize?${params}`, {
        headers: authenticated ? { authorization: `Bearer ${BEARER}` } : {},
      }),
    );
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get('location') ?? '', API);
    expect(url.pathname).toBe(authenticated && prompt !== 'login' ? '/consent' : '/login');
    return { query: url.search.slice(1), verifier, state };
  }

  it('reviews the actual signed client/scopes without issuing consent or a token', async () => {
    const flow = await request();
    const response = await post('/musefold/oauth-review', { oauth_query: flow.query });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const review = await response.json();
    expect(review).toMatchObject({
      client: { id: 'client-a', name: 'App client-a' },
      scopes: ['prompts:read', 'offline_access'],
      loginRequired: false,
      account: { id: 'browser-user', name: 'Browser User' },
      reviewRef: expect.any(String),
    });
    expect(JSON.stringify(review)).not.toContain(BEARER);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it('does not let a stale or unreviewed page approve a request', async () => {
    const flow = await request();
    const response = await post('/oauth2/consent', { oauth_query: flow.query, accept: true });
    expect(response.status).toBe(403);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  async function review(query: string, authenticated = true) {
    const response = await post('/musefold/oauth-review', { oauth_query: query }, authenticated);
    expect(response.status).toBe(200);
    return cloudMcpOAuthReviewSchema.parse(await response.json());
  }
  const decide = (query: string, ref: string | null, accept = true) =>
    post(
      '/oauth2/consent',
      {
        oauth_query: query,
        accept,
      },
      true,
      { 'x-musefold-oauth-review': ref ?? '' },
    );
  const exchange = (client: string, code: string, verifier: string) =>
    auth.handler(
      new Request(`${API}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: client,
          code,
          code_verifier: verifier,
          redirect_uri: CALLBACK,
        }),
      }),
    );

  it('previews anonymously, then requires fresh authentication for prompt=login', async () => {
    const flow = await request('client-a', false, 'login');
    expect(await review(flow.query, false)).toMatchObject({
      loginRequired: true,
      account: null,
      reviewRef: null,
      continueUrl: null,
    });
    expect(await review(flow.query)).toMatchObject({
      loginRequired: true,
      reviewRef: null,
      continueUrl: null,
    });
    // Session freshness boundary here; the real credential form is separately driven by browser E2E.
    await database.pool.query("UPDATE session SET created_at=now() WHERE id='browser-session'");
    const value = await review(flow.query);
    expect(value.loginRequired).toBe(false);
    const continuation = new URL(value.continueUrl ?? '', API);
    expect(continuation.pathname).toBe('/api/auth/oauth2/authorize');
    expect(continuation.searchParams.get('state')).toBe(flow.state);
    expect(continuation.searchParams.get('code_challenge')).toBe(hash(flow.verifier));
    expect(continuation.searchParams.get('resource')).toBe(`${API}/mcp`);
    expect(continuation.searchParams.has('prompt')).toBe(false);
    const next = await auth.handler(
      new Request(continuation, { headers: { authorization: `Bearer ${BEARER}` } }),
    );
    expect(next.status).toBe(302);
    expect(new URL(next.headers.get('location') ?? '', API).pathname).toBe('/consent');
  });

  it.each(['client_id', 'redirect_uri', 'scope', 'state'])(
    'rejects tampered signed %s before returning a preview',
    async (field) => {
      const flow = await request();
      const params = new URLSearchParams(flow.query);
      params.set(
        field,
        field === 'redirect_uri' ? 'https://untrusted.example/callback' : 'changed',
      );
      const response = await post('/musefold/oauth-review', { oauth_query: params.toString() });
      expect(response.status).toBe(400);
      expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
    },
  );

  it('binds a preview to its exact client, query and current session', async () => {
    const a = await request('client-a');
    const b = await request('client-b');
    const proof = (await review(a.query)).reviewRef;
    expect((await decide(b.query, proof)).status).toBe(403);
    const anotherA = await request('client-a');
    expect((await decide(anotherA.query, proof)).status).toBe(403);
    await database.pool.query(
      "INSERT INTO session (id,user_id,token,expires_at) VALUES ('replacement-session','browser-user','synthetic-replacement',now()+interval '1 day')",
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations (session_id,user_id,mode) VALUES ('replacement-session','browser-user','normal')",
    );
    expect(
      (
        await post('/oauth2/consent', { oauth_query: a.query, accept: true }, true, {
          authorization: 'Bearer synthetic-replacement',
          'x-musefold-oauth-review': proof ?? '',
        })
      ).status,
    ).toBe(403);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  it('requires review again when client metadata changes, proof expires, or origin differs', async () => {
    const flow = await request();
    const proof = (await review(flow.query)).reviewRef;
    await database.pool.query(
      "UPDATE oauth_client SET name='Changed app' WHERE client_id='client-a'",
    );
    expect((await decide(flow.query, proof)).status).toBe(403);
    const freshProof = (await review(flow.query)).reviewRef;
    expect(
      (
        await post('/oauth2/consent', { oauth_query: flow.query, accept: true }, true, {
          origin: 'https://untrusted.example',
          'x-musefold-oauth-review': freshProof ?? '',
        })
      ).status,
    ).toBe(403);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000);
    expect((await decide(flow.query, freshProof)).status).toBe(403);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  it('denies one client without granting it and accepts/exchanges/revokes a different client', async () => {
    const b = await request('client-b');
    const reject = await decide(b.query, (await review(b.query)).reviewRef, false);
    expect(reject.status).toBe(200);
    const rejected = new URL(cloudMcpOAuthRedirectSchema.parse(await reject.json()).url);
    expect(rejected.origin + rejected.pathname).toBe(CALLBACK);
    expect(rejected.searchParams.get('error')).toBe('access_denied');
    expect(rejected.searchParams.get('state')).toBe(b.state);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
    const a = await request('client-a');
    const approve = await decide(a.query, (await review(a.query)).reviewRef);
    expect(approve.status).toBe(200);
    const callback = new URL(cloudMcpOAuthRedirectSchema.parse(await approve.json()).url);
    expect(callback.origin + callback.pathname).toBe(CALLBACK);
    expect(callback.searchParams.get('state')).toBe(a.state);
    const code = callback.searchParams.get('code') ?? '';
    expect(code).not.toBe('');
    const tokens = await exchange('client-a', code, a.verifier);
    expect(tokens.status).toBe(200);
    const value = z.object({ access_token: z.string() }).parse(await tokens.json());
    const claims = JSON.parse(
      Buffer.from(value.access_token.split('.')[1], 'base64url').toString(),
    );
    const cloud = new CloudMcpService(database.db);
    expect(await cloud.hasActiveTokenAuthorization(claims)).toBe(true);
    expect((await exchange('client-a', code, a.verifier)).status).toBe(400);
    await cloud.revokeAuthorization('browser-user', 'client-a');
    expect(await cloud.hasActiveTokenAuthorization(claims)).toBe(false);
    expect(
      (await database.pool.query("SELECT * FROM oauth_consent WHERE client_id='client-b'"))
        .rowCount,
    ).toBe(0);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('retains PKCE enforcement through reviewed consent', async () => {
    const a = await request();
    const approved = await decide(a.query, (await review(a.query)).reviewRef);
    expect(approved.status).toBe(200);
    const code =
      new URL(cloudMcpOAuthRedirectSchema.parse(await approved.json()).url).searchParams.get(
        'code',
      ) ?? '';
    expect((await exchange('client-a', code, hash('wrong-verifier'))).status).toBe(401);
    expect((await database.pool.query('SELECT * FROM oauth_access_token')).rowCount).toBe(0);
  });

  it('rejects restricted recovery sessions at both review and decision boundaries', async () => {
    const flow = await request();
    const proof = (await review(flow.query)).reviewRef;
    await database.pool.query("UPDATE account_session_authorizations SET mode='recovery_only'");
    expect((await post('/musefold/oauth-review', { oauth_query: flow.query })).status).toBe(403);
    for (const accept of [true, false])
      expect((await decide(flow.query, proof, accept)).status).toBe(403);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  it('rejects a disabled client even if the browser previously reviewed it', async () => {
    const flow = await request();
    const proof = (await review(flow.query)).reviewRef;
    await database.pool.query("UPDATE oauth_client SET disabled=true WHERE client_id='client-a'");
    expect((await post('/musefold/oauth-review', { oauth_query: flow.query })).status).toBe(403);
    expect((await decide(flow.query, proof)).status).toBe(403);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  it('does not review unsigned, duplicate or expired requests', async () => {
    const flow = await request();
    const duplicated = `${flow.query}&client_id=client-b`;
    for (const query of ['client_id=client-a', duplicated])
      expect((await post('/musefold/oauth-review', { oauth_query: query })).status).toBe(400);
    // The provider compares `new Date()`, not Date.now(). Advance only Date so
    // actual PG/network timers remain real and exercise its real expiry check.
    const expires = Number(new URLSearchParams(flow.query).get('exp'));
    expect(expires).toBeGreaterThan(0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date((expires + 1) * 1000));
    expect((await post('/musefold/oauth-review', { oauth_query: flow.query })).status).toBe(400);
    expect((await database.pool.query('SELECT * FROM oauth_consent')).rowCount).toBe(0);
  });

  it('requires an exact trusted Origin even for an anonymous review', async () => {
    const flow = await request('client-a', false);
    for (const origin of ['', 'null', `${API}.untrusted.example`])
      expect(
        (await post('/musefold/oauth-review', { oauth_query: flow.query }, false, { origin }))
          .status,
      ).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
