import { fork, type ChildProcess } from 'node:child_process';
import { createServer, request as requestHttp, type ClientRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

export const IDENTITY_PROCESS_KEY = 'synthetic-identity-process-encryption';
export const IDENTITY_PROCESS_AUTH_SECRET = 'synthetic-identity-process-auth-secret';

async function waitFor(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === 'string') throw new Error('Expected loopback port');
  return address.port;
}

/** Runs the production bin, with its own JS heap and PG pool. No test HTTP routes. */
export class IdentityApiProcess {
  readonly child: ChildProcess;
  readonly url: string;
  private output = '';
  private truncated = false;
  private closed = false;
  private readonly exited: Promise<void>;

  private constructor(input: {
    port: number;
    databaseUrl: string;
    apiIssuer: string;
    upstreamIssuer: string;
    name: string;
  }) {
    this.url = `http://127.0.0.1:${input.port}`;
    const database = new URL(input.databaseUrl);
    database.searchParams.set('application_name', input.name);
    this.child = fork(fileURLToPath(new URL('../../bin.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        PORT: String(input.port),
        PUBLIC_BASE_URL: input.apiIssuer,
        DATABASE_URL: database.toString(),
        BETTER_AUTH_SECRET: IDENTITY_PROCESS_AUTH_SECRET,
        CREDENTIAL_ENCRYPTION_KEY: IDENTITY_PROCESS_KEY,
        NEW_API_BASE_URL: input.upstreamIssuer,
        LEGACY_NEW_API_ISSUER: input.upstreamIssuer,
        S3_ENDPOINT: input.upstreamIssuer,
        S3_ACCESS_KEY_ID: 'synthetic-process-access',
        S3_SECRET_ACCESS_KEY: 'synthetic-process-secret',
      },
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        const joined = `${this.output}${chunk.toString()}`;
        if (joined.length > 32_768) this.truncated = true;
        this.output = joined.slice(-32_768);
      });
    }
    this.exited = new Promise((resolve) => {
      this.child.once('close', () => {
        this.closed = true;
        resolve();
      });
    });
  }

  static async start(input: {
    databaseUrl: string;
    apiIssuer: string;
    upstreamIssuer: string;
    name: string;
  }) {
    const api = new IdentityApiProcess({ ...input, port: await unusedLoopbackPort() });
    try {
      await waitFor(async () => {
        if (api.closed) throw new Error('Identity API exited before becoming ready');
        if (!api.output.includes('[api] listening')) return false;
        const response = await fetch(`${api.url}/healthz`, {
          signal: AbortSignal.timeout(1_000),
        }).catch(() => null);
        return response?.status === 200;
      }, 'production API bin');
      return api;
    } catch (error) {
      await api.stop();
      throw error;
    }
  }

  get pid() {
    if (!this.child.pid) throw new Error('Expected a real child PID');
    return this.child.pid;
  }

  containsOutput(value: string) {
    return this.output.includes(value);
  }

  get outputWasTruncated() {
    return this.truncated;
  }

  async crash() {
    if (this.closed || !this.child.kill('SIGKILL'))
      throw new Error('Could not kill the running identity API');
    await this.exited;
    return { code: this.child.exitCode, signal: this.child.signalCode };
  }

  async stop() {
    if (this.closed) return;
    this.child.kill('SIGTERM');
    const timeout = setTimeout(() => this.child.kill('SIGKILL'), 3_000);
    try {
      await this.exited;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * One fixed public issuer fronts independently selected API processes. Selection
 * is parent-owned state, never a request header or client-selected issuer.
 */
export async function startIdentityProxy() {
  let target: IdentityApiProcess | undefined;
  let dropLogin = false;
  let dropped = 0;
  let holdPush = false;
  const heldPushes: Array<{ release: () => void; released: boolean }> = [];
  const observations: Array<{
    method: string;
    path: string;
    pid: number;
    status: number;
    dropped: boolean;
    forwardedResponseBytes: number;
  }> = [];
  const active = new Set<ClientRequest>();
  const server = createServer((incoming, outgoing) => {
    const selected = target;
    if (!selected) {
      outgoing.writeHead(503).end();
      return;
    }
    const path = new URL(incoming.url ?? '/', 'http://proxy.invalid').pathname;
    const loseResponse =
      dropLogin && incoming.method === 'POST' && path === '/api/auth/sign-in/new-api';
    if (loseResponse) dropLogin = false;
    const holdResponse = holdPush && incoming.method === 'POST' && path === '/api/v1/sync/push';
    if (holdResponse) holdPush = false;
    const upstream = requestHttp(
      `${selected.url}${incoming.url ?? '/'}`,
      { method: incoming.method, headers: { ...incoming.headers, connection: 'close' } },
      (response) => {
        const observation = {
          method: incoming.method ?? 'GET',
          path,
          pid: selected.pid,
          status: response.statusCode ?? 500,
          dropped: loseResponse,
          forwardedResponseBytes: 0,
        };
        observations.push(observation);
        if (loseResponse) {
          // The API has committed and produced HTTP headers. Let it finish;
          // the client receives neither Set-Cookie nor the token body.
          dropped++;
          outgoing.destroy();
          response.resume();
          return;
        }
        if (holdResponse) {
          // Only synthetic sync responses are retained. The production API has
          // committed before this barrier; no auth header or token is exposed.
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > 2 * 1024 * 1024) {
              response.destroy();
              outgoing.destroy();
            } else chunks.push(chunk);
          });
          response.once('end', () => {
            const held = {
              released: false,
              release() {
                if (held.released) return;
                held.released = true;
                if (!outgoing.destroyed) {
                  outgoing.writeHead(response.statusCode ?? 500, response.headers);
                  observation.forwardedResponseBytes = bytes;
                  outgoing.end(Buffer.concat(chunks));
                }
                chunks.length = 0;
              },
            };
            heldPushes.push(held);
          });
          return;
        }
        outgoing.writeHead(response.statusCode ?? 500, response.headers);
        response.on('data', (chunk: Buffer) => {
          observation.forwardedResponseBytes += chunk.byteLength;
        });
        response.pipe(outgoing);
      },
    );
    active.add(upstream);
    upstream.once('close', () => active.delete(upstream));
    upstream.once('error', () => {
      if (!outgoing.destroyed && !outgoing.headersSent) outgoing.writeHead(502).end();
      else outgoing.destroy();
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected proxy loopback address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    select(api: IdentityApiProcess) {
      target = api;
    },
    dropNextLoginResponse() {
      dropLogin = true;
    },
    holdNextSyncPushResponse() {
      holdPush = true;
    },
    releaseSyncPushResponses() {
      for (const held of heldPushes) held.release();
    },
    get heldSyncPushResponses() {
      return heldPushes.map(({ released }) => ({ released }));
    },
    get dropped() {
      return dropped;
    },
    get observations() {
      return observations.map((value) => ({ ...value }));
    },
    async close() {
      for (const held of heldPushes) held.release();
      for (const request of active) request.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
