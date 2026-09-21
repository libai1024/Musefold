import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { RelayAuthSession, RelayUser } from '@musefold/new-api-client';

export type IdentityOperation =
  | 'login'
  | 'refresh'
  | 'getSelf'
  | 'listTokens'
  | 'createToken'
  | 'fetchTokenKey'
  | 'models'
  | 'pricing'
  | 'notices'
  | 'logout'
  | 'managedSession'
  | 'unknown';

export interface IdentityRequestMatch {
  operation: IdentityOperation;
  ownerId?: number;
  username?: string;
  tokenId?: number;
}

/** Intentionally excludes request bodies, headers, passwords, JWTs and keys. */
export interface IdentityRequestObservation {
  sequence: number;
  operation: IdentityOperation;
  ownerId: number | null;
  sessionNumber: number | null;
  username?: string;
  tokenId?: number;
  status: number | null;
  completed: boolean;
}

export interface IdentityFixtureToken {
  id: number;
  name: string;
  key: string;
  status: number;
}

type Phase = 'before' | 'after';
interface Barrier {
  match: IdentityRequestMatch;
  phase: Phase;
  entered: (request: IdentityRequestObservation) => void;
  released: Promise<void>;
  release: () => void;
}

interface Failure {
  match: IdentityRequestMatch;
  phase: Phase;
  status: number;
  message: string;
  disconnect: boolean;
}

interface SessionSecret {
  ownerId: number;
  sessionNumber: number;
  familyNumber: number;
  active: boolean;
  expiresAt: number;
}

interface Reply {
  status: number;
  body: { success: boolean; message?: string; data?: unknown; [key: string]: unknown };
  cookie?: string;
}

function matches(match: IdentityRequestMatch, request: IdentityRequestObservation): boolean {
  return (
    match.operation === request.operation &&
    (match.ownerId === undefined || match.ownerId === request.ownerId) &&
    (match.username === undefined || match.username === request.username) &&
    (match.tokenId === undefined || match.tokenId === request.tokenId)
  );
}

function take<T extends { match: IdentityRequestMatch; phase: Phase }>(
  rules: T[],
  request: IdentityRequestObservation,
  phase: Phase,
): T | undefined {
  const index = rules.findIndex((rule) => rule.phase === phase && matches(rule.match, request));
  return index < 0 ? undefined : rules.splice(index, 1)[0];
}

function success(data?: unknown): Reply {
  return { status: 200, body: { success: true, ...(data === undefined ? {} : { data }) } };
}

function failure(status: number, message: string): Reply {
  return { status, body: { success: false, message } };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 65_536) throw new Error('Fixture request body exceeds limit');
    chunks.push(bytes);
  }
  if (!length) return {};
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid fixture JSON');
  return body as Record<string, unknown>;
}

function operationFor(method: string | undefined, path: string): IdentityOperation {
  if (method === 'GET' && (path === '/api/status' || path === '/api/notice')) return 'notices';
  if (
    (method === 'POST' &&
      [
        '/api/user/managed-login/complete',
        '/api/user/managed-login/review',
        '/api/user/managed-login/cancel',
        '/api/user/managed-login/release',
        '/api/user/managed-sessions/touch',
      ].includes(path)) ||
    (method === 'GET' && path === '/api/user/managed-sessions')
  )
    return 'managedSession';
  if (method === 'POST' && (path === '/api/user/login' || path === '/api/user/managed-login/begin'))
    return 'login';
  if (method === 'POST' && path === '/api/user/auth/refresh') return 'refresh';
  if (method === 'GET' && path === '/api/user/self') return 'getSelf';
  if (method === 'GET' && path === '/api/user/models') return 'models';
  if (method === 'GET' && path === '/api/pricing') return 'pricing';
  if (path === '/api/token/' && method === 'GET') return 'listTokens';
  if (path === '/api/token/' && method === 'POST') return 'createToken';
  if (method === 'POST' && /^\/api\/token\/\d+\/key$/.test(path)) return 'fetchTokenKey';
  if (method === 'POST' && (path === '/__fixture/logout' || path === '/api/user/auth/logout'))
    return 'logout';
  return 'unknown';
}

