import { createServer } from 'node:http';
import { completeLoginCapacitySchema } from '@musefold/contracts';

/** Client transport fixture, NOT evidence of upstream auth/DB atomicity.
 * The latter is covered independently by Go and real Better Auth/PG tests. */
export function loginSessionsFixture(total = 2) {
  const flowRef = '1e82e2b2-1057-424d-81c0-5acb9c6d905f';
  const state = {
    signedIn: false,
    offline: false,
    conflictOnce: false,
    releases: 0,
    cancelled: 0,
    completes: [] as Array<{
      operationId: string;
      selected: Array<{ sessionRef: string; version: number }>;
    }>,
  };
  let desktopBinding: string | null = null;
  const items = Array.from({ length: total }, (_, index) => ({
    sessionRef: `device-${index}`,
    version: 1,
    current: state.signedIn && index === 0,
    client: index % 2 ? 'Safari' : 'Chrome',
    platform: index % 2 ? 'iOS' : 'macOS',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastInteractiveAt: null,
    lastSeenAt: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    maskedIp: '192.168.*.*',
  }));
  const page = () => ({
    items: items.map((item, index) => ({ ...item, current: state.signedIn && index === 0 })),
    total: items.length,
    limit: total,
    required: 1,
    requiresReauthentication: false,
  });
  const review = () => ({
    flowRef,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessions: page(),
  });
  const account = {
    id: 'session-test-owner',
    username: 'session-creator',
    displayName: null,
    quota: 500_000,
    quotaUnit: '点',
    canGenerate: true,
  };
  const reply = (body: unknown, status = 200) => ({ status, body });
  const error = (code: string, status = 401) =>
    reply({ error: { code, message: 'Fixture authentication required' } }, status);
  function respond(path: string, body: unknown, binding: string | null = null) {
    if (path === '/api/auth/sign-in/new-api') {
      desktopBinding = binding;
      return reply(
        {
          code: 'AUTH_SESSION_LIMIT',
          message: '登录设备数量已达上限',
          details: { review: review() },
        },
        409,
      );
    }
    if (path.startsWith('/api/auth/login-capacity/')) {
      if (binding !== desktopBinding) return error('AUTH_LOGIN_CHALLENGE_EXPIRED');
      if (path.endsWith('/review')) return reply(review());
      if (path.endsWith('/cancel')) {
        state.cancelled++;
        return reply({ cancelled: true });
      }
      const input = completeLoginCapacitySchema.parse(body);
      if (input.flowRef !== flowRef) return error('AUTH_LOGIN_CHALLENGE_EXPIRED');
      state.completes.push({ operationId: input.operationId, selected: input.selected });
      if (state.conflictOnce) {
        state.conflictOnce = false;
        return reply({ code: 'AUTH_SESSION_REVIEW_CHANGED', message: '选择已变化' }, 409);
      }
      state.signedIn = true;
      return reply({
        managed: true,
        ...(binding ? { token: 'synthetic-main-process-session-bearer' } : {}),
        user: { id: account.id },
      });
    }
    if (path === '/api/auth/sign-out') {
      if (state.offline) return error('INTERNAL_ERROR', 503);
      state.releases++;
      state.signedIn = false;
      return reply({ success: true });
    }
    if (path === '/api/v1/account/status')
      return state.signedIn ? reply(account) : error('AUTH_REQUIRED');
    if (path === '/api/v1/account/login-sessions') return reply(page());
    if (path === '/api/v1/account/login-sessions/touch') return reply({ confirmed: true });
    if (path === '/api/v1/workbench/sessions') return reply({ items: [], nextCursor: null });
    if (path === '/api/v1/generations/providers') return reply([]);
    return error('NOT_FOUND', 404);
  }
  return { state, respond };
}

export async function loginSessionHttpFixture() {
  const fixture = loginSessionsFixture();
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      const value = fixture.respond(
        request.url ?? '/',
        raw ? JSON.parse(raw) : undefined,
        typeof request.headers['x-musefold-login-binding'] === 'string'
          ? request.headers['x-musefold-login-binding']
          : null,
      );
      response.writeHead(value.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value.body));
    } catch {
      response.writeHead(400);
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return {
    ...fixture,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
