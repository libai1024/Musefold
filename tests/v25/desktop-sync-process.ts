import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  DesktopSyncApp,
  DesktopSyncCloudSnapshot,
} from '../../apps/api/src/__tests__/fixtures/desktop-sync-app';

export class DesktopSyncProcess {
  private readonly child = fork(
    fileURLToPath(
      new URL('../../apps/api/src/__tests__/fixtures/desktop-sync-process.ts', import.meta.url),
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
        DESKTOP_SYNC_TEST: '1',
      },
    },
  );
  private readonly closed = new Promise<void>((resolve) =>
    this.child.once('close', () => resolve()),
  );
  private sequence = 0;
  private closedApi: unknown;
  readonly ready = new Promise<DesktopSyncApp['ready']>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Desktop sync fixture startup timed out')),
      120000,
    );
    this.child.on('message', (message: { type?: string; result: DesktopSyncApp['ready'] }) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(message.result);
      }
      if (message.type === 'closed') this.closedApi = message.result;
    });
    this.child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Desktop sync fixture failed to start'));
    });
    void this.closed.then(() => {
      clearTimeout(timer);
      reject(new Error('Desktop sync fixture exited before ready'));
    });
  });
  constructor() {
    // Drain output without putting upstream credentials into Playwright reports.
    this.child.stdout?.resume();
    this.child.stderr?.resume();
  }
  snapshot() {
    return this.request<DesktopSyncCloudSnapshot>('snapshot');
  }
  expireSession(owner: '42' | '43') {
    return this.request<{ expired: number }>('expire-session', owner);
  }
  holdPush() {
    return this.request<void>('hold-push');
  }
  releasePush() {
    return this.request<void>('release-push');
  }
  trimSyncHistory() {
    return this.request<Awaited<ReturnType<DesktopSyncApp['trimSyncHistory']>>>(
      'trim-sync-history',
    );
  }
  private request<T>(
    action: 'snapshot' | 'expire-session' | 'hold-push' | 'release-push' | 'trim-sync-history',
    owner?: '42' | '43',
  ) {
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
        reject(new Error('Desktop sync fixture command timed out'));
      }, 30000);
      this.child.on('message', receive);
      this.child.send({ id, action, owner });
    });
  }
  async dispose() {
    let forced = false;
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      forced = true;
      this.child.kill('SIGKILL');
    }, 30000);
    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
    }
    if (forced || this.child.exitCode !== 0)
      throw new Error('Desktop sync fixture did not exit cleanly');
    return { code: this.child.exitCode, signal: this.child.signalCode, api: this.closedApi };
  }
}
