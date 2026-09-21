import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiHttp } from '../http';

const body = z.object({ value: z.string() });
const ok = () => Response.json({ value: 'original-result' });
const limited = (retryAfter?: string) =>
  Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: '稍后再试',
        retryable: true,
        requestId: 'limited-read',
      },
    },
    { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
  );
const read = (http: ApiHttp, signal?: AbortSignal, path = '/design-schemes/runs/original') =>
  http.request({ method: 'GET', path, response: body, signal });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('backs off a limited read without replacing its URL, cursor or credentials', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(limited())
    .mockResolvedValueOnce(ok());
  const http = new ApiHttp({ baseUrl: 'https://api.test', fetch });
  const pending = read(http, undefined, '/design-schemes/runs/original/events?afterSeq=17');
  const settled = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(29_999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await settled).toEqual({ value: { value: 'original-result' } });
  expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
});

it('shares cooldown with other reads, but does not delay explicit cancellation or logout', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(limited('4'))
    .mockImplementation(async () => ok());
  const http = new ApiHttp({ baseUrl: '', fetch });
  const first = read(http).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(0);
  const second = read(http, undefined, '/account/status');
  const cancel = http.request({
    method: 'POST',
    path: '/design-schemes/cancel',
    body: { executionId: 'original' },
    response: body,
  });
  await expect(cancel).resolves.toEqual({ value: 'original-result' });
  await vi.advanceTimersByTimeAsync(3999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect(first).resolves.toEqual({ value: 'original-result' });
  await expect(second).resolves.toEqual({ value: 'original-result' });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it.each(['POST', 'PATCH', 'PUT', 'DELETE'] as const)(
  'never automatically retries a limited %s',
  async (method) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(limited());
    const http = new ApiHttp({ baseUrl: '', fetch });
    await expect(
      http.request({ method, path: '/generations', body: { id: 'paid-intent' }, response: body }),
    ).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it('stops after three read retries instead of polling a permanently limited service forever', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => limited());
  const http = new ApiHttp({ baseUrl: '', fetch });
  const result = read(http).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(209_999);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('honors HTTP-date Retry-After and supports cancellation while waiting', async () => {
  vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(limited('Mon, 21 Sep 2026 00:00:05 GMT'))
    .mockResolvedValueOnce(ok());
  const http = new ApiHttp({ baseUrl: '', fetch });
  const controller = new AbortController();
  const pending = read(http, controller.signal).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).toHaveBeenCalledOnce();
  controller.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([401, 403, 404, 503])('does not conceal or retry an HTTP %s error', async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({}, { status }));
  await expect(read(new ApiHttp({ baseUrl: '', fetch }))).rejects.toMatchObject({ status });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not turn a long server cooldown into an early retry or an unbounded pending request', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => limited('3600'));
  const http = new ApiHttp({ baseUrl: '', fetch });
  const pending = read(http).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(await pending).toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not shorten an overflowing Retry-After value to the default delay', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => limited('9'.repeat(400)));
  const pending = read(new ApiHttp({ baseUrl: '', fetch })).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(await pending).toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledOnce();
});

it('honors a contract retryAfterSeconds hint when the upstream supplied no header', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: '稍后再试',
            requestId: 'limited-read',
            retryable: true,
            details: { retryAfterSeconds: 3 },
          },
        },
        { status: 429 },
      ),
    )
    .mockResolvedValueOnce(ok());
  const pending = read(new ApiHttp({ baseUrl: '', fetch }));
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual({ value: 'original-result' });
});

it('rejects revoked authorization after backoff instead of trusting the previous login', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(limited('1'))
    .mockResolvedValueOnce(Response.json({}, { status: 401 }));
  const pending = read(new ApiHttp({ baseUrl: '', fetch })).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ status: 401 });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries only the binary GET before consuming bytes, never synthesizing an archive', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(limited('1'))
    .mockResolvedValueOnce(
      new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
      }),
    );
  const http = new ApiHttp({ baseUrl: '', fetch });
  const pending = http.downloadBytes('/original/content', 3).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual(bytes);
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
});
