import { createServer, request as requestHttp } from 'node:http';

/** Forwards the actual signed PUT, then withholds its successful response. */
export async function createLostStorageResponseProxy(target: string) {
  const upstream = new URL(target);
  const accepted: number[] = [];
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
        if (request.method === 'PUT' && incoming.statusCode === 200) {
          incoming.resume();
          incoming.on('end', () => {
            accepted.push(200);
          });
          // Leave the client response unresolved until its configured request timeout.
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
  if (!address || typeof address === 'string') throw new Error('Missing proxy listener');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    accepted,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/**
 * Holds signed PUT requests before any byte reaches upstream, then replays them
 * verbatim on release. Models a server-side relay that accepted the upload but
 * delivered it to object storage only after GC retired and deleted the key.
 * A finite dropResponses budget instead forwards immediately and withholds the
 * success response, driving the SDK default retry against the real overwrite.
 */
export async function createDelayedPutProxy(target: string) {
  const upstream = new URL(target);
  const queue: Array<{ key: string; replay: () => void }> = [];
  const forwarded: string[] = [];
  const dropped: string[] = [];
  let holding = true;
  let dropResponses = 0;
  const keyOf = (url: string | undefined) =>
    decodeURIComponent(new URL(url ?? '/', 'http://delayed.test').pathname).replace(
      /^\/[^/]+\//,
      '',
    );
  const server = createServer((request, response) => {
    const key = keyOf(request.url);
    const send = (body: Buffer[] | null) => {
      const outgoing = requestHttp(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (incoming) => {
          if (request.method === 'PUT') {
            forwarded.push(key);
            if (dropResponses > 0 && (incoming.statusCode ?? 500) < 300) {
              dropResponses -= 1;
              dropped.push(key);
              incoming.resume();
              // Leave the client response unresolved until its configured request timeout.
              return;
            }
          }
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      outgoing.on('error', () => response.destroy());
      if (body) {
        for (const chunk of body) outgoing.write(chunk);
        outgoing.end();
      } else {
        request.pipe(outgoing);
      }
    };
    if (request.method === 'PUT' && holding) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => queue.push({ key, replay: () => send(chunks) }));
      request.on('error', () => response.destroy());
      return;
    }
    request.on('error', () => response.destroy());
    send(null);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing delayed proxy listener');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    forwarded,
    dropped,
    get held() {
      return queue.length;
    },
    /** Keys whose complete PUT request is buffered and invisible to upstream. */
    get heldKeys() {
      return queue.map((entry) => entry.key);
    },
    /** Stop holding; buffered PUTs reach upstream in arrival order. */
    release() {
      holding = false;
      const pending = queue.splice(0);
      for (const entry of pending) entry.replay();
      return pending.length;
    },
    /** Withhold the success response of the next n forwarded PUTs (SDK retry probe). */
    dropNextResponses(count: number) {
      dropResponses += count;
    },
    async close() {
      holding = false;
      for (const entry of queue.splice(0)) entry.replay();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