/** Real loopback transport for owner-sensitive account/credential integration tests. */
export async function startNewApiIdentityFixture(options: { refreshSingleUse?: boolean } = {}) {
  const instance = randomUUID();
  const owners = new Map<number, RelayUser>();
  const catalogs = new Map<number, { models: string[]; pricing: Record<string, unknown> }>();
  let notices: { announcements: unknown; notice: unknown } = { announcements: [], notice: '' };
  const logins = new Map<string, { ownerId: number; password: string }>();
  const ownerTokens = new Map<number, Map<number, IdentityFixtureToken>>();
  const jwtSecrets = new Map<string, SessionSecret>();
  const refreshSecrets = new Map<string, SessionSecret>();
  const selfOverrides = new Map<string, number>();
  const refreshOverrides = new Map<string, number>();
  const observations: IdentityRequestObservation[] = [];
  const barriers: Barrier[] = [];
  const allBarriers = new Set<Barrier>();
  const failures: Failure[] = [];
  // Protocol adapter for production-API process tests. Capacity atomicity and
  // security are verified against the actual Go extension, not this fixture.
  const grants = new Map<
    string,
    { ownerId: number; expires: number; operation?: string; relay?: RelayAuthSession }
  >();
  const managedSessions = new Map<string, RelayAuthSession>();
  let sessionSequence = 0;
  let tokenSequence = 0;
  let keySequence = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;

  function requireOwner(ownerId: number): RelayUser {
    const owner = owners.get(ownerId);
    if (!owner) throw new Error(`Fixture owner ${ownerId} is not configured`);
    return owner;
  }

  function issueSession(
    ownerId: number,
    sessionOptions: { expiresInSeconds?: number } = {},
    familyNumber?: number,
  ): RelayAuthSession {
    const owner = requireOwner(ownerId);
    const sessionNumber = ++sessionSequence;
    const expiresAt = Math.floor(Date.now() / 1000) + (sessionOptions.expiresInSeconds ?? 3600);
    const jwt = `fixture-jwt-${instance}-${sessionNumber}`;
    const refreshToken = `fixture-refresh-${instance}-${sessionNumber}`;
    const identity = {
      ownerId,
      sessionNumber,
      familyNumber: familyNumber ?? sessionNumber,
      active: true,
      expiresAt,
    };
    jwtSecrets.set(jwt, { ...identity });
    refreshSecrets.set(refreshToken, { ...identity });
    return { jwt, refreshToken, jwtExpiresAt: expiresAt, user: { ...owner } };
  }

  function seedToken(
    ownerId: number,
    input: Partial<IdentityFixtureToken> = {},
  ): IdentityFixtureToken {
    requireOwner(ownerId);
    const tokens = ownerTokens.get(ownerId);
    if (!tokens) throw new Error('Fixture token store is missing');
    const id = input.id ?? ++tokenSequence;
    if (tokens.has(id)) throw new Error(`Fixture token ${id} already exists for owner ${ownerId}`);
    tokenSequence = Math.max(tokenSequence, id);
    const token = {
      id,
      name: input.name ?? 'Musefold Cloud v2.5',
      key: input.key ?? `sk-fixture-${instance}-${ownerId}-${id}-${++keySequence}`,
      status: input.status ?? 1,
    };
    tokens.set(id, token);
    return { ...token };
  }

  function requireToken(ownerId: number, id: number): IdentityFixtureToken {
    const token = ownerTokens.get(ownerId)?.get(id);
    if (!token) throw new Error(`Fixture token ${id} is not owned by ${ownerId}`);
    return token;
  }

  function sessionReply(session: RelayAuthSession): Reply {
    return {
      ...success({
        access_token: session.jwt,
        access_expires_at: session.jwtExpiresAt,
        user: session.user,
        revoked_session_ids: [],
        ...(session.cleanup
          ? { cleanup_token: session.cleanup.token, session: { sid: session.cleanup.sid } }
          : {}),
      }),
      cookie: `new_api_refresh=${session.refreshToken}; Path=/api/user/auth; HttpOnly; SameSite=Lax`,
    };
  }

  function invalidateSession(jwt: string): void {
    const identity = jwtSecrets.get(jwt);
    if (!identity) throw new Error('Fixture JWT is not configured');
    for (const secret of [...jwtSecrets.values(), ...refreshSecrets.values()]) {
      if (secret.familyNumber === identity.familyNumber) secret.active = false;
    }
  }

  function managedPage(ownerId: number, currentFamily?: number) {
    const now = Math.floor(Date.now() / 1000);
    const items = [...managedSessions.values()].flatMap((relay) => {
      const identity = jwtSecrets.get(relay.jwt);
      if (!identity?.active || identity.ownerId !== ownerId || !relay.cleanup) return [];
      return [
        {
          sid: relay.cleanup.sid,
          version: 1,
          current: identity.familyNumber === currentFamily,
          user_agent: 'Synthetic identity fixture',
          ip: '127.0.0.1',
          created_at: now,
          last_interactive_at: now,
          last_seen_at: now,
          expires_at: now + 2592000,
        },
      ];
    });
    return { items, total: items.length, limit: 50, required: Math.max(0, items.length - 49) };
  }

  function managedReply(
    path: string,
    body: Record<string, unknown>,
    jwt: string,
    loginSnapshot: { ownerId: number; password: string } | undefined,
  ): Reply {
    const now = Math.floor(Date.now() / 1000);
    const denied = (code: string, status = 401): Reply => ({
      status,
      body: { success: false, code },
    });
    if (path.endsWith('/begin')) {
      if (!loginSnapshot || loginSnapshot.password !== body.password)
        return denied('AUTH_CREDENTIALS_INVALID');
      const token = randomUUID();
      grants.set(token, { ownerId: loginSnapshot.ownerId, expires: now + 300 });
      return success({
        flow_token: token,
        expires_at: now + 300,
        sessions: managedPage(loginSnapshot.ownerId),
      });
    }
    if (path.endsWith('/release')) {
      const relay = managedSessions.get(String(body.sid));
      if (!relay?.cleanup || relay.cleanup.token !== body.cleanup_token)
        return denied('AUTH_UNAUTHORIZED');
      invalidateSession(relay.jwt);
      return success({ released: true });
    }
    if (path.startsWith('/api/user/managed-login/')) {
      const grant = grants.get(String(body.flow_token));
      if (!grant || grant.expires <= now) return denied('AUTH_LOGIN_CHALLENGE_EXPIRED');
      if (path.endsWith('/review'))
        return success({ expires_at: grant.expires, sessions: managedPage(grant.ownerId) });
      if (path.endsWith('/cancel')) {
        grants.delete(String(body.flow_token));
        return success();
      }
      if (path.endsWith('/complete')) {
        if (grant.operation && grant.operation !== body.operation)
          return denied('AUTH_OPERATION_CONFLICT', 409);
        if (!grant.relay) {
          grant.operation = String(body.operation);
          grant.relay = issueSession(grant.ownerId);
          grant.relay.cleanup = { sid: randomUUID(), token: 'f'.repeat(64) };
          managedSessions.set(grant.relay.cleanup.sid, grant.relay);
        }
        return sessionReply(grant.relay);
      }
    }
    const identity = jwtSecrets.get(jwt);
    if (!identity?.active || identity.expiresAt <= now) return denied('AUTH_UNAUTHORIZED');
    if (path.endsWith('/touch')) return success();
    if (path === '/api/user/managed-sessions')
      return success(managedPage(identity.ownerId, identity.familyNumber));
    return failure(404, 'Managed fixture route is not implemented');
  }

  function execute(
    observation: IdentityRequestObservation,
    body: Record<string, unknown>,
    jwt: string,
    refreshToken: string,
    loginSnapshot: { ownerId: number; password: string } | undefined,
    url: URL,
  ): Reply {
    const operation = observation.operation;
    if (operation === 'notices')
      return success(
        url.pathname === '/api/status' ? { announcements: notices.announcements } : notices.notice,
      );
    if (operation === 'managedSession' || url.pathname === '/api/user/managed-login/begin')
      return managedReply(url.pathname, body, jwt, loginSnapshot);
    if (operation === 'unknown') return failure(404, 'Fixture route is not implemented');
    if (operation === 'login') {
      if (!loginSnapshot || loginSnapshot.password !== body.password)
        return failure(401, 'Fixture credentials rejected');
      return sessionReply(issueSession(loginSnapshot.ownerId));
    }
    if (operation === 'refresh') {
      const identity = refreshSecrets.get(refreshToken);
      if (!identity?.active) return failure(401, 'Fixture refresh rejected');
      // This synchronous consume occurs after the before-barrier: concurrent requests race here.
      if (options.refreshSingleUse !== false) identity.active = false;
      return sessionReply(
        issueSession(
          refreshOverrides.get(refreshToken) ?? identity.ownerId,
          {},
          identity.familyNumber,
        ),
      );
    }
    const identity = jwtSecrets.get(jwt);
    if (!identity?.active || identity.expiresAt <= Math.floor(Date.now() / 1000))
      return failure(401, 'Fixture session expired');
    const ownerId = identity.ownerId;
    switch (operation) {
      case 'getSelf':
        return success({ ...requireOwner(selfOverrides.get(jwt) ?? ownerId) });
      case 'models':
        return success(catalogs.get(ownerId)?.models ?? ['musefold-image-pro']);
      case 'pricing':
        return { status: 200, body: { success: true, ...catalogs.get(ownerId)?.pricing } };
      case 'listTokens': {
        const page = Math.max(0, Number(url.searchParams.get('p')) || 0);
        const size = Math.max(1, Math.min(100, Number(url.searchParams.get('page_size')) || 20));
        const tokens = [...(ownerTokens.get(ownerId)?.values() ?? [])];
        return success({
          items: tokens.slice(page * size, (page + 1) * size).map((token) => ({
            id: token.id,
            name: token.name,
            status: token.status,
            key: 'sk-***',
          })),
          total: tokens.length,
        });
      }
      case 'createToken':
        if (typeof body.name !== 'string' || !body.name)
          return failure(400, 'Fixture token needs name');
        seedToken(ownerId, { name: body.name });
        return success();
      case 'fetchTokenKey': {
        const token = ownerTokens.get(ownerId)?.get(observation.tokenId ?? -1);
        if (!token) return failure(404, 'Fixture token is not owned by this account');
        if (token.status !== 1) return failure(403, 'Fixture token is inactive');
        return success({ key: token.key });
      }
      case 'logout':
        invalidateSession(jwt);
        return success();
    }
  }

  async function waitForBarrier(
    observation: IdentityRequestObservation,
    barrier: Barrier | undefined,
  ) {
    if (!barrier) return;
    barrier.entered({ ...observation });
    await barrier.released;
    allBarriers.delete(barrier);
  }

  function write(response: ServerResponse, observation: IdentityRequestObservation, reply: Reply) {
    observation.status = reply.status;
    response.writeHead(reply.status, {
      'content-type': 'application/json',
      ...(reply.cookie ? { 'set-cookie': reply.cookie } : {}),
    });
    response.end(JSON.stringify(reply.body));
    observation.completed = true;
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ success: false, message: 'Fixture request failed' }));
      } else response.destroy();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readBody(request);
    const operation = operationFor(request.method, url.pathname);
    const jwt = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? '';
    const refreshToken =
      /(?:^|;\s*)new_api_refresh=([^;]+)/.exec(request.headers.cookie ?? '')?.[1] ?? '';
    const username =
      operation === 'login' && typeof body.username === 'string' ? body.username : undefined;
    const mappedLogin = username === undefined ? undefined : logins.get(username);
    const loginSnapshot = mappedLogin ? { ...mappedLogin } : undefined;
    const identity =
      operation === 'refresh' ? refreshSecrets.get(refreshToken) : jwtSecrets.get(jwt);
    const tokenMatch = /^\/api\/token\/(\d+)\/key$/.exec(url.pathname);
    const observation: IdentityRequestObservation = {
      sequence: observations.length + 1,
      operation,
      ownerId: loginSnapshot?.ownerId ?? identity?.ownerId ?? null,
      sessionNumber: identity?.sessionNumber ?? null,
      ...(username === undefined ? {} : { username }),
      ...(tokenMatch ? { tokenId: Number(tokenMatch[1]) } : {}),
      status: null,
      completed: false,
    };
    observations.push(observation);
    // Consume rules on arrival so later requests cannot steal an earlier request's after-rule.
    const beforeFailure = take(failures, observation, 'before');
    const afterFailure = take(failures, observation, 'after');
    const beforeBarrier = take(barriers, observation, 'before');
    const afterBarrier = take(barriers, observation, 'after');
    await waitForBarrier(observation, beforeBarrier);
    if (closing || response.destroyed) return;
    if (beforeFailure?.disconnect) return response.destroy();
    const reply = beforeFailure
      ? failure(beforeFailure.status, beforeFailure.message)
      : execute(observation, body, jwt, refreshToken, loginSnapshot, url);
    observation.status = reply.status;
    // The reply is already a snapshot; rotation/remapping during this wait cannot rewrite it.
    await waitForBarrier(observation, afterBarrier);
    if (closing || response.destroyed) return;
    if (afterFailure?.disconnect) return response.destroy();
    write(
      response,
      observation,
      afterFailure ? failure(afterFailure.status, afterFailure.message) : reply,
    );
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture has no loopback address');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    setNotices(value: { announcements: unknown; notice: unknown }) {
      notices = structuredClone(value);
    },
    addOwner(
      input: Pick<RelayUser, 'id' | 'username'> & Partial<Pick<RelayUser, 'quota' | 'group'>>,
    ) {
      if (!Number.isSafeInteger(input.id) || input.id <= 0 || owners.has(input.id))
        throw new Error('Fixture owner ID must be unique and positive');
      owners.set(input.id, { quota: 1_000_000, group: 'default', ...input });
      ownerTokens.set(input.id, new Map());
    },
    mapUsername(username: string, ownerId: number, password = 'fixture-password') {
      requireOwner(ownerId);
      logins.set(username, { ownerId, password });
    },
    setModelCatalog(
      ownerId: number,
      value: { models: string[]; pricing: Record<string, unknown> },
    ) {
      requireOwner(ownerId);
      catalogs.set(ownerId, structuredClone(value));
    },
    setGroup(ownerId: number, group: string) {
      requireOwner(ownerId).group = group;
    },
    issueSession: (ownerId: number, input?: { expiresInSeconds?: number }) =>
      issueSession(ownerId, input),
    seedToken,
    rotateToken(ownerId: number, id: number): IdentityFixtureToken {
      const token = requireToken(ownerId, id);
      token.key = `sk-fixture-${instance}-${ownerId}-${id}-${++keySequence}`;
      token.status = 1;
      return { ...token };
    },
    invalidateToken(ownerId: number, id: number) {
      requireToken(ownerId, id).status = 2;
    },
    isTokenKeyActive(ownerId: number, key: string) {
      return [...(ownerTokens.get(ownerId)?.values() ?? [])].some(
        (token) => token.status === 1 && token.key === key,
      );
    },
    invalidateJwt(jwt: string) {
      const secret = jwtSecrets.get(jwt);
      if (!secret) throw new Error('Fixture JWT is not configured');
      secret.active = false;
    },
    invalidateRefresh(refreshToken: string) {
      const secret = refreshSecrets.get(refreshToken);
      if (!secret) throw new Error('Fixture refresh token is not configured');
      secret.active = false;
    },
    invalidateSession,
    setGetSelfOwner(jwt: string, ownerId: number | null) {
      if (!jwtSecrets.has(jwt)) throw new Error('Fixture JWT is not configured');
      if (ownerId === null) selfOverrides.delete(jwt);
      else {
        requireOwner(ownerId);
        selfOverrides.set(jwt, ownerId);
      }
    },
    setRefreshOwner(refreshToken: string, ownerId: number | null) {
      if (!refreshSecrets.has(refreshToken))
        throw new Error('Fixture refresh token is not configured');
      if (ownerId === null) refreshOverrides.delete(refreshToken);
      else {
        requireOwner(ownerId);
        refreshOverrides.set(refreshToken, ownerId);
      }
    },
    pauseNext(match: IdentityRequestMatch, input: { phase?: Phase } = {}) {
      if (closing) throw new Error('Fixture is closed');
      let entered!: Barrier['entered'];
      let release!: () => void;
      const reached = new Promise<IdentityRequestObservation>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const barrier = {
        match: { ...match },
        phase: input.phase ?? 'before',
        entered,
        released,
        release,
      };
      barriers.push(barrier);
      allBarriers.add(barrier);
      return { reached, release };
    },
    failNext(
      match: IdentityRequestMatch,
      input: { status?: number; message?: string; disconnect?: boolean; phase?: Phase } = {},
    ) {
      failures.push({
        match: { ...match },
        phase: input.phase ?? 'before',
        status: input.status ?? 503,
        message: input.message ?? 'Fixture injected failure',
        disconnect: input.disconnect ?? false,
      });
    },
    count(match: IdentityRequestMatch) {
      return observations.filter((request) => matches(match, request)).length;
    },
    get requests(): IdentityRequestObservation[] {
      return observations.map((request) => ({ ...request }));
    },
    close(): Promise<void> {
      if (!closePromise) {
        closing = true;
        for (const barrier of allBarriers) barrier.release();
        allBarriers.clear();
        closePromise = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
      return closePromise;
    },
  };
}

export type NewApiIdentityFixture = Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
