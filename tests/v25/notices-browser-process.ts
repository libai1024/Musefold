import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class NoticesBrowserProcess {
  private child = fork(
    fileURLToPath(
      new URL('../../apps/api/src/__tests__/fixtures/notices-browser-process.ts', import.meta.url),
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
        NOTICES_BROWSER_TEST: '1',
      },
    },
  );
  private closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
  private output = '';
  private sequence = 0;
  readonly ready = new Promise<{ baseUrl: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Notice fixture timeout: ${this.output}`)),
      120_000,
    );
    this.child.on('message', (message: { type?: string; result: { baseUrl: string } }) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(message.result);
      }
    });
    this.child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    void this.closed.then(() => {
      clearTimeout(timer);
      reject(new Error(`Notice fixture exited: ${this.output}`));
    });
  });
  constructor() {
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on('data', (chunk) => {
        this.output = (this.output + String(chunk)).slice(-4000);
      });
  }
  command(action: 'snapshot' | 'update' | 'fail') {
    const id = ++this.sequence;
    return new Promise<{ notices: number; logins: number; receipts: number }>((resolve, reject) => {
      const receive = (message: {
        id: number;
        result: Parameters<typeof resolve>[0];
        error?: string;
      }) => {
        if (message.id !== id) return;
        clearTimeout(timer);
        this.child.off('message', receive);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      };
      const timer = setTimeout(() => {
        this.child.off('message', receive);
        reject(new Error('Notice fixture command timed out'));
      }, 30_000);
      this.child.on('message', receive);
      this.child.send({ id, action });
    });
  }
  async dispose() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 30_000);
    try {
      await this.closed;
      if (this.child.exitCode !== 0) throw new Error('Notice fixture cleanup failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
