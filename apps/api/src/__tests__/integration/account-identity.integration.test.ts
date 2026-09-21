import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { type AccountSummary, accountSummarySchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient, type RelayAuthSession } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../auth/index.js';
import type { NewApiDelegationHooks } from '../../auth/new-api-delegation.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { CloudMcpService } from '../../modules/cloud-mcp/service.js';
import { createCloudMcpRequestHandler } from '../../modules/mcp/handler.js';
import { SkillService } from '../../modules/mcp/skills.js';
import { PromptService } from '../../modules/prompts/service.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const KEY = 'synthetic-account-identity-encryption';
const API = 'http://127.0.0.1:8787';

describeDb(
  'trusted account identity and recoverable legacy migration (real HTTP + PG + BA)',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;

    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri(), { max: 12 });
      await migrateDatabase(database.db);
    }, 120_000);
    beforeEach(async () => {
      await database.pool.query('TRUNCATE "user" CASCADE');
      await database.pool.query('DELETE FROM rate_limit_buckets');
      fixture = await startNewApiIdentityFixture();
      fixture.addOwner({ id: 42, username: 'alice' });
      fixture.addOwner({ id: 84, username: 'bob' });
      fixture.mapUsername('alice', 42);
      fixture.mapUsername('bob', 84);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      await fixture.close();
    });
    afterAll(async () => {
      await database?.pool.end();
      await container?.stop();
    });

    function system(legacyTrusted = true, hookOverride: Partial<NewApiDelegationHooks> = {}) {
      const env = loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: container.getConnectionUri(),
        PUBLIC_BASE_URL: API,
        BETTER_AUTH_SECRET: 'synthetic-identity-auth-secret',
        NEW_API_BASE_URL: fixture.baseUrl,
        CREDENTIAL_ENCRYPTION_KEY: KEY,
      });
      const account = new AccountService({
        db: database.db,
        newApi: createNewApiClient(fixture.baseUrl),
        encryptionKey: KEY,
        apiIssuer: API,
        upstreamIssuer: fixture.baseUrl,
        legacyTrustedIssuer: legacyTrusted ? fixture.baseUrl : undefined,
      });
      const auth = createAuth({
        env,
        db: database.db,
        newApi: createNewApiClient(fixture.baseUrl),
        hooks: {
          prepareLogin: (input) => account.prepareLogin(input),
          commitLogin: (input) => account.commitLogin(input),
          assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
          ...hookOverride,
        },
      });
      const app = new OpenAPIHono<AuthedEnv>();
      app.onError((error, c) => {
        const safe =
          error instanceof AppError
            ? error
            : new AppError('INTERNAL_ERROR', 'Fixture internal error', 500);
        return c.json(toErrorBody(safe, 'identity-fixture-request'), safe.status as 400);
      });
      app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
      // GAPX/GAP-B3:生图 sentinel 命中计数——跨面负例必须证明处理器一次都没被调用。
      let generationSentinelCalls = 0;
      // GAPX/GAP-B3:MCP 下游依赖调用计数——malformed arguments 必须在触达 PromptService 前失败。
      let mcpPromptListCalls = 0;
      const prompts = new PromptService(database.db);
      const countedPrompts = new Proxy(prompts, {
        get(target, property, receiver) {
          if (property === 'listPrompts')
            return async (...args: Parameters<PromptService['listPrompts']>) => {
              mcpPromptListCalls += 1;
              return target.listPrompts(...args);
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const cloud = new CloudMcpService(database.db);
      // 与生产 app.ts 同构的云端 MCP 入口(仅省略限流;handler 语义不变)。
      const mcpHandler = createCloudMcpRequestHandler(auth, {
        prompts: countedPrompts,
        skills: new SkillService(database.db),
        account,
        resourceUrl: env.mcpResourceUrl,
        modelAliases: ['musefold-image-pro'], // 与 app.ts CLOUD_MODEL_ALIASES 对齐
        isAuthorizationActive: async (claims) =>
          typeof claims.sub === 'string' &&
          (await account.isPrincipalActive(claims.sub)) &&
          (await cloud.hasActiveTokenAuthorization(claims)),
      });
      app.post('/mcp', (c) => mcpHandler(c.req.raw));
      const api = new OpenAPIHono<AuthedEnv>();
      api.use('*', requireSession(auth, [API], account));
      api.route(
        '/',
        accountRoutes(account, new RateLimiter(database.db, 'identity-fixture-rate-secret')),
      );
      api.get('/private/history', async (c) => {
        const rows = await database.pool.query('SELECT title FROM prompts WHERE user_id = $1', [
          c.get('userId'),
        ]);
        return c.json({ principalId: c.get('userId'), titles: rows.rows.map((row) => row.title) });
      });
      api.post('/generations', (c) => {
        generationSentinelCalls += 1;
        return c.json({ unexpectedlyAllowed: true });
      });
      app.route('/api/v1', api);
      return {
        account,
        auth,
        app,
        generationCalls: () => generationSentinelCalls,
        mcpPromptListCalls: () => mcpPromptListCalls,
      };
    }
    type System = ReturnType<typeof system>;

    function request(sys: System, path: string, token?: string, body?: unknown) {
      return sys.app.request(`${API}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function login(sys: System, username = 'alice', prior?: string) {
      const response = await request(sys, '/api/auth/sign-in/new-api', prior, {
        email: username,
        password: 'fixture-password',
      });
      const body = (await response.json()) as {
        token?: string;
        user?: { id: string };
        code?: string;
      };
      return { response, body, token: body.token ?? '', userId: body.user?.id ?? '' };
    }
    async function status(sys: System, token: string): Promise<AccountSummary> {
      const response = await request(sys, '/api/v1/account/status', token);
      expect(response.status).toBe(200);
      return accountSummarySchema.parse(await response.json());
    }
    /**
     * GAPX/GAP-B3:用真实 PKCE OAuth 流程签发一枚 audience=API/mcp 的 MCP access token
     * (与上面「actual OAuth PKCE issuance」用例同一形态,抽出给 MCP 负例复用)。
     */
    async function mcpAccessToken(
      sys: System,
      userId: string,
      sessionToken: string,
      clientId = 'identity-mcp-negative-client',
    ): Promise<string> {
      const scopes = ['account:read', 'prompts:read', 'skills:read'];
      const redirectUri = 'http://127.0.0.1:54321/callback';
      await database.pool.query(
        'INSERT INTO oauth_client(id,client_id,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) VALUES ($1,$1,$2,$3,$4,$5,$6,true)',
        [
          clientId,
          [redirectUri],
          scopes,
          ['authorization_code', 'refresh_token'],
          ['code'],
          'none',
        ],
      );
      await database.pool.query(
        'INSERT INTO oauth_resource(id,identifier,name,allowed_scopes) VALUES ($1,$2,$1,$3) ON CONFLICT (identifier) DO NOTHING',
        [`${clientId}-resource`, `${API}/mcp`, scopes],
      );
      await database.pool.query(
        'INSERT INTO oauth_client_resource(id,client_id,resource_id) VALUES ($1,$2,$3)',
        [`${clientId}-client-resource`, clientId, `${API}/mcp`],
      );
      await database.pool.query(
        'INSERT INTO oauth_consent(id,client_id,user_id,scopes,resources,created_at) VALUES ($1,$2,$3,$4,$5,now())',
        [`${clientId}-consent`, clientId, userId, scopes, [`${API}/mcp`]],
      );
      const verifier = createHash('sha256').update(randomUUID()).digest('base64url');
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        resource: `${API}/mcp`,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        state: randomUUID(),
      });
      const authorized = await request(sys, `/api/auth/oauth2/authorize?${query}`, sessionToken);
      expect(authorized.status).toBe(302);
      const code = new URL(authorized.headers.get('location') ?? '').searchParams.get('code');
      expect(Boolean(code)).toBe(true);
      const exchanged = await sys.app.request(`${API}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code: code ?? '',
          code_verifier: verifier,
        }),
      });
      expect(exchanged.status).toBe(200);
      const tokens = (await exchanged.json()) as { access_token: string };
      expect(typeof tokens.access_token).toBe('string');
      return tokens.access_token;
    }
    /**
     * GAPX/GAP-B3:以 2026-07-28 per-request envelope(现代协议)调用 /mcp。
     * 端点为 legacy:'reject',需要 _meta envelope + Mcp-Method/Mcp-Name 头。
     */
    const MCP_REQUEST_ENVELOPE = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'identity-fixture', version: '1.0.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    function mcpCall(
      sys: System,
      accessToken: string,
      method: string,
      params: Record<string, unknown> = {},
    ) {
      const toolName = typeof params.name === 'string' ? params.name : undefined;
      return sys.app.request(`${API}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${accessToken}`,
          'mcp-method': method,
          ...(toolName ? { 'mcp-name': toolName } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: { ...params, _meta: MCP_REQUEST_ENVELOPE },
        }),
      });
    }
    /**
     * GAPX/GAP-B3:requireMcpAuth 在进程内也会真实 fetch `${baseURL}/jwks`
     * (解析为 http://127.0.0.1:8787/api/auth/jwks,生产由 /api/auth/* 挂载承接)
     * 来验证 JWT;fixture 没有监听端口,这里仅把该 URL 定向路由回 fixture app,
     * 其余 fetch 原样透传。JWKS 获取与 jose 验签链路全程真实执行。
     */
    function routeFixtureJwksFetch(sys: System) {
      const realFetch = globalThis.fetch.bind(globalThis);
      const jwksUrl = `${API}/api/auth/jwks`;
      vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === jwksUrl) return sys.app.request(url, init);
        return realFetch(input, init);
      });
    }
    async function legacy(
      options: {
        owner?: number;
        hint?: number;
        key?: boolean;
        expired?: boolean;
        userId?: string;
        username?: string;
        relay?: RelayAuthSession;
      } = {},
    ) {
      const owner = options.owner ?? 42;
      const userId = options.userId ?? 'legacy-principal';
      const sessionId = randomUUID();
      const token = randomUUID();
      const relay =
        options.relay ??
        fixture.issueSession(owner, { expiresInSeconds: options.expired ? -1 : 3600 });
      await database.pool.query(
        'INSERT INTO "user" (id,name,email,new_api_user_id) VALUES ($1,$2,$2,$3) ON CONFLICT (id) DO NOTHING',
        [userId, options.username ?? 'alice', options.hint ?? 42],
      );
      await database.pool.query(
        'INSERT INTO account_identities (user_id,evidence) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, { kind: 'legacy_unverified' }],
      );
      await database.pool.query(
        "INSERT INTO session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
        [sessionId, userId, token],
      );
      await database.pool.query(
        'INSERT INTO relay_sessions (session_id,user_id,ciphertext,access_expires_at) VALUES ($1,$2,$3,$4)',
        [
          sessionId,
          userId,
          sealJsonToString({ jwt: relay.jwt, refreshToken: relay.refreshToken }, KEY),
          new Date(relay.jwtExpiresAt * 1000),
        ],
      );
      let seededKey: string | undefined;
      if (options.key !== false) {
        const upstream = fixture.seedToken(owner, { id: 5 });
        seededKey = upstream.key;
        await database.pool.query(
          'INSERT INTO account_credentials (user_id,external_token_id,ciphertext) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [userId, '5', sealJsonToString({ apiKey: seededKey }, KEY)],
        );
      }
      await database.pool.query(
        'INSERT INTO prompts (id,user_id,title,content) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [`history-${userId}`, userId, 'Preserved legacy history', 'legacy prompt'],
      );
      return { token, sessionId, userId, relay, key: seededKey };
    }

    it('normal login binds verified issuer/owner to an independent principal and exposes no secret', async () => {
      const sys = system();
      const signed = await login(sys);
      expect(signed.response.status).toBe(200);
      expect(signed.token).not.toBe('');
      const summary = await status(sys, signed.token);
      expect(summary).toMatchObject({
        id: '42',
        username: 'alice',
        canGenerate: true,
        recovery: null,
        identity: {
          principalId: signed.userId,
          apiIssuer: API,
          status: 'active',
          identityVersion: 1,
        },
      });
      expect(signed.userId).not.toBe('42');
      const binding = await request(sys, '/api/v1/account/execution-binding', signed.token);
      expect(await binding.json()).toMatchObject({
        status: 'available',
        providerId: 'cloud-default',
        payer: { issuer: fixture.baseUrl, ownerId: '42' },
        credential: { version: 1 },
      });
      const stored = await database.pool.query('SELECT * FROM account_credentials');
      expect(stored.rows[0]).toMatchObject({
        upstream_issuer: fixture.baseUrl,
        upstream_owner_id: '42',
        status: 'active',
        key_version: 'v1',
        credential_version: 1,
      });
      const key = openJsonFromString<{ apiKey: string }>(stored.rows[0].ciphertext, KEY).apiKey;
      expect(fixture.isTokenKeyActive(42, key)).toBe(true);
      expect(JSON.stringify(summary)).not.toContain(key);
      expect(
        (await database.pool.query('SELECT new_api_user_id FROM "user"')).rows[0].new_api_user_id,
      ).toBeNull();
    });

    it('resolves aliases by issuer/owner and never rebinds by a reused username', async () => {
      const sys = system();
      const a = await login(sys);
      fixture.mapUsername('alice-renamed', 42);
      const alias = await login(sys, 'alice-renamed');
      expect(alias.userId).toBe(a.userId);
      fixture.mapUsername('alice', 84);
      const b = await login(sys);
      expect(b.userId).not.toBe(a.userId);
      expect((await status(sys, b.token)).id).toBe('84');
      expect((await status(sys, a.token)).id).toBe('42');
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS n FROM account_identities WHERE status='active'",
          )
        ).rows[0].n,
      ).toBe(2);
    });

    it('rejects login/getSelf owner disagreement before a principal, session or key is created', async () => {
      const sys = system();
      const relay = fixture.issueSession(42);
      fixture.setGetSelfOwner(relay.jwt, 84);
      await expect(
        sys.account.prepareLogin({ username: 'alice', relay, previousSessionId: null }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_RECOVERY_CONFLICT' });
      expect((await database.pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n).toBe(
        0,
      );
      expect(fixture.count({ operation: 'createToken' })).toBe(0);
    });

    it('L2 restores original A despite a mutable B mapping hint without rewriting that hint', async () => {
      const original = await legacy({ hint: 84 });
      const sys = system();
      const signed = await login(sys, 'alice', original.token);
      expect(signed.response.status).toBe(200);
      expect(signed.userId).toBe(original.userId);
      expect((await status(sys, signed.token)).identity?.status).toBe('active');
      expect(
        (
          await database.pool.query('SELECT new_api_user_id FROM "user" WHERE id=$1', [
            original.userId,
          ])
        ).rows[0].new_api_user_id,
      ).toBe(84);
      expect((await request(sys, '/api/v1/private/history', original.token)).status).toBe(200);
      expect(
        (
          await database.pool.query('SELECT evidence FROM account_identities WHERE user_id=$1', [
            original.userId,
          ])
        ).rows[0].evidence,
      ).toMatchObject({ kind: 'legacy_revalidated', keyMatched: true, sessionContinuity: true });
    });

    it('L4 automatically activates cross-device legacy only when independent relay and old key agree', async () => {
      const old = await legacy();
      const sys = system();
      const signed = await login(sys);
      expect((await status(sys, signed.token)).identity?.status).toBe('active');
      expect(signed.userId).toBe(old.userId);
      expect(
        (await database.pool.query('SELECT evidence FROM account_identities')).rows[0].evidence,
      ).toMatchObject({ keyMatched: true, sessionContinuity: false, incomplete: false });
    });

    it('L3 allows a held original session with missing key to provision a new verified key', async () => {
      const old = await legacy({ key: false });
      const sys = system();
      const signed = await login(sys, 'alice', old.token);
      expect((await status(sys, signed.token)).identity?.status).toBe('active');
      expect(fixture.count({ operation: 'createToken', ownerId: 42 })).toBe(1);
      expect(
        (await database.pool.query('SELECT evidence FROM account_identities')).rows[0].evidence,
      ).toMatchObject({ keyMissing: true, keyMatched: false, sessionContinuity: true });
    });

    it('relay alone gives usable restricted recovery; independent workspace preserves old history and changes only its session', async () => {
      const old = await legacy({ key: false });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      expect(pending).toMatchObject({
        canGenerate: false,
        recovery: { reason: 'legacy_evidence_missing' },
      });
      expect((await request(sys, '/api/v1/private/history', signed.token)).status).toBe(403);
      expect((await request(sys, '/api/v1/generations', signed.token, {})).status).toBe(403);
      expect((await request(sys, '/api/auth/token', signed.token)).status).toBe(403);
      const recovered = await request(
        sys,
        '/api/v1/account/recovery/independent-workspace',
        signed.token,
        { requestId: pending.recovery?.requestId },
      );
      expect(recovered.status).toBe(200);
      const next = accountSummarySchema.parse(await recovered.json());
      expect(next.identity?.principalId).not.toBe(old.userId);
      expect(next).toMatchObject({ id: '42', recovery: null, identity: { status: 'active' } });
      const history = await request(sys, '/api/v1/private/history', signed.token);
      expect(await history.json()).toMatchObject({ titles: [] });
      expect(
        (await database.pool.query('SELECT user_id FROM session WHERE id=$1', [old.sessionId]))
          .rows[0].user_id,
      ).toBe(old.userId);
      expect(
        (await database.pool.query('SELECT title FROM prompts WHERE user_id=$1', [old.userId]))
          .rows,
      ).toHaveLength(1);
      expect(
        (
          await request(sys, '/api/v1/account/recovery/independent-workspace', signed.token, {
            requestId: pending.recovery?.requestId,
          })
        ).status,
      ).toBe(200);
    });

    it('original device can inspect and prove the exact request; recovery device cannot self-prove', async () => {
      const old = await legacy({ key: false });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      const body = { requestId: pending.recovery?.requestId };
      expect(
        (await request(sys, '/api/v1/account/recovery/inspect', signed.token, body)).status,
      ).toBe(404);
      const inspected = await request(sys, '/api/v1/account/recovery/inspect', old.token, body);
      expect(inspected.status).toBe(200);
      expect(await inspected.json()).toMatchObject({
        requestId: body.requestId,
        candidate: { ownerId: '42', issuer: fixture.baseUrl, username: 'alice' },
      });
      expect(
        (await request(sys, '/api/v1/account/recovery/verify-original-session', old.token, body))
          .status,
      ).toBe(200);
      expect((await status(sys, signed.token)).identity?.status).toBe('active');
      expect((await request(sys, '/api/v1/private/history', old.token)).status).toBe(200);
      expect(
        (await request(sys, '/api/v1/account/recovery/verify-original-session', old.token, body))
          .status,
      ).toBe(200);
    });

    it('rejects proof from another principal and extra recovery identity fields before any upstream call', async () => {
      await legacy({ key: false });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      const other = await login(sys, 'bob');
      const before = fixture.requests.length;
      expect(
        (
          await request(sys, '/api/v1/account/recovery/inspect', other.token, {
            requestId: pending.recovery?.requestId,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(sys, '/api/v1/account/recovery/retry', signed.token, {
            requestId: pending.recovery?.requestId,
            issuer: 'https://evil.invalid',
          })
        ).status,
      ).toBe(400);
      expect(fixture.requests.length).toBe(before);
    });

    it.each(['owners', 'key'] as const)(
      'L6 preserves conflicting legacy %s and does not mint a replacement key',
      async (kind) => {
        const old = await legacy();
        if (kind === 'owners') await legacy({ owner: 84, key: false, hint: 42 });
        else {
          const foreign = fixture.seedToken(84, { id: 5 });
          await database.pool.query('UPDATE account_credentials SET ciphertext=$1', [
            sealJsonToString({ apiKey: foreign.key }, KEY),
          ]);
        }
        const before = (await database.pool.query('SELECT ciphertext FROM account_credentials'))
          .rows[0].ciphertext;
        const sys = system();
        const signed = await login(sys, 'alice', old.token);
        expect((await status(sys, signed.token)).recovery?.reason).toBe('legacy_identity_conflict');
        expect(
          (await database.pool.query('SELECT ciphertext FROM account_credentials')).rows[0]
            .ciphertext,
        ).toBe(before);
        expect(fixture.count({ operation: 'createToken' })).toBe(0);
      },
    );

    it('L8 never sends old secrets to the current issuer without explicit historical provenance', async () => {
      await legacy();
      const sys = system(false);
      const signed = await login(sys);
      expect((await status(sys, signed.token)).recovery?.reason).toBe('legacy_issuer_unknown');
      expect(
        fixture.requests.filter(
          (request) => request.operation === 'getSelf' && request.sessionNumber === 1,
        ),
      ).toHaveLength(0);
      expect(fixture.count({ operation: 'fetchTokenKey' })).toBe(0);
      expect(
        (await database.pool.query('SELECT upstream_issuer FROM relay_sessions')).rows[0]
          .upstream_issuer,
      ).toBeNull();
    });

    it('L7 permits safe retry after transient evidence failure without candidate self-proof', async () => {
      await legacy();
      const sys = system();
      // New-login self is first; pause old evidence so its failure is targeted unambiguously.
      const pause = fixture.pauseNext({ operation: 'login' }, { phase: 'after' });
      const signedPromise = login(sys);
      await pause.reached;
      const first = fixture.pauseNext({ operation: 'getSelf' }, { phase: 'after' });
      pause.release();
      await first.reached;
      fixture.failNext({ operation: 'getSelf' }, { status: 503 });
      first.release();
      const signed = await signedPromise;
      const pending = await status(sys, signed.token);
      expect(pending.recovery?.reason).toBe('verification_pending');
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM relay_sessions')).rows[0].n,
      ).toBe(1);
      const retried = await request(sys, '/api/v1/account/recovery/retry', signed.token, {
        requestId: pending.recovery?.requestId,
      });
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({
        recovery: null,
        identity: { status: 'active' },
      });
    });

    it.each([false, true])(
      'L5 legacy refresh verifies fresh owner; changed owner=%s cannot activate',
      async (changed) => {
        const old = await legacy({ expired: true });
        if (changed) fixture.setRefreshOwner(old.relay.refreshToken, 84);
        const before = (await database.pool.query('SELECT ciphertext FROM relay_sessions')).rows[0]
          .ciphertext;
        const sys = system();
        const signed = await login(sys, 'alice', old.token);
        const result = await status(sys, signed.token);
        expect(fixture.count({ operation: 'refresh' })).toBe(1);
        if (changed) {
          expect(result.recovery?.reason).toBe('legacy_identity_conflict');
          expect(
            (
              await database.pool.query(
                'SELECT ciphertext FROM relay_sessions WHERE session_id=$1',
                [old.sessionId],
              )
            ).rows[0].ciphertext,
          ).toBe(before);
        } else expect(result.identity?.status).toBe('active');
      },
    );

    it('cross-process relay refresh uses one lease and a late completion cannot resurrect logout', async () => {
      const one = system();
      const two = system();
      const signed = await login(one);
      const stored = (await database.pool.query('SELECT session_id FROM relay_sessions')).rows[0];
      await database.pool.query(
        "UPDATE relay_sessions SET access_expires_at=now()-interval '1 second'",
      );
      const pause = fixture.pauseNext({ operation: 'refresh' }, { phase: 'after' });
      const pending = one.account.getStatus(stored.session_id).catch((error: AppError) => error);
      await pause.reached;
      await expect(two.account.getStatus(stored.session_id)).rejects.toMatchObject({ status: 503 });
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
      expect((await request(two, '/api/auth/sign-out', signed.token, {})).status).toBe(200);
      pause.release();
      expect(await pending).toMatchObject({ code: 'AUTH_SESSION_EXPIRED' });
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM relay_sessions')).rows[0].n,
      ).toBe(0);
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        0,
      );
    });

    it('late login cannot overwrite the winner credential version; compensates only its new BA session', async () => {
      const sys = system();
      const original = await login(sys);
      const stored = (await database.pool.query('SELECT * FROM account_credentials')).rows[0];
      const pause = fixture.pauseNext(
        { operation: 'fetchTokenKey', ownerId: 42 },
        { phase: 'after' },
      );
      const late = login(sys);
      await pause.reached;
      const rotated = fixture.rotateToken(42, Number(stored.external_token_id));
      const winner = await login(sys);
      expect(winner.response.status).toBe(200);
      pause.release();
      expect((await late).response.status).toBe(409);
      const current = (await database.pool.query('SELECT * FROM account_credentials')).rows[0];
      expect(current.credential_version).toBe(stored.credential_version + 1);
      expect(current.key_version).toBe(stored.key_version);
      expect(openJsonFromString<{ apiKey: string }>(current.ciphertext, KEY).apiKey).toBe(
        rotated.key,
      );
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        2,
      );
      expect((await status(sys, original.token)).identity?.status).toBe('active');
    });

    it('hook failure deletes only the new session token and retains previous session/credential', async () => {
      const sys = system();
      const original = await login(sys);
      const before = (await database.pool.query('SELECT ciphertext FROM account_credentials'))
        .rows[0].ciphertext;
      const failing = system(true, {
        async commitLogin() {
          throw new Error('synthetic-sensitive-hook-canary');
        },
      });
      const response = await login(failing);
      expect(response.response.status).toBe(502);
      expect(response.body.token).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('synthetic-sensitive-hook-canary');
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        1,
      );
      expect(
        (await database.pool.query('SELECT ciphertext FROM account_credentials')).rows[0]
          .ciphertext,
      ).toBe(before);
      expect((await status(sys, original.token)).identity?.status).toBe('active');
    });

    it('expires recovery requests and never gives a normal session implicit principal-switch authority', async () => {
      await legacy({ key: false });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      await database.pool.query(
        "UPDATE account_recovery_requests SET expires_at=now()-interval '1 second'",
      );
      expect(
        (
          await request(sys, '/api/v1/account/recovery/independent-workspace', signed.token, {
            requestId: pending.recovery?.requestId,
          })
        ).status,
      ).toBe(410);
      expect(
        (await database.pool.query('SELECT status FROM account_identities')).rows[0].status,
      ).not.toBe('active');
    });

    it('switching a verified account with a held session creates a separate principal', async () => {
      const sys = system();
      const a = await login(sys);
      const b = await login(sys, 'bob', a.token);
      expect(b.response.status).toBe(200);
      expect(b.userId).not.toBe(a.userId);
      expect((await status(sys, b.token)).identity?.status).toBe('active');
      expect((await status(sys, a.token)).id).toBe('42');
    });

    it.each(['issuer', 'owner'] as const)(
      'known credential %s conflicts cannot become missing-key recovery',
      async (kind) => {
        const old = await legacy();
        fixture.invalidateToken(42, 5);
        await database.pool.query(
          'UPDATE account_credentials SET upstream_issuer=$1, upstream_owner_id=$2',
          [
            kind === 'issuer' ? 'https://historical.invalid' : fixture.baseUrl,
            kind === 'owner' ? '84' : '42',
          ],
        );
        const before = (await database.pool.query('SELECT ciphertext FROM account_credentials'))
          .rows[0].ciphertext;
        const sys = system();
        const signed = await login(sys, 'alice', old.token);
        expect((await status(sys, signed.token)).recovery?.reason).toBe('legacy_identity_conflict');
        expect(fixture.count({ operation: 'fetchTokenKey' })).toBe(0);
        expect(fixture.count({ operation: 'createToken' })).toBe(0);
        expect(
          (await database.pool.query('SELECT ciphertext FROM account_credentials')).rows[0]
            .ciphertext,
        ).toBe(before);
      },
    );

    it('activating legacy revokes old OAuth grant rows and requires explicit reauthorization', async () => {
      const old = await legacy();
      await database.pool.query(
        'INSERT INTO oauth_client(id,client_id,redirect_uris) VALUES ($1,$1,$2)',
        ['legacy-client', ['http://localhost/callback']],
      );
      await database.pool.query(
        'INSERT INTO oauth_consent(id,client_id,user_id,scopes) VALUES ($1,$2,$3,$4)',
        ['old-consent', 'legacy-client', old.userId, ['prompts:read']],
      );
      await database.pool.query(
        'INSERT INTO oauth_refresh_token(id,token,client_id,user_id,session_id,scopes) VALUES ($1,$1,$2,$3,$4,$5)',
        ['old-refresh', 'legacy-client', old.userId, old.sessionId, ['prompts:read']],
      );
      await database.pool.query(
        'INSERT INTO oauth_access_token(id,token,client_id,user_id,session_id,refresh_id,scopes) VALUES ($1,$1,$2,$3,$4,$5,$6)',
        ['old-access', 'legacy-client', old.userId, old.sessionId, 'old-refresh', ['prompts:read']],
      );
      const sys = system();
      expect(await sys.account.isPrincipalActive(old.userId)).toBe(false);
      const signed = await login(sys, 'alice', old.token);
      expect((await status(sys, signed.token)).identity?.status).toBe('active');
      expect((await database.pool.query('SELECT * FROM oauth_consent')).rows).toHaveLength(0);
      expect(
        (await database.pool.query('SELECT revoked FROM oauth_access_token')).rows[0].revoked,
      ).toBeInstanceOf(Date);
      expect(
        (await database.pool.query('SELECT revoked FROM oauth_refresh_token')).rows[0].revoked,
      ).toBeInstanceOf(Date);
      expect(
        (await database.pool.query('SELECT token FROM session WHERE id=$1', [old.sessionId]))
          .rows[0].token,
      ).toBe(old.token);
    });

    it.each([
      'bearer',
      'cookie',
      'signed-bearer',
      'padded-bearer',
      'invalid-bearer-with-cookie',
    ] as const)(
      'restricted %s cannot enumerate sessions, mutate auth or mint JWT',
      async (transport) => {
        await legacy({ key: false });
        const sys = system();
        const signed = await login(sys);
        const cookies = signed.response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0])
          .join('; ');
        expect(cookies).not.toBe('');
        const signedBearer = signed.response.headers.get('set-auth-token');
        expect(signedBearer).toBeTruthy();
        const transports: Record<typeof transport, Record<string, string>> = {
          bearer: { authorization: `Bearer ${signed.token}` },
          cookie: { cookie: cookies },
          'signed-bearer': { authorization: `Bearer ${signedBearer}` },
          'padded-bearer': { authorization: `Bearer   ${signed.token}` },
          'invalid-bearer-with-cookie': {
            authorization: 'Bearer invalid-fixture-token',
            cookie: cookies,
          },
        };
        const authorization = transports[transport];
        for (const [path, body] of [
          ['/list-sessions', undefined],
          ['/token', undefined],
          ['/revoke-other-sessions', {}],
          ['/update-user', { name: 'tampered' }],
        ] as const) {
          const response = await sys.app.request(`${API}/api/auth${path}`, {
            method: body ? 'POST' : 'GET',
            headers: { ...authorization, origin: API, 'content-type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (transport === 'invalid-bearer-with-cookie')
            expect([401, 403], path).toContain(response.status);
          else expect(response.status, path).toBe(403);
          expect(await response.text()).not.toContain(signed.token);
        }
        expect(
          (await database.pool.query('SELECT name FROM "user" WHERE id=$1', [signed.userId]))
            .rows[0].name,
        ).toBe('alice');
        expect(
          (await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n,
        ).toBe(2);
      },
    );

    it('normal sessions also cannot enumerate candidate bearer secrets', async () => {
      const sys = system();
      const signed = await login(sys);
      expect((await request(sys, '/api/auth/list-sessions', signed.token)).status).toBe(403);
    });

    it('an unavailable new-principal key can recover without manufacturing legacy proof', async () => {
      fixture.failNext({ operation: 'createToken' }, { status: 503 });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      expect(pending.recovery?.reason).toBe('verification_pending');
      expect((await database.pool.query('SELECT * FROM relay_sessions')).rows).toHaveLength(0);
      const response = await request(sys, '/api/v1/account/recovery/retry', signed.token, {
        requestId: pending.recovery?.requestId,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        recovery: null,
        identity: { status: 'active' },
      });
      expect(
        (await database.pool.query('SELECT evidence FROM account_identities')).rows[0].evidence
          .kind,
      ).toBe('fresh_principal');
    });

    it('after-commit hook failure still removes only its own BA session and candidate relay', async () => {
      const sys = system();
      const original = await login(sys);
      const failing = system(true, {
        async commitLogin(input) {
          await sys.account.commitLogin(input);
          throw new Error('synthetic-post-commit-canary');
        },
      });
      const failed = await login(failing);
      expect(failed.response.status).toBe(502);
      expect(JSON.stringify(failed.body)).not.toContain('synthetic-post-commit-canary');
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        1,
      );
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM relay_sessions')).rows[0].n,
      ).toBe(1);
      expect((await status(sys, original.token)).identity?.status).toBe('active');
      expect((await login(sys)).response.status).toBe(200);
    });

    it('cross-process refresh loser can retry the committed relay without another refresh', async () => {
      const one = system();
      const two = system();
      const signed = await login(one);
      const stored = (await database.pool.query('SELECT session_id FROM relay_sessions')).rows[0];
      await database.pool.query(
        "UPDATE relay_sessions SET access_expires_at=now()-interval '1 second'",
      );
      const pause = fixture.pauseNext({ operation: 'refresh' }, { phase: 'after' });
      const winner = one.account.getStatus(stored.session_id);
      await pause.reached;
      await expect(two.account.getStatus(stored.session_id)).rejects.toMatchObject({ status: 503 });
      pause.release();
      expect((await winner).identity?.status).toBe('active');
      expect((await status(two, signed.token)).identity?.status).toBe('active');
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
    });

    it('upgrades the actual 0008 database to 0009 without manufacturing identity or changing old bytes', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'musefold-identity-upgrade-'));
      await database.pool.query('CREATE DATABASE identity_upgrade');
      const uri = new URL(container.getConnectionUri());
      uri.pathname = '/identity_upgrade';
      const upgraded = createDatabase(uri.toString());
      try {
        const source = resolve(import.meta.dirname, '../../../../../packages/db/migrations');
        const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
          entries: { idx: number; tag: string }[];
        };
        journal.entries = journal.entries.filter((entry) => entry.idx < 9);
        await mkdir(join(directory, 'meta'));
        await writeFile(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
        for (const entry of journal.entries)
          await copyFile(join(source, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
        await migrate(upgraded.db, { migrationsFolder: directory });
        const relay = fixture.issueSession(42);
        const key = fixture.seedToken(42, { id: 81 }).key;
        const ciphertext = sealJsonToString({ apiKey: key }, KEY);
        const relayCiphertext = sealJsonToString(
          { jwt: relay.jwt, refreshToken: relay.refreshToken },
          KEY,
        );
        await upgraded.pool.query(
          'INSERT INTO "user"(id,name,email,new_api_user_id) VALUES ($1,$1,$2,84)',
          ['old-v21', 'old@example.test'],
        );
        await upgraded.pool.query(
          "INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
          ['old-session', 'old-v21', 'synthetic-old-ba-token'],
        );
        await upgraded.pool.query(
          'INSERT INTO account_credentials(user_id,external_token_id,ciphertext) VALUES ($1,$2,$3)',
          ['old-v21', '81', ciphertext],
        );
        await upgraded.pool.query(
          "INSERT INTO relay_sessions(session_id,user_id,ciphertext,access_expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
          ['old-session', 'old-v21', relayCiphertext],
        );
        await upgraded.pool.query(
          'INSERT INTO prompts(id,user_id,title,content) VALUES ($1,$2,$3,$4)',
          ['old-prompt', 'old-v21', 'old-title', 'old-content'],
        );
        await migrateDatabase(upgraded.db);
        await migrateDatabase(upgraded.db);
        const credential = (await upgraded.pool.query('SELECT * FROM account_credentials')).rows[0];
        expect(credential).toMatchObject({
          ciphertext,
          external_token_id: '81',
          key_version: 'v1',
          credential_version: 0,
          upstream_issuer: null,
          upstream_owner_id: null,
          credential_ref: null,
          status: 'unverified',
        });
        expect((await upgraded.pool.query('SELECT * FROM relay_sessions')).rows[0]).toMatchObject({
          ciphertext: relayCiphertext,
          upstream_issuer: null,
          upstream_owner_id: null,
          revision: 0,
        });
        expect(
          (await upgraded.pool.query('SELECT * FROM account_identities')).rows[0],
        ).toMatchObject({
          user_id: 'old-v21',
          status: 'unverified',
          identity_version: 0,
          upstream_issuer: null,
          upstream_owner_id: null,
          evidence: { kind: 'legacy_unverified' },
        });
        expect(
          (await upgraded.pool.query('SELECT * FROM account_session_authorizations')).rows,
        ).toHaveLength(0);
        expect(
          (await upgraded.pool.query('SELECT new_api_user_id FROM "user"')).rows[0].new_api_user_id,
        ).toBe(84);
        expect((await upgraded.pool.query('SELECT content FROM prompts')).rows[0].content).toBe(
          'old-content',
        );
        await expect(
          upgraded.pool.query("UPDATE account_credentials SET status='active'"),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          upgraded.pool.query("UPDATE account_identities SET status='active'"),
        ).rejects.toMatchObject({ code: '23514' });
        const dump = JSON.stringify(
          (await upgraded.pool.query('SELECT row_to_json(c) AS data FROM account_credentials c'))
            .rows,
        );
        expect(dump.includes(key)).toBe(false);
        expect(dump.includes(relay.jwt)).toBe(false);
      } finally {
        await upgraded.pool.end();
        await rm(directory, { recursive: true, force: true });
      }
    });

    it('actual OAuth PKCE issuance pins consent and old JWT/refresh stay revoked after reconsent', async () => {
      const sys = system();
      const signed = await login(sys);
      const scopes = ['account:read', 'prompts:read', 'skills:read', 'offline_access'];
      const clientId = 'identity-native-client';
      const redirectUri = 'http://127.0.0.1:54321/callback';
      await database.pool.query(
        'INSERT INTO oauth_client(id,client_id,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) VALUES ($1,$1,$2,$3,$4,$5,$6,true)',
        [
          clientId,
          [redirectUri],
          scopes,
          ['authorization_code', 'refresh_token'],
          ['code'],
          'none',
        ],
      );
      await database.pool.query(
        'INSERT INTO oauth_resource(id,identifier,name,allowed_scopes) VALUES ($1,$2,$1,$3) ON CONFLICT (identifier) DO NOTHING',
        ['identity-mcp-resource', `${API}/mcp`, scopes],
      );
      await database.pool.query(
        'INSERT INTO oauth_client_resource(id,client_id,resource_id) VALUES ($1,$2,$3)',
        ['identity-client-resource', clientId, `${API}/mcp`],
      );
      const consent = async (id: string) =>
        database.pool.query(
          'INSERT INTO oauth_consent(id,client_id,user_id,scopes,resources,created_at) VALUES ($1,$2,$3,$4,$5,now())',
          [id, clientId, signed.userId, scopes, [`${API}/mcp`]],
        );
      await consent('trusted-consent-1');
      const grant = async () => {
        const verifier = createHash('sha256').update(randomUUID()).digest('base64url');
        const query = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: scopes.join(' '),
          resource: `${API}/mcp`,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          state: randomUUID(),
        });
        const authorized = await request(sys, `/api/auth/oauth2/authorize?${query}`, signed.token);
        const location = authorized.headers.get('location');
        expect(authorized.status).toBe(302);
        expect(location).toBeTruthy();
        const params = new URL(location ?? redirectUri).searchParams;
        expect(params.get('error_description') ?? params.get('error')).toBeNull();
        const code = params.get('code');
        expect(Boolean(code)).toBe(true);
        const exchanged = await sys.app.request(`${API}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            redirect_uri: redirectUri,
            code: code ?? '',
            code_verifier: verifier,
          }),
        });
        expect(exchanged.status).toBe(200);
        const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };
        expect(typeof tokens.access_token).toBe('string');
        expect(typeof tokens.refresh_token).toBe('string');
        const claims = JSON.parse(
          Buffer.from(tokens.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        return { tokens, claims };
      };
      const first = await grant();
      const cloud = new CloudMcpService(database.db);
      expect(first.claims).toMatchObject({
        sub: signed.userId,
        client_id: clientId,
        mf_consent_id: 'trusted-consent-1',
      });
      expect(await cloud.hasActiveTokenAuthorization(first.claims)).toBe(true);
      await cloud.revokeAuthorization(signed.userId, clientId);
      expect(await cloud.hasActiveTokenAuthorization(first.claims)).toBe(false);
      await consent('trusted-consent-2');
      expect(await cloud.hasActiveTokenAuthorization(first.claims)).toBe(false);
      const { mf_consent_id: _removed, ...legacyClaims } = first.claims;
      expect(await cloud.hasActiveTokenAuthorization(legacyClaims)).toBe(false);
      const next = await grant();
      expect(next.claims.mf_consent_id).toBe('trusted-consent-2');
      expect(await cloud.hasActiveTokenAuthorization(next.claims)).toBe(true);
      const oldRefresh = await sys.app.request(`${API}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: first.tokens.refresh_token,
        }),
      });
      expect(oldRefresh.status).toBe(400);
      expect(await oldRefresh.json()).toMatchObject({ error: 'invalid_grant' });
      await request(sys, '/api/auth/sign-out', signed.token, {});
      expect(await cloud.hasActiveTokenAuthorization(next.claims)).toBe(false);
    });

    it('a real MCP OAuth token cannot cross into the session-protected JSON API (GAPX/B3)', async () => {
      const sys = system();
      const signed = await login(sys);
      const token = await mcpAccessToken(sys, signed.userId, signed.token);
      routeFixtureJwksFetch(sys);
      try {
        // 正例对照:同一枚 token 调 /mcp 正常——证明跨面 401 不是「token 本身无效」的假阴性。
        const list = await mcpCall(sys, token, 'tools/list');
        expect(list.status).toBe(200);
        const listed = (await list.json()) as { result?: { tools?: Array<{ name: string }> } };
        expect((listed.result?.tools ?? []).map((tool) => tool.name)).toContain('musefold_status');
        // 写路径 sentinel:requireSession 不接受 MCP 受众 JWT。
        const write = await request(sys, '/api/v1/generations', token, {});
        // 红线:若这里出现 200(意外放行),本套件将失败——禁止改生产代码,上报主代理裁决。
        expect(write.status, 'MCP token 不得跨面调用会话保护写 API').toBeOneOf([401, 403]);
        expect(sys.generationCalls()).toBe(0);
        // 读路径 sentinel 同样拒绝。
        const read = await request(sys, '/api/v1/private/history', token);
        expect(read.status, 'MCP token 不得跨面调用会话保护读 API').toBeOneOf([401, 403]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('Cloud MCP protocol negatives: no write tool, malformed args fail before downstream (GAPX/B3)', async () => {
      const sys = system();
      const signed = await login(sys);
      const token = await mcpAccessToken(sys, signed.userId, signed.token);
      routeFixtureJwksFetch(sys);
      try {
        // 目录钉死:只读白名单生效,生图/写工具不存在。
        const list = await mcpCall(sys, token, 'tools/list');
        expect(list.status).toBe(200);
        const names = (
          ((await list.json()) as { result?: { tools?: Array<{ name: string }> } }).result?.tools ??
          []
        ).map((tool) => tool.name);
        expect(names).toEqual(expect.arrayContaining(['musefold_status', 'search_prompts']));
        for (const forbidden of ['generate_image', 'run_scheme', 'run_github_skill'])
          expect(names, `${forbidden} 不在云端白名单`).not.toContain(forbidden);
        // 正例对照:合法 search_prompts 真正触达下游,证明计数器与工具链路是活的。
        const ok = await mcpCall(sys, token, 'tools/call', {
          name: 'search_prompts',
          arguments: { q: 'anything' },
        });
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as { result?: { isError?: boolean } }).result?.isError).not.toBe(
          true,
        );
        const baseline = sys.mcpPromptListCalls();
        expect(baseline).toBeGreaterThan(0);
        // 负例 1:调用不存在的生图/写工具 → JSON-RPC 错误(方法存在、工具不在白名单)。
        const unknown = await mcpCall(sys, token, 'tools/call', {
          name: 'generate_image',
          arguments: { prompt: 'x' },
        });
        const unknownBody = (await unknown.json()) as {
          error?: { code?: number; message?: string };
        };
        expect(unknownBody.error?.code).toBe(-32602);
        expect(unknownBody.error?.message).toContain('generate_image');
        // 负例 2:向现有只读工具提交 malformed arguments → 工具级错误且下游依赖未被调用。
        const malformed = await mcpCall(sys, token, 'tools/call', {
          name: 'search_prompts',
          arguments: { limit: 'not-a-number' },
        });
        expect(malformed.status).toBe(200);
        const malformedBody = (await malformed.json()) as {
          result?: { isError?: boolean; content?: Array<{ text?: string }> };
        };
        expect(malformedBody.result?.isError).toBe(true);
        expect(sys.mcpPromptListCalls()).toBe(baseline);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('source changes never send historical relay secrets to the new issuer and require explicit new space', async () => {
      const priorFixture = fixture;
      const original = await login(system());
      const priorCalls = priorFixture.requests.length;
      fixture = await startNewApiIdentityFixture();
      fixture.addOwner({ id: 42, username: 'alice' });
      fixture.mapUsername('alice', 42);
      try {
        const changed = system();
        const signed = await login(changed, 'alice', original.token);
        const pending = await status(changed, signed.token);
        expect(pending.canGenerate).toBe(false);
        expect(pending.recovery).toBeTruthy();
        expect(signed.userId).toBe(original.userId);
        expect(priorFixture.requests.length).toBe(priorCalls);
        expect(fixture.count({ operation: 'refresh' })).toBe(0);
        expect(fixture.count({ operation: 'fetchTokenKey' })).toBe(0);
        expect(
          fixture.requests.some(
            (request) => request.operation === 'getSelf' && request.status !== 200,
          ),
        ).toBe(false);
        const next = await request(
          changed,
          '/api/v1/account/recovery/independent-workspace',
          signed.token,
          { requestId: pending.recovery?.requestId },
        );
        expect(next.status).toBe(200);
        const summary = accountSummarySchema.parse(await next.json());
        expect(summary.identity?.principalId).not.toBe(original.userId);
        expect(summary.identity?.status).toBe('active');
        expect(
          (
            await database.pool.query(
              'SELECT upstream_issuer FROM account_identities WHERE user_id=$1',
              [original.userId],
            )
          ).rows[0].upstream_issuer,
        ).toBe(priorFixture.baseUrl);
      } finally {
        await priorFixture.close();
      }
    });

    it('two independent-space completions serialize and only one can change the restricted principal', async () => {
      const old = await legacy({ key: false });
      const one = system();
      const two = system();
      const signed = await login(one);
      const pending = await status(one, signed.token);
      const body = { requestId: pending.recovery?.requestId };
      const pause = fixture.pauseNext({ operation: 'fetchTokenKey' }, { phase: 'after' });
      const late = request(
        one,
        '/api/v1/account/recovery/independent-workspace',
        signed.token,
        body,
      );
      await pause.reached;
      const winner = await request(
        two,
        '/api/v1/account/recovery/independent-workspace',
        signed.token,
        body,
      );
      expect(winner.status).toBe(200);
      pause.release();
      expect((await late).status).toBe(409);
      const active = await status(two, signed.token);
      expect(active.identity?.principalId).not.toBe(old.userId);
      expect((await database.pool.query('SELECT * FROM account_credentials')).rows).toHaveLength(1);
      expect((await database.pool.query('SELECT * FROM session')).rows).toHaveLength(2);
      expect(
        (await request(one, '/api/v1/account/recovery/independent-workspace', signed.token, body))
          .status,
      ).toBe(200);
    });

    it('original proof revalidates owner after inspect and cannot use a stale inspection as authority', async () => {
      const old = await legacy({ key: false });
      const sys = system();
      const signed = await login(sys);
      const pending = await status(sys, signed.token);
      const body = { requestId: pending.recovery?.requestId };
      expect((await request(sys, '/api/v1/account/recovery/inspect', old.token, body)).status).toBe(
        200,
      );
      fixture.setGetSelfOwner(old.relay.jwt, 84);
      expect(
        (await request(sys, '/api/v1/account/recovery/verify-original-session', old.token, body))
          .status,
      ).toBe(404);
      expect(fixture.count({ operation: 'createToken' })).toBe(0);
      expect((await status(sys, signed.token)).canGenerate).toBe(false);
    });

    it('repeated login with a recovery bearer cannot become original-device evidence', async () => {
      await legacy({ key: false });
      const sys = system();
      const first = await login(sys);
      const second = await login(sys, 'alice', first.token);
      expect((await status(sys, first.token)).recovery?.reason).toBe('legacy_evidence_missing');
      expect((await status(sys, second.token)).recovery?.reason).toBe('legacy_evidence_missing');
      expect(fixture.count({ operation: 'createToken' })).toBe(0);
      expect((await database.pool.query('SELECT * FROM relay_sessions')).rows).toHaveLength(1);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM account_session_authorizations WHERE mode='normal'",
          )
        ).rows,
      ).toHaveLength(0);
    });

    it('an invalid signed normal bearer cannot mask an effective recovery cookie', async () => {
      await legacy({ key: false });
      const sys = system();
      const restricted = await login(sys);
      const normal = await login(sys, 'bob');
      const cookie = restricted.response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const response = await sys.app.request(`${API}/api/auth/token`, {
        headers: { authorization: `Bearer ${normal.token}.invalid-signature`, cookie },
      });
      expect(response.status).toBe(403);
    });
  },
);
