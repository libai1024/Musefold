import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalErrorBoundary } from '../GlobalErrorBoundary';

const { relaunch } = vi.hoisted(() => ({ relaunch: vi.fn() }));

vi.mock('../../../lib/ipc', () => ({
  default: { system: { relaunch } },
}));

const boundary = readFileSync('apps/desktop/src/components/layout/GlobalErrorBoundary.tsx', 'utf8');

function createBoundary() {
  const instance = new GlobalErrorBoundary({ children: null });
  instance.setState = ((patch: Partial<typeof instance.state>) => {
    instance.state = { ...instance.state, ...patch };
  }) as typeof instance.setState;
  return instance;
}

describe('fatal render error recovery', () => {
  beforeEach(() => {
    relaunch.mockReset();
  });

  it('offers a guarded app restart from the fallback screen', () => {
    expect(boundary).toContain('data-testid="fatal-error-restart"');
    expect(boundary).toContain('api.system.relaunch()');
    expect(boundary).toContain('disabled={this.state.restarting}');
    expect(boundary).toContain("this.state.restarting ? '正在重启' : '重启应用'");
    expect(boundary).toContain('无法自动重启，请完全退出 Musefold 后重新打开。');
  });

  it('locks repeated restart attempts while relaunching', async () => {
    let resolveRelaunch: (() => void) | undefined;
    relaunch.mockReturnValue(new Promise<void>((resolve) => {
      resolveRelaunch = resolve;
    }));
    const instance = createBoundary();
    const restartApp = (instance as unknown as { restartApp: () => Promise<void> }).restartApp;

    const firstAttempt = restartApp();
    await restartApp();

    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(instance.state.restarting).toBe(true);
    resolveRelaunch?.();
    await firstAttempt;
  });

  it('restores the action and explains manual recovery when relaunch fails', async () => {
    relaunch.mockRejectedValue(new Error('relaunch unavailable'));
    const instance = createBoundary();

    await (instance as unknown as { restartApp: () => Promise<void> }).restartApp();

    expect(instance.state.restarting).toBe(false);
    expect(instance.state.restartError).toBe('无法自动重启，请完全退出 Musefold 后重新打开。');
  });
});
