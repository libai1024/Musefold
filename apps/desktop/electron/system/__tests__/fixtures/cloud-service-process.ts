import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface JointServerInfo {
  baseUrl: string;
  owners: string[];
  png: string;
  pngs: string[];
}
/** Test IPC orchestration only. Desktop production never imports API, PG or worker packages. */
export class CloudServiceProcess {
  readonly child: ChildProcess;
  readonly ready: Promise<JointServerInfo>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private sequence = 0;
  private output = '';
  private ended = false;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.child = fork(
      fileURLToPath(
        new URL(
          '../../../../../api/src/__tests__/fixtures/desktop-cloud-service-process.ts',
          import.meta.url,
        ),
      ),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_HOST: process.env.DOCKER_HOST,
          NODE_ENV: 'test',
          DESKTOP_CLOUD_JOINT_TEST: '1',
        },
      },
    );
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on('data', (chunk) => {
        this.output = (this.output + String(chunk)).slice(-8000);
      });
    this.closed = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        this.ended = true;
        for (const task of this.pending.values()) {
          clearTimeout(task.timer);
          task.reject(new Error(`Joint service closed: ${this.output}`));
        }
        this.pending.clear();
        resolve({ code, signal });
      }),
    );
    this.child.on('message', (message: { id?: number; result?: unknown; error?: string }) => {
      if (message.id === undefined) return;
      const task = this.pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Joint service ready timeout: ${this.output}`)),
        120000,
      );
      this.child.on('message', (message: { type?: string; result: JointServerInfo }) => {
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
        reject(new Error(`Joint service exited: ${this.output}`));
      });
    });
  }
  request<T = void>(action: string, value?: Record<string, unknown>): Promise<T> {
    if (this.ended) return Promise.reject(new Error(`Joint service stopped: ${this.output}`));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Joint service ${action} timeout: ${this.output}`));
      }, 30000);
      this.pending.set(id, { resolve: (result) => resolve(result as T), reject, timer });
      this.child.send({ id, action, value });
    });
  }
  async stop() {
    if (!this.ended) await this.request('stop');
    const result = await this.closed;
    if (result.code !== 0) throw new Error(`Joint service cleanup failed: ${this.output}`);
  }
}
