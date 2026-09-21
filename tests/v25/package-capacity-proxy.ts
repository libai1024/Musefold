import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';

/** Stream through the real Next rewrite; Playwright route.fetch serializes giant bodies. */
export async function startCapacityProxy(baseUrl: string) {
  const build = JSON.parse(await readFile('apps/web-next/.next/routes-manifest.json', 'utf8'));
  const rewrites = Array.isArray(build.rewrites)
    ? build.rewrites
    : Object.values(build.rewrites).flat();
  if (
    !rewrites.some(
      (route: { source: string; destination: string }) =>
        route.source === '/api/:path*' && route.destination === 'http://127.0.0.1:8787/api/:path*',
    )
  )
    throw new Error(
      'Capacity test requires the local standalone API rewrite; refusing an external target',
    );
  const upstream = new URL(baseUrl);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1')
    throw new Error('Capacity proxy requires a local isolated API');
  const transfers: Array<{ path: string; method: string; bytes: number; status: number }> = [];
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? '/';
    if (!path.startsWith('/api/')) {
      outgoing.writeHead(404).end();
      return;
    }
    const transfer = { path, method: incoming.method ?? 'GET', bytes: 0, status: 0 };
    transfers.push(transfer);
    const forwarded = request(
      new URL(path, upstream),
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        transfer.status = response.statusCode ?? 502;
        outgoing.writeHead(transfer.status, response.headers);
        response.pipe(outgoing);
      },
    );
    incoming.on('data', (chunk: Buffer) => {
      transfer.bytes += chunk.length;
    });
    incoming.on('aborted', () => forwarded.destroy());
    outgoing.on('close', () => {
      if (!outgoing.writableFinished) forwarded.destroy();
    });
    forwarded.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(forwarded);
  });
  // The normal test standalone build rewrites to this local port. Never reuse or stop
  // another listener: EADDRINUSE fails this fixture instead of touching a user's API.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(8787, '127.0.0.1', resolve);
  });
  return {
    transfers,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
