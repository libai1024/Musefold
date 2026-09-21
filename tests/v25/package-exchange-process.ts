import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { startPackageExchangeApp } from '../../apps/api/src/__tests__/fixtures/package-exchange-app';
type Ready = { baseUrl: string; bytes: string };
type Snapshot = Awaited<
  ReturnType<Awaited<ReturnType<typeof startPackageExchangeApp>>['snapshot']>
>;

export class PackageExchangeProcess {
  private child = fork(
    fileURLToPath(
      new URL('../../apps/api/src/__tests__/fixtures/package-exchange-process.ts', import.meta.url),
    ),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOCKER_HOST: process.env.DOCKER_HOST,
        TESTCONTAINERS_HOST_OVERRIDE: process.env.TESTCONTAINERS_HOST_OVERRIDE,
        NODE_ENV: 'test',
        PACKAGE_EXCHANGE_TEST: '1',
      },
    },
  );
  private closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
  private output = '';
  private startup: Array<{ phase: string; elapsedMs: number }> = [];
  private sequence = 0;
  readonly ready = new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Package fixture timeout: ${JSON.stringify(this.startup)} ${this.output}`),
        ),
      120000,
    );
    this.child.on(
      'message',
      (message: { type?: string; result: Ready; phase?: string; elapsedMs?: number }) => {
        if (
          message.type === 'startup' &&
          typeof message.phase === 'string' &&
          typeof message.elapsedMs === 'number'
        )
          this.startup.push({ phase: message.phase, elapsedMs: message.elapsedMs });
        if (message.type === 'ready') {
          clearTimeout(timer);
          resolve(message.result);
        }
      },
    );
    this.child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    void this.closed.then(() => {
      clearTimeout(timer);
      reject(new Error(`Package fixture exited: ${this.output}`));
    });
  });
  constructor() {
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on('data', (chunk) => {
        this.output = (this.output + String(chunk)).slice(-6000);
      });
  }
  snapshot() {
    return this.request<Snapshot>('snapshot');
  }
  startupPhases() {
    return [...this.startup];
  }
  importSnapshot() {
    return this.request<
      Awaited<ReturnType<Awaited<ReturnType<typeof startPackageExchangeApp>>['importSnapshot']>>
    >('import-snapshot');
  }
  importDigest() {
    return this.request<
      Awaited<ReturnType<Awaited<ReturnType<typeof startPackageExchangeApp>>['importSnapshot']>>
    >('import-digest');
  }
  seedTrial(schemeId: string) {
    return this.request<null>('seed-trial', schemeId);
  }
  private request<T>(action: string, schemeId?: string) {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const receive = (message: { id?: number; result: T; error?: string }) => {
        if (message.id !== id) return;
        clearTimeout(timer);
        this.child.off('message', receive);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      };
      const timer = setTimeout(() => {
        this.child.off('message', receive);
        reject(new Error('Package snapshot timed out'));
      }, 30000);
      this.child.on('message', receive);
      this.child.send({ id, action, schemeId });
    });
  }
  async dispose() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 30000);
    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
    }
  }
}
