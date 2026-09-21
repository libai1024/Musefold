import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Ready = { baseUrl: string; clients: Array<{ id: string; url: string }> };
export class OAuthBrowserProcess {
  private child = fork(
    fileURLToPath(
      new URL('../../apps/api/src/__tests__/fixtures/oauth-browser-process.ts', import.meta.url),
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
        OAUTH_BROWSER_TEST: '1',
      },
    },
  );
  private closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
  private output = '';
  private sequence = 0;
  readonly ready = new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OAuth fixture timeout: ${this.output}`)),
      120_000,
    );
    this.child.on('message', (m: { type?: string; result: Ready }) => {
      if (m.type === 'ready') {
        clearTimeout(timer);
        resolve(m.result);
      }
    });
    this.child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    void this.closed.then(() => {
      clearTimeout(timer);
      reject(new Error(`OAuth fixture exited: ${this.output}`));
    });
  });
  constructor() {
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on('data', (chunk) => {
        this.output = (this.output + String(chunk)).slice(-4000);
      });
  }
  snapshot() {
    const id = ++this.sequence;
    return new Promise<{
      clients: Array<{
        id: string;
        outcome: string;
        exchanges: number;
        mcpStatus: number | null;
        tools: string[];
      }>;
      consents: string[];
    }>((resolve, reject) => {
      const receive = (m: {
        id?: number;
        result: Parameters<typeof resolve>[0];
        error?: string;
      }) => {
        if (m.id !== id) return;
        clearTimeout(timer);
        this.child.off('message', receive);
        if (m.error) reject(new Error(m.error));
        else resolve(m.result);
      };
      const timer = setTimeout(() => {
        this.child.off('message', receive);
        reject(new Error('OAuth snapshot timeout'));
      }, 30_000);
      this.child.on('message', receive);
      this.child.send({ id, action: 'snapshot' });
    });
  }
  async dispose() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.closed;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 30_000);
    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
    }
  }
}
