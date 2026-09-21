import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  ClientCommand,
  ClientSetup,
  ClientSnapshot,
} from '../../../packages/core/src/sync/__tests__/fixtures/two-device-client';

export class SyncDeviceProcess {
  readonly child = fork(
    fileURLToPath(
      new URL(
        '../../../packages/core/src/sync/__tests__/fixtures/two-device-client.ts',
        import.meta.url,
      ),
    ),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        MUSEFOLD_TWO_DEVICE_FIXTURE: '1',
      },
    },
  );
  private sequence = 0;
  private stderr = '';
  readonly closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    this.child.once('close', (code, signal) => resolve({ code, signal }));
  });
  constructor(readonly setup: ClientSetup) {
    this.child.stderr?.on('data', (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-4000);
    });
  }
  async start() {
    return this.request<ClientSnapshot>({ action: 'init', setup: this.setup });
  }
  async snapshot() {
    return this.request<ClientSnapshot>({ action: 'snapshot' });
  }
  async sync() {
    return this.request<ClientSnapshot>({ action: 'sync' });
  }
  request<T = unknown>(command: ClientCommand): Promise<T> {
    const sequence = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.child.off('message', receive);
        this.child.off('exit', exited);
        this.child.off('error', failed);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const exited = () => failed(new Error(`Sync fixture exited: ${this.stderr}`));
      const receive = (message: {
        sequence?: number;
        result: T;
        error?: string;
        code?: string;
      }) => {
        if (message.sequence !== sequence) return;
        cleanup();
        if (message.error) reject(Object.assign(new Error(message.error), { code: message.code }));
        else resolve(message.result);
      };
      const timer = setTimeout(
        () => failed(new Error(`Sync fixture request timeout (${command.action})`)),
        45000,
      );
      this.child.on('message', receive);
      this.child.once('exit', exited);
      this.child.once('error', failed);
      if (!this.child.connected) return exited();
      this.child.send({ sequence, command }, (error) => {
        if (error) failed(error);
      });
    });
  }
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 10000);
    try {
      await this.request({ action: 'close' });
      return await this.closed;
    } catch (error) {
      this.child.kill('SIGKILL');
      await this.closed;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async crash() {
    this.child.kill('SIGKILL');
    return this.closed;
  }
}
