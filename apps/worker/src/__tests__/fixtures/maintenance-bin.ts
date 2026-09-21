import { ownedInventoryPage } from './owned-inventory-page.js';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { waitUntil } from './process-runtime.js';

export async function maintenanceStorage() {
  const objects = new Set<string>();
  const deletions: string[] = [];
  const state = { failDeletes: false, deleteRequests: 0, unexpectedRequests: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(ownedInventoryPage(url, objects.keys()));
      return;
    }
    if (request.method === 'HEAD' && /^\/owned-maintenance\/?$/.test(url.pathname)) {
      response.writeHead(200).end();
      return;
    }
    if (request.method === 'POST' && url.searchParams.has('delete')) {
      state.deleteRequests++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (state.failDeletes) {
        response.writeHead(503, { 'Content-Type': 'application/xml' });
        response.end(
          '<Error><Code>ServiceUnavailable</Code><Message>Owned storage fault</Message></Error>',
        );
        return;
      }
      const keys = [
        ...Buffer.concat(chunks)
          .toString()
          .matchAll(/<Key>([^<]+)<\/Key>/g),
      ].map((match) => match[1]);
      for (const key of keys) {
        objects.delete(key);
        deletions.push(key);
      }
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(
        `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join('')}</DeleteResult>`,
      );
      return;
    }
    state.unexpectedRequests++;
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned S3 address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    objects,
    deletions,
    state,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/** Actual bin.ts and Graphile runner; no test task list, fake clock or injected task callbacks. */
export class MaintenanceBin {
  readonly child;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output = '';
  private closed = false;

  constructor(databaseUrl: string, httpUrl: string, paused: boolean) {
    this.child = fork(fileURLToPath(new URL('../../bin.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        PUBLIC_BASE_URL: 'https://owned-maintenance.example.test',
        NEW_API_BASE_URL: httpUrl,
        CREDENTIAL_ENCRYPTION_KEY: 'synthetic-maintenance-cipher-key',
        S3_ENDPOINT: httpUrl,
        S3_BUCKET: 'owned-maintenance',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'synthetic-maintenance-access',
        S3_SECRET_ACCESS_KEY: 'synthetic-maintenance-storage-secret',
        WORKER_CONCURRENCY: '1',
        MAINTENANCE_CLEANUP_PAUSED: String(paused),
      },
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on('data', (chunk) => {
        this.output += String(chunk);
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

  async ready() {
    await waitUntil(() => {
      if (this.closed) throw new Error('Owned maintenance bin exited before startup');
      return this.output.includes('[worker] generation worker started');
    }, 'owned maintenance production bin startup');
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.closed) this.child.kill(signal);
    await waitUntil(() => this.closed, 'owned maintenance bin shutdown');
    return this.exited;
  }

  stages() {
    return [...this.output.matchAll(/\[maintenance\] (\{[^\n]+\})/g)].map(
      (match) => JSON.parse(match[1]) as Record<string, string | number>,
    );
  }
}
