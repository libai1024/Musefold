import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { connectExchangeBrowser } from './package-exchange-browser';

async function upstream() {
  const requests: { path: string; method: string; cookie: string; body: string }[] = [];
  const held = new Set<ServerResponse>();
  let disconnected = 0;
  const bytes = Buffer.from([0, 255, 128, 65, 10]);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      path: req.url ?? '',
      method: req.method ?? '',
      cookie: req.headers.cookie ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
    });
    if (req.headers.origin) res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('access-control-allow-credentials', 'true');
    if (req.url === '/api/transport/hold') {
      held.add(res);
      res.on('close', () => {
        held.delete(res);
        disconnected++;
      });
      return;
    }
    if (req.url === '/api/transport/binary') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'x-synthetic-evidence': 'preserved',
      });
      res.end(bytes);
      return;
    }
    res.writeHead(req.url === '/api/transport/error' ? 409 : 201, {
      'content-type': 'application/json',
      'set-cookie': 'transport-fixture=synthetic; HttpOnly; SameSite=Lax; Path=/',
    });
    res.end(JSON.stringify({ accepted: req.url !== '/api/transport/error' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned upstream port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    held,
    bytes,
    get disconnected() {
      return disconnected;
    },
    async close() {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
async function startHeld(page: Page) {
  await page.evaluate(() => {
    const controller = new AbortController();
    const state = window as Window & { abortTransport?: () => void };
    state.abortTransport = () => controller.abort();
    // The expected AbortError is local to this intentionally cancelled request.
    void fetch('/api/transport/hold', {
      method: 'POST',
      body: 'accepted-once',
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    });
  });
}
async function closeRoutes(context: BrowserContext) {
  for (const page of context.pages()) await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
}

test('exchange transport preserves HTTP status, binary bytes and browser cookies', async ({
  page,
  context,
}) => {
  const service = await upstream();
  try {
    await connectExchangeBrowser(context, service.url);
    await page.goto('/settings');
    const first = await page.evaluate(async () => {
      const response = await fetch('/api/transport/create', {
        method: 'POST',
        body: 'exact-input',
      });
      return { status: response.status, body: await response.json() };
    });
    expect(first).toEqual({ status: 201, body: { accepted: true } });
    const binary = await page.evaluate(async () => {
      const response = await fetch('/api/transport/binary');
      return {
        status: response.status,
        header: response.headers.get('x-synthetic-evidence'),
        bytes: [...new Uint8Array(await response.arrayBuffer())],
      };
    });
    expect(binary).toEqual({ status: 206, header: 'preserved', bytes: [...service.bytes] });
    expect(createHash('sha256').update(Buffer.from(binary.bytes)).digest('hex')).toBe(
      createHash('sha256').update(service.bytes).digest('hex'),
    );
    expect(
      service.requests.find((request) => request.path === '/api/transport/binary')?.cookie,
    ).toContain('transport-fixture=synthetic');
    const error = await page.evaluate(async () => {
      const response = await fetch('/api/transport/error');
      return { status: response.status, body: await response.json() };
    });
    expect(error).toEqual({ status: 409, body: { accepted: false } });
    expect(service.requests.filter((request) => request.path === '/api/transport/create')).toEqual([
      expect.objectContaining({ method: 'POST', body: 'exact-input' }),
    ]);
  } finally {
    await closeRoutes(context);
    await service.close();
  }
});

for (const action of ['abort', 'navigate'] as const) {
  test(`exchange transport ${action} cancels the upstream connection without a late duplicate response`, async ({
    page,
    context,
  }) => {
    const service = await upstream();
    try {
      await connectExchangeBrowser(context, service.url);
      await page.goto('/settings');
      await startHeld(page);
      await expect.poll(() => service.held.size).toBe(1);
      if (action === 'abort')
        await page.evaluate(() =>
          (window as Window & { abortTransport?: () => void }).abortTransport?.(),
        );
      else await page.goto('about:blank');
      await expect.poll(() => service.disconnected, { timeout: 5000 }).toBe(1);
      expect(service.held.size).toBe(0);
      expect(service.requests.filter((request) => request.path === '/api/transport/hold')).toEqual([
        expect.objectContaining({ method: 'POST', body: 'accepted-once' }),
      ]);
    } finally {
      // Release only owned sockets even on an assertion failure; normal success needs no server release.
      await service.close();
      await closeRoutes(context);
    }
  });
}
