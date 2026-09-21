import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadEnv } from '../../../env.js';
import { MAX_GENERATION_ASSET_BYTES } from '../asset-content.js';
import { S3AssetUrlSigner } from '../s3-signer.js';

export function barrier() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function startAssetS3Fixture(timeoutMs = 1000) {
  const state = {
    mode: 'valid' as
      | 'valid'
      | 'hold'
      | 'slow-headers'
      | 'large-header'
      | 'large-stream'
      | 'short-declared'
      | 'disconnect'
      | 'empty-missing'
      | 'xml-missing'
      | 'empty-success'
      | 'redirect'
      | 'forbidden',
    bytes: Buffer.from('fixture-output') as Buffer,
  };
  const requests: Array<{ method: string | undefined; path: string }> = [];
  let readBarrier = barrier();
  let closeBarrier = barrier();
  let release = barrier();
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      path: new URL(request.url ?? '/', 'http://fixture').pathname,
    });
    response.once('close', () => closeBarrier.resolve());
    readBarrier.resolve();
    if (state.mode === 'slow-headers') {
      await release.promise;
      return;
    }
    if (state.mode === 'empty-missing') {
      response.writeHead(404, { 'content-length': 0 });
      response.end();
      return;
    }
    if (state.mode === 'xml-missing') {
      response.writeHead(404, { 'content-type': 'application/xml' });
      response.end(
        '<Error><Code>NoSuchKey</Code><Message>private-endpoint-and-object-key</Message></Error>',
      );
      return;
    }
    if (state.mode === 'empty-success') {
      response.writeHead(200, { 'content-length': 0 });
      response.end();
      return;
    }
    if (state.mode === 'redirect') {
      response.writeHead(307, { location: '/redirect-target', 'content-length': 0 });
      response.end();
      return;
    }
    if (state.mode === 'forbidden') {
      response.writeHead(403, {
        'content-type': 'application/xml',
        'content-length': MAX_GENERATION_ASSET_BYTES + 1,
      });
      response.write('<Error>private-endpoint-and-object-key');
      await release.promise;
      return;
    }
    if (state.mode === 'large-header') {
      response.writeHead(200, { 'content-length': MAX_GENERATION_ASSET_BYTES + 1 });
      response.write('x');
      await release.promise;
      return;
    }
    if (state.mode === 'short-declared') {
      response.writeHead(200, { 'content-length': state.bytes.length + 1, connection: 'close' });
      response.end(state.bytes);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' });
    if (state.mode === 'large-stream') {
      response.end(Buffer.alloc(MAX_GENERATION_ASSET_BYTES + 1));
      return;
    }
    if (state.mode === 'disconnect') {
      response.write('partial');
      response.socket?.destroy();
      return;
    }
    if (state.mode === 'hold') {
      response.write(state.bytes.subarray(0, 1));
      await release.promise;
      if (!response.destroyed) response.end(state.bytes.subarray(1));
      return;
    }
    response.end(state.bytes);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'unused-synthetic',
    BETTER_AUTH_SECRET: 'synthetic-auth-secret',
    NEW_API_BASE_URL: 'https://generation-provider.test',
    CREDENTIAL_ENCRYPTION_KEY: 'synthetic-encryption-key',
    S3_ENDPOINT: endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test-generation-assets',
    S3_ACCESS_KEY_ID: 'synthetic-key',
    S3_SECRET_ACCESS_KEY: 'synthetic-secret',
  });
  return {
    state,
    requests,
    env,
    signer: new S3AssetUrlSigner(env, timeoutMs),
    get reached() {
      return readBarrier.promise;
    },
    get closed() {
      return closeBarrier.promise;
    },
    release() {
      release.resolve();
    },
    reset() {
      release.resolve();
      readBarrier = barrier();
      closeBarrier = barrier();
      release = barrier();
      requests.length = 0;
      state.mode = 'valid';
    },
    async close() {
      release.resolve();
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
