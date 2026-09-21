import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, request as requestHttp } from 'node:http';
import { promisify } from 'node:util';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const execute = promisify(execFile);
// Same pinned distribution as the worker GC suites; each suite owns an empty container.
export const GC_STORAGE_IMAGE =
  'minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e';
export const GC_STORAGE_ACCESS_KEY = 'gc-fixture-owner';
export const GC_STORAGE_SECRET_KEY = 'synthetic-gc-storage-password';

async function docker(...args: string[]) {
  return (await execute('docker', args, { timeout: 60_000 })).stdout.trim();
}

async function waitFor(predicate: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Real MinIO container for service-boundary tests; the API child points at it directly. */
export async function createDisposableMinio() {
  const name = `musefold-api-gc-${randomUUID()}`;
  const bucket = 'gc-boundary';
  let client: S3Client | undefined;
  try {
    await docker(
      'create',
      '--name',
      name,
      '--label',
      'musefold.test=asset-gc-boundary',
      '-p',
      '127.0.0.1::9000',
      '-e',
      `MINIO_ROOT_USER=${GC_STORAGE_ACCESS_KEY}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${GC_STORAGE_SECRET_KEY}`,
      GC_STORAGE_IMAGE,
      'server',
      '/data',
    );
    await docker('start', name);
    const inspect = JSON.parse(await docker('inspect', name))[0];
    const endpoint = `http://127.0.0.1:${inspect.NetworkSettings.Ports['9000/tcp'][0].HostPort}`;
    await waitFor(async () => {
      try {
        return (
          await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })
        ).ok;
      } catch {
        return false;
      }
    }, 'disposable MinIO readiness');
    client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: GC_STORAGE_ACCESS_KEY, secretAccessKey: GC_STORAGE_SECRET_KEY },
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 5000 },
    });
    const initial = client;
    await waitFor(async () => {
      try {
        await initial.send(new CreateBucketCommand({ Bucket: bucket }));
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'XMinioServerNotInitialized') return false;
        if (error instanceof Error && error.name === 'BucketAlreadyOwnedByYou') return true;
        throw error;
      }
    }, 'disposable MinIO bucket creation');
    return {
      get client() {
        if (!client) throw new Error('Storage client is not initialized');
        return client;
      },
      bucket,
      endpoint,
      async close() {
        client?.destroy();
        await docker('rm', '--force', name);
      },
    };
  } catch (error) {
    client?.destroy();
    await docker('rm', '--force', name).catch(() => undefined);
    throw error;
  }
}

/**
 * Holds signed PUT requests before any byte reaches upstream, then replays them
 * verbatim on release. Fronts the real MinIO so the API child process performs a
 * genuine server-relayed PUT whose landing the test controls.
 */
export async function createDelayedPutProxy(target: string) {
  const upstream = new URL(target);
  const queue: Array<{ key: string; replay: () => void }> = [];
  const forwarded: string[] = [];
  let holding = true;
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
          if (request.method === 'PUT') forwarded.push(key);
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
    get held() {
      return queue.length;
    },
    /** Stop holding; buffered PUTs reach upstream in arrival order. */
    release() {
      holding = false;
      const pending = queue.splice(0);
      for (const entry of pending) entry.replay();
      return pending.length;
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
