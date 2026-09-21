import { createServer, request as requestHttp } from 'node:http';

/** Parent-owned proxy can keep one real S3 list response in flight across worker death. */
export async function createHeldInventoryResponseProxy(target: string, headObjectKey?: string) {
  const upstream = new URL(target);
  const releases: Array<() => void> = [];
  let hold = true;
  const server = createServer((request, response) => {
    const outgoing = requestHttp(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (incoming) => {
        const matches = headObjectKey
          ? request.method === 'HEAD' &&
            decodeURIComponent(new URL(request.url ?? '/', 'http://owned.test').pathname).endsWith(
              `/${headObjectKey}`,
            )
          : request.method === 'GET' && request.url?.includes('list-type=2');
        if (hold && matches) {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          incoming.on('end', () =>
            releases.push(() => {
              response.writeHead(incoming.statusCode ?? 502, incoming.headers);
              response.end(Buffer.concat(chunks));
            }),
          );
        } else {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        }
      },
    );
    outgoing.on('error', () => response.destroy());
    request.on('error', () => outgoing.destroy());
    request.pipe(outgoing);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing inventory proxy');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    get held() {
      return releases.length;
    },
    release() {
      hold = false;
      for (const release of releases.splice(0)) release();
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
