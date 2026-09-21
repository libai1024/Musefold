import { ownedInventoryPage } from './owned-inventory-page.js';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

export const PROCESS_TEST_KEY = 'process-runtime-encryption-key';
export const PROCESS_TEST_USER = 'process-runtime-owner';
export const PROCESS_TEST_API_ISSUER = 'http://127.0.0.1:8787';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4aQAAAAASUVORK5CYII=',
  'base64',
);

export async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** A parent-owned HTTP provider + minimal S3 server survives child worker crashes. */
export async function createProcessTestServer(listenHost = '127.0.0.1') {
  const calls = new Map<string, number>();
  const objects = new Map<string, Buffer>();
  const heldRuns = new Set<string>();
  const responses = new Map<string, ServerResponse>();
  let failDeletes = false;
  const finish = (response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(ownedInventoryPage(url, objects.keys()));
      return;
    }
    if (request.method === 'HEAD' && /^\/test-bucket\/?$/.test(url.pathname)) {
      response.writeHead(200).end();
      return;
    }
    if (url.pathname === '/v1/images/generations') {
      const payload = JSON.parse(bytes.toString()) as { prompt: string };
      calls.set(payload.prompt, (calls.get(payload.prompt) ?? 0) + 1);
      if (heldRuns.has(payload.prompt)) responses.set(payload.prompt, response);
      else finish(response);
      return;
    }
    const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\//, ''));
    if (request.method === 'PUT') {
      objects.set(key, bytes);
      response.writeHead(200, { ETag: '"fixture"' });
      response.end();
    } else if (request.method === 'POST' && url.searchParams.has('delete')) {
      if (failDeletes) {
        response.writeHead(503, { 'Content-Type': 'application/xml' });
        response.end('<Error><Code>ServiceUnavailable</Code></Error>');
        return;
      }
      for (const match of bytes.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) {
        objects.delete(match[1]);
      }
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, listenHost, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback TCP server');
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    objects,
    heldRuns,
    setFailDeletes(value: boolean) {
      failDeletes = value;
    },
    release(runId: string) {
      heldRuns.delete(runId);
      const response = responses.get(runId);
      if (response) finish(response);
      responses.delete(runId);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export class ProcessWorker {
  readonly child: ChildProcess;
  readonly messages: Array<Record<string, unknown>> = [];
  private output = '';
  private closed = false;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  constructor(databaseUrl: string, httpUrl: string, pauseAt = '') {
    this.child = fork(fileURLToPath(new URL('./process-worker.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        WORKER_PROCESS_TEST: '1',
        WORKER_PAUSE_AT: pauseAt,
        DATABASE_URL: databaseUrl,
        PUBLIC_BASE_URL: PROCESS_TEST_API_ISSUER,
        NEW_API_BASE_URL: httpUrl,
        S3_ENDPOINT: httpUrl,
        S3_BUCKET: 'test-bucket',
        CREDENTIAL_ENCRYPTION_KEY: PROCESS_TEST_KEY,
      },
    });
    this.child.on('message', (message: Record<string, unknown>) => this.messages.push(message));
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on('data', (chunk) => {
        this.output = `${this.output}${String(chunk)}`.slice(-6_000);
      });
    }
    this.exited = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('close', (code, signal) => {
        this.closed = true;
        resolve({ code, signal });
      });
    });
  }

  async wait(type: string, fields: Record<string, unknown> = {}) {
    let found: Record<string, unknown> | undefined;
    await waitUntil(() => {
      found = this.messages.find(
        (message) =>
          message.type === type &&
          Object.entries(fields).every(([key, value]) => message[key] === value),
      );
      if (!found && this.closed) throw new Error(`Worker exited before ${type}: ${this.output}`);
      return !!found;
    }, `worker ${type}`);
    return found;
  }

  send(type: string) {
    this.child.send({ type });
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.closed) this.child.kill(signal);
    await waitUntil(() => this.closed, `worker exit (${signal})`);
    return this.exited;
  }
}
