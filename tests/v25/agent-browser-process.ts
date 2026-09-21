import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { startAgentBrowserApp } from '../../apps/api/src/__tests__/fixtures/agent-browser-app';
type Ready = { baseUrl: string };
type Snapshot = Awaited<ReturnType<Awaited<ReturnType<typeof startAgentBrowserApp>>['snapshot']>>;

export class AgentBrowserProcess {
  private child = fork(
    fileURLToPath(
      new URL('../../apps/api/src/__tests__/fixtures/agent-browser-process.ts', import.meta.url),
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
        AGENT_BROWSER_TEST: '1',
      },
    },
  );
  private closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
  private output = '';
  private sequence = 0;
  readonly ready = new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Agent fixture timeout: ${this.output}`)),
      120000,
    );
    this.child.on('message', (message: { type?: string; result: Ready }) => {
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
      reject(new Error(`Agent fixture exited: ${this.output}`));
    });
  });
  constructor() {
    for (const stream of [this.child.stdout, this.child.stderr])
      stream?.on('data', (chunk) => {
        this.output = (this.output + String(chunk)).slice(-6000);
      });
  }
  basePackage() {
    return this.request<string>('base-package');
  }
  seedTrial(schemeId: string) {
    return this.request<null>('seed-trial', schemeId);
  }
  seedHistory(userId: string) {
    return this.request<
      Awaited<ReturnType<Awaited<ReturnType<typeof startAgentBrowserApp>>['seedHistory']>>
    >('seed-history', userId);
  }
  startGeneration(imageInput = false) {
    return this.request<
      Awaited<ReturnType<Awaited<ReturnType<typeof startAgentBrowserApp>>['startGeneration']>>
    >('start-generation', imageInput ? 'images' : undefined);
  }
  stopGeneration() {
    return this.request<
      Awaited<ReturnType<Awaited<ReturnType<typeof startAgentBrowserApp>>['stopGeneration']>>
    >('stop-generation');
  }
  imageMode(value: 'normal' | 'hold' | 'drop' | 'reject') {
    return this.request<null>('image-mode', value);
  }
  releaseImage() {
    return this.request<null>('release-image');
  }
  snapshot() {
    return this.request<Snapshot>('snapshot');
  }
  providerAuthorization() {
    return this.request<
      ReturnType<Awaited<ReturnType<typeof startAgentBrowserApp>>['providerAuthorizationSnapshot']>
    >('provider-authorization');
  }
  revokeUpstream() {
    return this.request<string[]>('revoke-upstream');
  }
  restoreUpstream() {
    return this.request<null>('restore-upstream');
  }
  requireImageInput() {
    return this.request<null>('require-image-input');
  }
  githubVersion(value: 'base' | 'changed' | 'next') {
    return this.request<null>('github-version', value);
  }
  mode(value: 'normal' | 'hold' | 'hold-compiler' | 'drop') {
    return this.request<null>('mode', value);
  }
  release() {
    return this.request<null>('release');
  }
  revoke() {
    return this.request<null>('revoke');
  }
  private request<T>(action: string, value?: string) {
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
        reject(new Error('Agent snapshot timed out'));
      }, 30000);
      this.child.on('message', receive);
      this.child.send({ id, action, value });
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
