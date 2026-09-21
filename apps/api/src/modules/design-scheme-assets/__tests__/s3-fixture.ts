import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { loadEnv } from '../../../env.js';
import { S3DesignSchemeAssetStorage } from '../storage.js';

/** Local S3 HTTP protocol fixture. Exercises the real AWS SDK without external credentials. */
export async function startS3Fixture(maxReadBytes?: number) {
  const objects = new Map<string, Buffer>();
  const contentTypes = new Map<string, string>();
  const modifiedAt = new Map<string, Date>();
  const writes: { path: string; contentType: string | undefined }[] = [];
  const state = {
    failPutAfterWrite: false,
    dropPutResponses: 0,
    failDelete: false,
    oversizedGet: false,
    oversizedStream: false,
  };
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const deleted: string[] = [];
  const droppedPuts: string[] = [];
  const barriers: Array<{ method: 'GET' | 'PUT' | 'DELETE'; keyHash: string; released: boolean }> =
    [];
  let nextHold: 'GET' | 'PUT' | 'DELETE' | undefined;
  let holdMinBytes = 0;
  let holdsRemaining = 0;
  const held = new Map<ServerResponse, () => void>();
  function respond(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    response: ServerResponse,
    send: () => void,
  ) {
    if (nextHold !== method || (objects.get(key)?.length ?? 0) < holdMinBytes) return send();
    if (--holdsRemaining === 0) nextHold = undefined;
    const barrier = { method, keyHash: hash(key), released: false };
    barriers.push(barrier);
    held.set(response, () => {
      barrier.released = true;
      if (!response.destroyed) send();
    });
    response.once('close', () => held.delete(response));
  }
  function releaseHolds() {
    nextHold = undefined;
    holdsRemaining = 0;
    for (const send of held.values()) send();
    held.clear();
  }
  const xmlEscape = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const xmlDecode = (value: string) =>
    value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (
      request.method === 'GET' &&
      /^\/test-scheme-assets\/?$/.test(pathname) &&
      url.searchParams.get('list-type') === '2'
    ) {
      // Bucket enumeration must not consume an armed object GET barrier.
      const prefix = url.searchParams.get('prefix') ?? '';
      const marker = url.searchParams.get('continuation-token') ?? '';
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('max-keys')) || 1000));
      const keys = [...objects.keys()]
        .filter((key) => key.startsWith(prefix) && key > marker)
        .sort();
      const page = keys.slice(0, limit);
      const more = keys.length > page.length;
      const contents = page
        .map((key) => {
          const bytes = objects.get(key) ?? Buffer.alloc(0);
          const etag = createHash('md5').update(bytes).digest('hex');
          const changed = modifiedAt.get(key) ?? new Date('2000-01-01T00:00:00.000Z');
          return `<Contents><Key>${xmlEscape(key)}</Key><LastModified>${changed.toISOString()}</LastModified><ETag>"${etag}"</ETag><Size>${bytes.length}</Size></Contents>`;
        })
        .join('');
      response
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${more}</IsTruncated><KeyCount>${page.length}</KeyCount>${more ? `<NextContinuationToken>${xmlEscape(page.at(-1) ?? '')}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`,
        );
      return;
    }
    if (request.method === 'HEAD' && /^\/test-scheme-assets\/?$/.test(pathname)) {
      response.writeHead(200).end();
      return;
    }
    const key = decodeURIComponent(pathname.replace(/^\/test-scheme-assets\//, ''));
    if (request.method === 'POST' && url.searchParams.has('delete')) {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      const keys = [
        ...Buffer.concat(parts)
          .toString()
          .matchAll(/<Key>([^<]+)<\/Key>/g),
      ].map((match) => xmlDecode(match[1]));
      // Batch DELETE is POST ?delete; the barrier precedes physical object removal.
      respond('DELETE', keys[0] ?? '', response, () => {
        for (const key of keys) {
          if (state.failDelete) continue;
          objects.delete(key);
          contentTypes.delete(key);
          modifiedAt.delete(key);
          deleted.push(hash(key));
        }
        // S3 can report per-object errors in a successful HTTP response.
        const errors = state.failDelete
          ? keys
              .map(
                (key) =>
                  `<Error><Key>${xmlEscape(key)}</Key><Code>AccessDenied</Code><Message>fixture-delete-denied</Message></Error>`,
              )
              .join('')
          : '';
        response
          .writeHead(200, { 'content-type': 'application/xml' })
          .end(
            `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${errors}</DeleteResult>`,
          );
      });
      return;
    }
    if (request.method === 'DELETE') {
      respond('DELETE', key, response, () => {
        if (state.failDelete) {
          response
            .writeHead(403, { 'content-type': 'application/xml' })
            .end('<Error><Code>AccessDenied</Code></Error>');
          return;
        }
        objects.delete(key);
        contentTypes.delete(key);
        modifiedAt.delete(key);
        deleted.push(hash(key));
        response.writeHead(204).end();
      });
      return;
    }
    if (request.method === 'PUT') {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      objects.set(key, Buffer.concat(parts));
      modifiedAt.set(key, new Date());
      contentTypes.set(key, request.headers['content-type'] ?? 'application/octet-stream');
      writes.push({ path: pathname, contentType: request.headers['content-type'] });
      // Drop the TCP response only after the complete object has been stored.
      // Infinity models a persistent outage; a finite count allows real SDK recovery.
      if (state.dropPutResponses > 0) {
        state.dropPutResponses -= 1;
        droppedPuts.push(hash(key));
        response.destroy();
        return;
      }
      respond('PUT', key, response, () => {
        response.writeHead(state.failPutAfterWrite ? 403 : 200, {
          'content-type': 'application/xml',
        });
        response.end(
          state.failPutAfterWrite
            ? '<Error><Code>AccessDenied</Code><Message>fixture-private-storage-detail</Message></Error>'
            : '',
        );
      });
      return;
    }
    if (request.method === 'GET' && objects.has(key)) {
      if (state.oversizedStream) {
        response.writeHead(200, { 'transfer-encoding': 'chunked' });
        response.write(Buffer.alloc(20 * 1024 * 1024 + 1));
        response.end();
        return;
      }

      if (state.oversizedGet) {
        response.writeHead(200, { 'content-length': 21 * 1024 * 1024 });
        response.end(Buffer.alloc(1));
        return;
      }
      const bytes = objects.get(key);
      const contentType = contentTypes.get(key) ?? 'application/octet-stream';
      respond('GET', key, response, () => {
        response.writeHead(200, {
          'content-type': contentType,
        });
        response.end(bytes);
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/xml' });
    response.end('<Error><Code>NoSuchKey</Code></Error>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const storage = new S3DesignSchemeAssetStorage(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'fixture-unused',
      BETTER_AUTH_SECRET: 'fixture-auth-secret',
      NEW_API_BASE_URL: 'http://127.0.0.1:1',
      CREDENTIAL_ENCRYPTION_KEY: 'fixture-encryption-key',
      S3_ENDPOINT: endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'test-scheme-assets',
      S3_ACCESS_KEY_ID: 'fixture-key',
      S3_SECRET_ACCESS_KEY: 'fixture-secret',
    }),
    maxReadBytes,
  );
  return {
    endpoint,
    storage,
    objects,
    writes,
    state,
    deleted,
    droppedPuts,
    barriers,
    holdNext(method: 'GET' | 'PUT' | 'DELETE', minBytes = 0, count = 1) {
      if (nextHold || held.size) throw new Error('An S3 barrier is already armed or held');
      if (!Number.isSafeInteger(count) || count < 1 || count > 2)
        throw new Error('S3 fixture supports one or two held responses');
      nextHold = method;
      holdMinBytes = minBytes;
      holdsRemaining = count;
    },
    releaseHolds,
    async close() {
      releaseHolds();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
