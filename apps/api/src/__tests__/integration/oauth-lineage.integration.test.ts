import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { CloudMcpService } from '../../modules/cloud-mcp/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
const UPSTREAM = 'http://127.0.0.1:1';
const CLIENT = 'lineage-native-client';
const PRINCIPAL = 'lineage-principal';
const SESSION = 'lineage-session';
const BEARER = 'synthetic-lineage-bearer';
const REDIRECT = 'http://127.0.0.1:54321/callback';
const SCOPES = ['account:read', 'prompts:read', 'skills:read', 'offline_access'];
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb('OAuth consent lineage (real BA + isolated PG, no paid network)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let cloud: CloudMcpService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 12 });
    await migrateDatabase(database.db);
    cloud = new CloudMcpService(database.db);
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE "user", oauth_client, oauth_resource, verification, jwks CASCADE',
    );
    await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$1)', [PRINCIPAL]);
    await database.pool.query(
      "INSERT INTO session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
      [SESSION, PRINCIPAL, BEARER],
    );
    await database.pool.query(
      "INSERT INTO account_identities (user_id,api_issuer,upstream_issuer,upstream_owner_id,status,verified_at) VALUES ($1,$2,$3,'42','active',now())",
      [PRINCIPAL, API, UPSTREAM],
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations (session_id,user_id,mode) VALUES ($1,$2,'normal')",
      [SESSION, PRINCIPAL],
    );
    await database.pool.query(
      'INSERT INTO oauth_client (id,client_id,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) VALUES ($1,$1,$2,$3,$4,$5,$6,true)',
      [CLIENT, [REDIRECT], SCOPES, ['authorization_code', 'refresh_token'], ['code'], 'none'],
    );
    await database.pool.query(
      'INSERT INTO oauth_resource (id,identifier,name,allowed_scopes) VALUES ($1,$2,$1,$3)',
      ['lineage-resource', `${API}/mcp`, SCOPES],
    );
    await database.pool.query(
      'INSERT INTO oauth_client_resource (id,client_id,resource_id) VALUES ($1,$2,$3)',
      ['lineage-client-resource', CLIENT, `${API}/mcp`],
    );
    await consent('consent-original');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  function system() {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-oauth-lineage-secret',
      NEW_API_BASE_URL: UPSTREAM,
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-oauth-lineage-encryption',
    });
    // OAuth does not contact New API. Any accidental request is a test failure.
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Unexpected New API request'));
    const newApi = createNewApiClient(UPSTREAM, { fetchImpl: upstreamFetch });
    const account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: API,
      upstreamIssuer: UPSTREAM,
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
    return { auth, upstreamFetch };
  }
  type System = ReturnType<typeof system>;

  function consent(id: string) {
    return database.pool.query(
      'INSERT INTO oauth_consent (id,client_id,user_id,scopes,resources,created_at) VALUES ($1,$2,$3,$4,$5,now())',
      [id, CLIENT, PRINCIPAL, SCOPES, [`${API}/mcp`]],
    );
  }
  async function authorize(sys: System, resource = true) {
    const verifier = hash(randomUUID());
    const query = new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: hash(verifier),
      state: randomUUID(),
      ...(resource ? { resource: `${API}/mcp` } : {}),
    });
    const response = await sys.auth.handler(
      new Request(`${API}/api/auth/oauth2/authorize?${query}`, {
        headers: { authorization: `Bearer ${BEARER}` },
      }),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? REDIRECT);
    expect(location.searchParams.get('error')).toBeNull();
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();
    return { code: code ?? '', verifier };
  }
  function token(sys: System, body: Record<string, string>) {
    return sys.auth.handler(
      new Request(`${API}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT, ...body }),
      }),
    );
  }
  function exchange(sys: System, code: { code: string; verifier: string }) {
    return token(sys, {
      grant_type: 'authorization_code',
      code: code.code,
      code_verifier: code.verifier,
      redirect_uri: REDIRECT,
    });
  }
  function refresh(sys: System, refreshToken: string) {
    return token(sys, { grant_type: 'refresh_token', refresh_token: refreshToken });
  }
  async function tokens(response: Response) {
    expect(response.status).toBe(200);
    const value = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      expires_in: number;
      token_type: string;
      scope: string;
    };
    expect(typeof value.access_token).toBe('string');
    expect(typeof value.refresh_token).toBe('string');
    return value;
  }
  const claims = (tokenValue: string) =>
    JSON.parse(Buffer.from(tokenValue.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  async function denied(response: Response) {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  }

  it('persists original lineage through code, refresh, replay and a second auth instance', async () => {
    const sys = system();
    const code = await authorize(sys);
    const storedCode = await database.pool.query(
      'SELECT value FROM verification WHERE identifier=$1',
      [hash(code.code)],
    );
    expect(JSON.parse(storedCode.rows[0].value).referenceId).toBe(
      'musefold-consent:consent-original',
    );
    const first = await tokens(await exchange(sys, code));
    const started = Date.now();
    const second = await tokens(await refresh(system(), first.refresh_token));
    const replay = await tokens(await refresh(system(), first.refresh_token));
    expect(replay.access_token === second.access_token).toBe(true);
    expect(replay.refresh_token === second.refresh_token).toBe(true);
    expect(replay.expires_at).toBe(second.expires_at);
    expect(replay.scope).toBe(second.scope);
    expect(replay.token_type).toBe(second.token_type);
    // Better Auth recomputes remaining TTL for a cached token response. A
    // second boundary may pass while the stable token family stays identical.
    expect(replay.expires_in).toBeGreaterThan(0);
    expect(replay.expires_in).toBeLessThanOrEqual(second.expires_in);
    expect(second.expires_in - replay.expires_in).toBeLessThanOrEqual(
      Math.ceil((Date.now() - started) / 1000) + 1,
    );
    const third = await tokens(await refresh(system(), second.refresh_token));
    expect(claims(third.access_token).mf_consent_id).toBe('consent-original');
    expect(await cloud.hasActiveTokenAuthorization(claims(third.access_token))).toBe(true);
    const rows = await database.pool.query(
      'SELECT token, reference_id, authorization_code_id FROM oauth_refresh_token',
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((row) => row.reference_id === 'musefold-consent:consent-original')).toBe(
      true,
    );
    expect(new Set(rows.rows.map((row) => row.authorization_code_id))).toEqual(
      new Set([hash(code.code)]),
    );
    expect(rows.rows.map((row) => row.token)).toEqual(
      expect.arrayContaining([
        hash(first.refresh_token),
        hash(second.refresh_token),
        hash(third.refresh_token),
      ]),
    );
    expect(JSON.stringify(rows.rows)).not.toContain(first.refresh_token);
    expect(sys.upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'a refresh inserted after revoke cannot revive after reconsent (real PG CAS barrier, resource=%s)',
    async (resource) => {
      const sys = system();
      const first = await tokens(await exchange(sys, await authorize(sys, resource)));
      const context = await sys.auth.$context;
      const increment = context.adapter.incrementOne.bind(context.adapter);
      const reached = barrier();
      const release = barrier();
      vi.spyOn(context.adapter, 'incrementOne').mockImplementation(async (input) => {
        const result = await increment(input);
        if (input.model === 'oauthRefreshToken' && result) {
          reached.resolve();
          await release.promise;
        }
        return result;
      });
      const rotating = refresh(sys, first.refresh_token);
      try {
        await Promise.race([
          reached.promise,
          rotating.then(() => {
            throw new Error('Refresh did not reach the CAS barrier');
          }),
        ]);
        const beforeInsert = await database.pool.query(
          'SELECT revoked,rotated_at FROM oauth_refresh_token',
        );
        expect(beforeInsert.rows).toHaveLength(1);
        expect(beforeInsert.rows[0].revoked).not.toBeNull();
        expect(beforeInsert.rows[0].rotated_at).not.toBeNull();
        await cloud.revokeAuthorization(PRINCIPAL, CLIENT);
        await consent('consent-replacement');
      } finally {
        release.resolve();
      }
      const late = await tokens(await rotating);
      const lateRow = await database.pool.query(
        'SELECT reference_id,revoked FROM oauth_refresh_token WHERE token=$1',
        [hash(late.refresh_token)],
      );
      // The vulnerable BA interleaving really occurred: revoke missed this row.
      expect(lateRow.rows).toEqual([
        { reference_id: 'musefold-consent:consent-original', revoked: null },
      ]);
      if (resource) {
        expect(await cloud.hasActiveTokenAuthorization(claims(first.access_token))).toBe(false);
        expect(await cloud.hasActiveTokenAuthorization(claims(late.access_token))).toBe(false);
      } else {
        expect(late.access_token).not.toContain('.');
        const opaque = await database.pool.query(
          'SELECT reference_id FROM oauth_access_token WHERE token=$1',
          [hash(late.access_token)],
        );
        expect(opaque.rows).toEqual([{ reference_id: 'musefold-consent:consent-original' }]);
      }
      await denied(await refresh(system(), late.refresh_token));
      // A revoked ancestor's still-live 30-second replay cache cannot return tokens.
      await denied(await refresh(system(), first.refresh_token));
      expect((await database.pool.query('SELECT id FROM oauth_refresh_token')).rows).toHaveLength(
        2,
      );
      const fresh = await tokens(await exchange(system(), await authorize(system())));
      expect(claims(fresh.access_token).mf_consent_id).toBe('consent-replacement');
      expect(await cloud.hasActiveTokenAuthorization(claims(fresh.access_token))).toBe(true);
      expect(sys.upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it('legacy unexchanged code without frozen lineage cannot claim an existing consent', async () => {
    const sys = system();
    const old = await authorize(sys);
    await database.pool.query(
      "UPDATE verification SET value=(value::jsonb - 'referenceId')::text WHERE identifier=$1",
      [hash(old.code)],
    );
    await denied(await exchange(system(), old));
    expect((await database.pool.query('SELECT id FROM oauth_refresh_token')).rows).toHaveLength(0);
  });

  it.each([true, false])(
    'old unexchanged code cannot borrow new consent (resource=%s)',
    async (resource) => {
      const sys = system();
      const old = await authorize(sys, resource);
      await cloud.revokeAuthorization(PRINCIPAL, CLIENT);
      await consent('consent-replacement');
      await denied(await exchange(system(), old));
      expect((await database.pool.query('SELECT id FROM oauth_refresh_token')).rows).toHaveLength(
        0,
      );
      expect((await database.pool.query('SELECT id FROM oauth_access_token')).rows).toHaveLength(0);
      await tokens(await exchange(system(), await authorize(system(), resource)));
    },
  );

  it('old lineage and legacy refresh are denied before and after reconsent without rotation', async () => {
    const sys = system();
    const first = await tokens(await exchange(sys, await authorize(sys)));
    await cloud.revokeAuthorization(PRINCIPAL, CLIENT);
    await denied(await refresh(system(), first.refresh_token));
    await consent('consent-replacement');
    await database.pool.query(
      "INSERT INTO oauth_refresh_token (id,token,client_id,user_id,session_id,scopes,expires_at) VALUES ('legacy-refresh',$1,$2,$3,$4,$5,now()+interval '1 day')",
      [hash('synthetic-legacy-refresh'), CLIENT, PRINCIPAL, SESSION, SCOPES],
    );
    await denied(await refresh(system(), 'synthetic-legacy-refresh'));
    await denied(await refresh(system(), first.refresh_token));
    expect((await database.pool.query('SELECT id FROM oauth_refresh_token')).rows).toHaveLength(2);
  });

  it.each([
    'expired-session',
    'deleted-session',
    'recovery-only',
    'inactive-identity',
    'disabled-client',
  ] as const)('denies the original refresh when %s changes', async (change) => {
    const sys = system();
    const first = await tokens(await exchange(sys, await authorize(sys)));
    if (change === 'expired-session')
      await database.pool.query("UPDATE session SET expires_at=now()-interval '1 second'");
    if (change === 'deleted-session') await database.pool.query('DELETE FROM session');
    if (change === 'recovery-only')
      await database.pool.query("UPDATE account_session_authorizations SET mode='recovery_only'");
    if (change === 'inactive-identity')
      await database.pool.query("UPDATE account_identities SET status='recovery_required'");
    if (change === 'disabled-client')
      await database.pool.query('UPDATE oauth_client SET disabled=true');
    await denied(await refresh(system(), first.refresh_token));
    expect(await cloud.hasActiveTokenAuthorization(claims(first.access_token))).toBe(false);
    expect((await database.pool.query('SELECT id FROM oauth_refresh_token')).rows).toHaveLength(1);
  });
});
