import { afterEach, expect, it, vi } from 'vitest';
import { MusefoldClient } from '../client';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('waitForGeneration 默认等待六分钟，覆盖 worker 侧五分钟生成上限', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/v1/generations/')) {
          return new Response(JSON.stringify({ jobId: 'job-1', status: 'running', assets: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        // /v1/events：挂起的 SSE 流，模拟任务长时间不产生终态事件。
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    const client = new MusefoldClient({ endpoint: 'http://127.0.0.1:0', token: 't' });
    const outcome = client.waitForGeneration('job-1').then(
      () => 'settled' as const,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(360_000 - 1);
    const state = await Promise.race([outcome.then(() => 'settled'), Promise.resolve('pending')]);
    expect(state).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toMatchObject({ code: 'TIMEOUT' });
  } finally {
    vi.useRealTimers();
  }
});
