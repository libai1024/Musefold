import { describe, expect, it, vi } from 'vitest';
import { parseRetryAfter, RateLimitError, withRetry } from '../retry';

function errorWithStatus(status: number): Error & { status: number } {
  const error = new Error(`HTTP ${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

describe('provider retry policy', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT', 0)).toBe(3000);
    expect(parseRetryAfter('invalid', 0)).toBeUndefined();
  });

  it('uses the server Retry-After delay without adding jitter', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new RateLimitError(2000);
        return 'ok';
      },
      { sleep, random: () => 1 },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries three times for transient 5xx and then returns the final error', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw errorWithStatus(503);
    });

    await expect(withRetry(operation, { sleep, random: () => 0 })).rejects.toMatchObject({ status: 503 });
    expect(operation).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([1000, 2000, 4000]);
  });

  it('does not retry non-transient authorization errors', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw errorWithStatus(401);
    });

    await expect(withRetry(operation, { sleep })).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries recognized network failures', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new TypeError('fetch failed');
        return 'recovered';
      },
      { sleep, random: () => 0 },
    );

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('cancels immediately while waiting for the next retry', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      throw errorWithStatus(503);
    });
    const pending = withRetry(
      operation,
      { sleep: () => new Promise(() => {}), random: () => 0 },
      controller.signal,
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelled' });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
