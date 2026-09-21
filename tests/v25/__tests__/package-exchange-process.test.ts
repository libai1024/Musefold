import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackageExchangeProcess } from '../package-exchange-process';

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('node:child_process', () => ({ fork }));

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((_signal: string) => {
      child.signalCode = 'SIGTERM';
      child.emit('close');
      return true;
    }),
  });
  fork.mockReturnValue(child);
  return { child, service: new PackageExchangeProcess() };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('package fixture startup diagnostics', () => {
  it('records phases without confusing them with ready and returns an independent list', async () => {
    const { child, service } = fixture();
    child.emit('message', { type: 'startup', phase: 'postgres-start', elapsedMs: 3 });
    child.emit('message', { type: 'startup', phase: 'postgres-ready', elapsedMs: 55 });
    const expected = [
      { phase: 'postgres-start', elapsedMs: 3 },
      { phase: 'postgres-ready', elapsedMs: 55 },
    ];
    expect(service.startupPhases()).toEqual(expected);
    service.startupPhases().pop();
    expect(service.startupPhases()).toEqual(expected);
    const ready = { baseUrl: 'http://127.0.0.1:1234', bytes: 'synthetic' };
    child.emit('message', { type: 'ready', result: ready });
    await expect(service.ready).resolves.toEqual(ready);
    await service.dispose();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('keeps the original timeout and identifies the last observed phase', async () => {
    vi.useFakeTimers();
    const { child, service } = fixture();
    child.emit('message', { type: 'startup', phase: 'queue-migrate', elapsedMs: 1500 });
    const failure = expect(service.ready).rejects.toThrow(
      'Package fixture timeout: [{"phase":"queue-migrate","elapsedMs":1500}]',
    );
    await vi.advanceTimersByTimeAsync(120000);
    await failure;
    await service.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
