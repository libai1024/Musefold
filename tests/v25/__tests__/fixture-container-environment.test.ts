import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBrowserProcess } from '../agent-browser-process';
import { DesktopSyncProcess } from '../desktop-sync-process';
import { NoticesBrowserProcess } from '../notices-browser-process';
import { OAuthBrowserProcess } from '../oauth-browser-process';
import { PackageExchangeProcess } from '../package-exchange-process';
import { PackageRecoveryProcess } from '../package-recovery-process';

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('node:child_process', () => ({ fork }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe.each([
  ['Agent', AgentBrowserProcess],
  ['desktop sync', DesktopSyncProcess],
  ['notices', NoticesBrowserProcess],
  ['OAuth', OAuthBrowserProcess],
  ['package exchange', PackageExchangeProcess],
  ['package recovery', PackageRecoveryProcess],
] as const)('%s isolated container environment', (_name, Process) => {
  it.each([undefined, '192.0.2.10'])(
    'preserves an explicit Testcontainers host override (%s) without copying unrelated secrets',
    async (host) => {
      vi.stubEnv('TESTCONTAINERS_HOST_OVERRIDE', host);
      vi.stubEnv('MUSEFOLD_E2E_PASSWORD', 'synthetic-parent-only-password');
      const child = Object.assign(new EventEmitter(), {
        stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
        stderr: Object.assign(new EventEmitter(), { resume: vi.fn() }),
        exitCode: null as number | null,
        signalCode: null as string | null,
        kill: vi.fn(() => {
          child.exitCode = 0;
          child.emit('close');
          return true;
        }),
      });
      fork.mockReturnValue(child);
      const service = new Process();
      const ready = { baseUrl: 'http://127.0.0.1:1234', bytes: 'synthetic', clients: [] };
      child.emit('message', { type: 'ready', result: ready });
      try {
        await expect(service.ready).resolves.toEqual(ready);
        const environment = fork.mock.calls[0]?.[2]?.env;
        expect(environment.TESTCONTAINERS_HOST_OVERRIDE).toBe(host);
        expect(environment.NODE_ENV).toBe('test');
        expect(environment).not.toHaveProperty('MUSEFOLD_E2E_PASSWORD');
      } finally {
        await service.dispose();
      }
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    },
  );
});
