import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Actual generation bin; no alternate task list, SQL qualifications or dispatch hooks. */
export class GenerationBrowserWorker {
  private readonly child: ChildProcess;
  private output = '';
  private terminal = false;
  private paused = false;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private readonly ready: Promise<void>;

  constructor(env: Record<string, string | undefined>) {
    this.child = fork(
      fileURLToPath(new URL('../../../../worker/src/bin.ts', import.meta.url)),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...env, PATH: process.env.PATH, NODE_ENV: 'production', WORKER_CONCURRENCY: '1' },
      },
    );
    this.exited = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('close', (code, signal) => {
        this.terminal = true;
        resolve({ code, signal });
      });
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Actual generation worker startup timed out')),
        20000,
      );
      const onOutput = (chunk: Buffer) => {
        this.output = `${this.output}${chunk}`.slice(-6000);
        if (this.output.includes('[worker] generation worker started')) {
          clearTimeout(timer);
          resolve();
        }
      };
      this.child.stdout?.on('data', onOutput);
      this.child.stderr?.on('data', onOutput);
      void this.exited.then(
        () => {
          clearTimeout(timer);
          reject(new Error('Actual generation worker exited before readiness'));
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async waitUntilReady() {
    await this.ready;
    if (this.output.includes('[worker] S3 bucket unavailable'))
      throw new Error('Actual worker could not access S3 bucket');
  }

  snapshot() {
    return { pid: this.child.pid, running: !this.terminal, entry: 'apps/worker/src/bin.ts' };
  }

  canReplace() {
    return this.terminal || this.paused;
  }

  signal(signal: 'SIGSTOP' | 'SIGCONT') {
    if (this.terminal) throw new Error('Cannot signal an exited generation worker');
    if (!this.child.kill(signal)) throw new Error('Could not signal owned generation worker');
    this.paused = signal === 'SIGSTOP';
  }

  async stop(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
    if (!this.terminal) {
      if (this.paused && signal === 'SIGTERM') this.signal('SIGCONT');
      this.child.kill(signal);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.child.kill('SIGKILL');
            reject(new Error('Actual generation worker did not stop cleanly'));
          }, 15000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
