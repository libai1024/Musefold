import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewApiClient, type NewApiClient } from '../index';

const servers: Server[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
const encoder = new TextEncoder();
const selfBody = JSON.stringify({ success: true, data: { id: 7, username: '未像' } });

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: { method: string | undefined; path: string | undefined }[] = [];
  let closedResponses = 0;
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.on('close', () => {
      closedResponses += 1;
    });
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    closedResponses: () => closedResponses,
  };
}

afterEach(async () => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('New API bounded HTTP transport', () => {
  it.each(['no headers', 'headers only', 'partial body', 'continuous trickle'])(
    'applies one total deadline to %s and closes the response without retrying',
    async (mode) => {
      const upstream = await fixture((_request, response) => {
        if (mode === 'no headers') return;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.flushHeaders();
        if (mode === 'partial body') response.write('{"success":');
        if (mode === 'continuous trickle') {
          const timer = setInterval(() => response.write(' '), 20);
          timers.push(timer);
          response.on('close', () => clearInterval(timer));
        }
      });
      const client = createNewApiClient(upstream.url, { timeoutMs: 200 });
      const started = performance.now();
      await expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
        code: 'network',
        message: '连接账号服务器超时',
      });
      expect(performance.now() - started).toBeLessThan(1_500);
      await vi.waitFor(() => expect(upstream.closedResponses()).toBe(1));
      expect(upstream.requests).toEqual([{ method: 'GET', path: '/api/user/self' }]);
    },
  );

  it('accepts a complete response at the exact UTF-8 byte limit', async () => {
    const upstream = await fixture((_request, response) => response.end(selfBody));
    const client = createNewApiClient(upstream.url, {
      maxResponseBytes: encoder.encode(selfBody).byteLength,
    });
    await expect(client.getSelf('jwt-secret')).resolves.toMatchObject({ id: 7, username: '未像' });
  });

  it('starts the body deadline at request dispatch rather than at response headers', async () => {
    const upstream = await fixture((_request, response) => {
      const headersTimer = setTimeout(() => {
        response.writeHead(200);
        response.write('{"success":true,');
      }, 100);
      const bodyTimer = setTimeout(() => response.end('"data":{"id":7}}'), 300);
      timers.push(headersTimer, bodyTimer);
    });
    await expect(
      createNewApiClient(upstream.url, { timeoutMs: 220 }).getSelf('jwt-secret'),
    ).rejects.toMatchObject({
      code: 'network',
      message: '连接账号服务器超时',
      httpStatus: 200,
    });
    await vi.waitFor(() => expect(upstream.closedResponses()).toBe(1));
  });

  it('keeps a later healthy request usable after an earlier request times out', async () => {
    let requests = 0;
    const upstream = await fixture((_request, response) => {
      requests += 1;
      response.writeHead(200);
      if (requests === 1) response.flushHeaders();
      else response.end(selfBody);
    });
    const client = createNewApiClient(upstream.url, { timeoutMs: 200 });
    await expect(client.getSelf('jwt-secret')).rejects.toMatchObject({ code: 'network' });
    await expect(client.getSelf('jwt-secret')).resolves.toMatchObject({ id: 7 });
    expect(upstream.requests).toHaveLength(2);
  });

  it('preserves the 401 auth error without leaking its response message', async () => {
    const upstream = await fixture((_request, response) => {
      response.writeHead(401);
      response.end(JSON.stringify({ success: false, message: 'Bearer jwt-secret' }));
    });
    await expect(createNewApiClient(upstream.url).getSelf('jwt-secret')).rejects.toMatchObject({
      code: 'auth',
      message: '登录状态已失效',
      httpStatus: 401,
    });
  });

  it.each(['declared size', 'chunked bytes', 'compressed decoded bytes'])(
    'rejects excessive %s and cancels the remaining body',
    async (mode) => {
      const oversized = JSON.stringify({ success: true, data: '未'.repeat(500) });
      const upstream = await fixture((_request, response) => {
        if (mode === 'declared size') {
          response.writeHead(200, { 'Content-Length': 100_000 });
          response.flushHeaders();
        } else if (mode === 'compressed decoded bytes') {
          const compressed = gzipSync(oversized);
          expect(compressed.byteLength).toBeLessThan(100);
          response.writeHead(200, {
            'Content-Encoding': 'gzip',
            'Content-Length': compressed.byteLength,
          });
          response.end(compressed);
        } else {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.write(oversized);
        }
      });
      const client = createNewApiClient(upstream.url, { maxResponseBytes: 100, timeoutMs: 1_000 });
      await expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
        code: 'server',
        message: '账号服务器响应超过大小限制',
        httpStatus: 200,
      });
      await vi.waitFor(() => expect(upstream.closedResponses()).toBe(1));
      expect(upstream.requests).toHaveLength(1);
    },
  );

  it('enforces the default 2 MiB ceiling without an option override', async () => {
    const upstream = await fixture((_request, response) => {
      response.writeHead(200);
      response.write(' '.repeat(2 * 1024 * 1024 + 1));
    });
    await expect(createNewApiClient(upstream.url).getSelf('jwt-secret')).rejects.toMatchObject({
      message: '账号服务器响应超过大小限制',
    });
    await vi.waitFor(() => expect(upstream.closedResponses()).toBe(1));
  });

  it('distinguishes an interrupted body from JSON errors and does not retry', async () => {
    const upstream = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Length': 100 });
      response.write('{"secret":"jwt-secret');
      const timer = setTimeout(() => response.destroy(), 40);
      timers.push(timer);
    });
    await expect(createNewApiClient(upstream.url).getSelf('jwt-secret')).rejects.toMatchObject({
      code: 'network',
      message: '账号服务器响应传输中断',
      httpStatus: 200,
    });
    expect(upstream.requests).toHaveLength(1);
  });

  it.each([307, 308])('rejects HTTP %i without forwarding a credential POST', async (status) => {
    const upstream = await fixture((request, response) => {
      if (request.url === '/api/user/login') {
        response.writeHead(status, { Location: '/redirect-target' });
        response.end('password-secret');
      } else {
        response.end(selfBody);
      }
    });
    await expect(
      createNewApiClient(upstream.url).login({ username: 'user', password: 'password-secret' }),
    ).rejects.toMatchObject({ code: 'network', message: '无法连接账号服务器' });
    expect(upstream.requests).toEqual([{ method: 'POST', path: '/api/user/login' }]);
  });

  it.each([429, 500, 503])(
    'releases HTTP %i bodies without parsing or retrying',
    async (status) => {
      const upstream = await fixture((_request, response) => {
        response.writeHead(status);
        response.write('jwt-secret');
      });
      await expect(createNewApiClient(upstream.url).getSelf('jwt-secret')).rejects.toMatchObject({
        code: status === 429 ? 'network' : 'server',
        message:
          status === 429 ? '账号服务器请求过于频繁，请稍后再试' : `账号服务器错误（${status}）`,
        httpStatus: status,
      });
      await vi.waitFor(() => expect(upstream.closedResponses()).toBe(1));
      expect(upstream.requests).toHaveLength(1);
    },
  );

  it('bounds a stalled injected stream even when its cancel callback never settles', async () => {
    // Injected IO has no real network clock. Start it before deterministically crossing its deadline.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel })));
      const client = createNewApiClient('https://example.test', { fetchImpl, timeoutMs: 20 });
      const rejected = expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
        code: 'network',
        message: '连接账号服务器超时',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a late injected response when fetch ignores its abort signal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      let resolveFetch: (response: Response) => void = () => undefined;
      const fetchImpl = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const client = createNewApiClient('https://example.test', { fetchImpl, timeoutMs: 20 });
      const rejected = expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
        code: 'network',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      const cancel = vi.fn();
      resolveFetch(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    new Uint8Array([0xff]),
    encoder.encode('{"access_token":"jwt-secret"'),
    encoder.encode('null'),
    encoder.encode('[]'),
    encoder.encode('{"success":"true"}'),
    encoder.encode('{"message":{"access_token":"jwt-secret"}}'),
  ])('rejects malformed UTF-8 / JSON / envelope without exposing the body (%#)', async (body) => {
    const client = createNewApiClient('https://example.test', {
      fetchImpl: async () => new Response(body),
    });
    await expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
      code: 'server',
      message: '账号服务器响应无法解析',
    });
  });

  it('redacts stream failures and still uses the caller error factory', async () => {
    const createError = vi.fn((code, message, status) =>
      Object.assign(new Error(message), { code, httpStatus: status, mapped: true }),
    );
    const client = createNewApiClient('https://example.test', {
      createError,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('Bearer jwt-secret; password=password-secret'));
            },
          }),
        ),
    });
    await expect(client.getSelf('jwt-secret')).rejects.toMatchObject({
      code: 'network',
      message: '账号服务器响应传输中断',
      mapped: true,
    });
    expect(createError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['register', (client: NewApiClient) => client.register({ username: 'a', password: 'secret' })],
    ['login', (client: NewApiClient) => client.login({ username: 'a', password: 'secret' })],
    ['refresh', (client: NewApiClient) => client.refresh('refresh-secret')],
    ['getSelf', (client: NewApiClient) => client.getSelf('jwt-secret')],
    ['listUserModels', (client: NewApiClient) => client.listUserModels('jwt-secret')],
    ['createToken', (client: NewApiClient) => client.createToken('jwt-secret', { name: 'device' })],
    ['listTokens', (client: NewApiClient) => client.listTokens('jwt-secret')],
    ['fetchTokenKey', (client: NewApiClient) => client.fetchTokenKey('jwt-secret', 1)],
    ['redeem', (client: NewApiClient) => client.redeem('jwt-secret', 'redeem-secret')],
    ['getPricing', (client: NewApiClient) => client.getPricing()],
  ] as const)('does not echo untrusted failure messages from %s', async (_name, invoke) => {
    const client = createNewApiClient('https://example.test', {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ success: false, message: 'jwt-secret password-secret refresh-secret' }),
        ),
    });
    const error = await invoke(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret');
  });

  it('preserves registration conflict classification without echoing upstream details', async () => {
    const client = createNewApiClient('https://example.test', {
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: false, message: 'duplicate password-secret' })),
    });
    await expect(client.register({ username: 'a', password: 'secret' })).rejects.toMatchObject({
      code: 'conflict',
      message: '用户名已存在',
    });
  });

  it.each([0, -1, NaN, Infinity, 0.5, 2_147_483_648])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => createNewApiClient('https://example.test', { timeoutMs })).toThrow(
      '账号服务器超时配置无效',
    );
  });

  it.each([0, -1, NaN, Infinity, 0.5, 2 * 1024 * 1024 + 1])(
    'rejects invalid or expanded response limit %s',
    (maxResponseBytes) => {
      expect(() => createNewApiClient('https://example.test', { maxResponseBytes })).toThrow(
        '账号服务器响应大小配置无效',
      );
    },
  );
});
