import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from '../index';
import { startHeadlessServe } from '../serve-runtime';

vi.mock('../serve-runtime', () => ({ startHeadlessServe: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it.each(['success', 'failure'])(
  'waits for %s shutdown, ignores repeated signals, and releases signal handlers',
  async (outcome) => {
    const before = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
    let finish: () => void = () => undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () =>
            outcome === 'success' ? resolve() : reject(new Error('owned stop failure'));
        }),
    );
    vi.mocked(startHeadlessServe).mockResolvedValue({
      port: 12345,
      token: 'synthetic',
      dataDir: 'owned',
      stop,
    });
    const io = { stdout: vi.fn(), stderr: vi.fn() };
    let finished = false;
    const run = runCli(['serve', '--data-dir', 'owned'], io).finally(() => {
      finished = true;
    });
    try {
      await vi.waitFor(() =>
        expect(process.listeners('SIGINT').length).toBe(before.SIGINT.length + 1),
      );
      const interrupt = process
        .listeners('SIGINT')
        .find((listener) => !before.SIGINT.includes(listener));
      const terminate = process
        .listeners('SIGTERM')
        .find((listener) => !before.SIGTERM.includes(listener));
      if (!interrupt || !terminate) throw new Error('Missing owned signal handlers');
      interrupt('SIGINT');
      interrupt('SIGINT');
      terminate('SIGTERM');
      expect(stop).toHaveBeenCalledTimes(1);
      expect(finished).toBe(false);
      expect(process.listeners('SIGINT')).toContain(interrupt);
      finish();
      const code = await run;
      if (outcome === 'success') expect(code).toBe(0);
      else expect(code).not.toBe(0);
      expect(process.listeners('SIGINT')).toEqual(before.SIGINT);
      expect(process.listeners('SIGTERM')).toEqual(before.SIGTERM);
    } finally {
      finish();
      await run;
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!before[signal].includes(listener)) process.off(signal, listener);
        }
      }
    }
  },
);
