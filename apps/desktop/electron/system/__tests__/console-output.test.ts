import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  installConsoleOutputGuards,
  isBrokenPipeError,
  writeConsoleLine,
} from '../console-output';

class FakeOutputStream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
}

function brokenPipe(): NodeJS.ErrnoException {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
}

describe('console output', () => {
  it('recognizes EPIPE by its Node error code', () => {
    expect(isBrokenPipeError(brokenPipe())).toBe(true);
    expect(isBrokenPipeError(new Error('write EPIPE'))).toBe(false);
  });

  it('skips console mirroring when a packaged launch has no output stream', () => {
    const error = vi.fn();

    expect(() => installConsoleOutputGuards([undefined, null])).not.toThrow();
    writeConsoleLine('error', 'no stream', null, { error });

    expect(error).not.toHaveBeenCalled();
  });

  it('marks a stream unavailable after an asynchronous EPIPE', () => {
    const stream = new FakeOutputStream();
    const error = vi.fn();

    installConsoleOutputGuards([stream]);
    expect(() => stream.emit('error', brokenPipe())).not.toThrow();
    writeConsoleLine('error', 'after close', stream, { error });

    expect(error).not.toHaveBeenCalled();
  });

  it('swallows a synchronous EPIPE and disables later console writes', () => {
    const stream = new FakeOutputStream();
    const error = vi.fn(() => {
      throw brokenPipe();
    });

    writeConsoleLine('error', 'first write', stream, { error });
    writeConsoleLine('error', 'second write', stream, { error });

    expect(error).toHaveBeenCalledTimes(1);
  });

  it('does not hide unrelated console write failures', () => {
    const stream = new FakeOutputStream();
    const failure = Object.assign(new Error('bad descriptor'), { code: 'EBADF' });
    const error = vi.fn(() => {
      throw failure;
    });

    expect(() => writeConsoleLine('error', 'failed write', stream, { error })).toThrow(failure);
  });

  it('does not hide unrelated asynchronous stream failures', () => {
    const stream = new FakeOutputStream();
    const failure = Object.assign(new Error('bad descriptor'), { code: 'EBADF' });

    installConsoleOutputGuards([stream]);

    expect(() => stream.emit('error', failure)).toThrow(failure);
  });
});
