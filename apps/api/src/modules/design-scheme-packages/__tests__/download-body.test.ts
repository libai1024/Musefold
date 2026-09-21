import { afterEach, expect, it, vi } from 'vitest';
import { packageDownloadBody } from '../download-body.js';

afterEach(() => vi.useRealTimers());

it('holds the lease under backpressure and releases exactly once after complete bytes', async () => {
  const release = vi.fn();
  const bytes = Uint8Array.from({ length: 256 * 1024 + 17 }, (_, i) => i % 251);
  const body = packageDownloadBody(bytes, release);
  const reader = body.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value?.byteLength).toBe(64 * 1024);
  expect(first.value?.buffer).not.toBe(bytes.buffer);
  expect(first.value?.buffer.byteLength).toBe(64 * 1024);
  expect(release).not.toHaveBeenCalled();
  const chunks = [first.value!];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  expect(release).toHaveBeenCalledOnce();
  await reader.cancel();
  expect(release).toHaveBeenCalledOnce();
});

it('releases on client cancellation and removes the later abort listener', async () => {
  const release = vi.fn();
  const abort = new AbortController();
  const body = packageDownloadBody(new Uint8Array(256 * 1024), release, abort.signal);
  await body.cancel();
  abort.abort();
  expect(release).toHaveBeenCalledOnce();
});

it('errors incomplete bytes and releases when an active or already-aborted request is cancelled', async () => {
  for (const alreadyAborted of [false, true]) {
    const release = vi.fn();
    const abort = new AbortController();
    if (alreadyAborted) abort.abort();
    const body = packageDownloadBody(new Uint8Array(256 * 1024), release, abort.signal);
    abort.abort();
    await expect(new Response(body).arrayBuffer()).rejects.toThrow('Package download interrupted');
    expect(release).toHaveBeenCalledOnce();
  }
});

it('releases an abandoned consumer after the idle timeout without returning a complete file', async () => {
  vi.useFakeTimers();
  const release = vi.fn();
  const body = packageDownloadBody(new Uint8Array(256 * 1024), release);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(release).toHaveBeenCalledOnce();
  await expect(new Response(body).arrayBuffer()).rejects.toThrow('Package download interrupted');
});

it('renews the idle deadline when the consumer makes progress', async () => {
  vi.useFakeTimers();
  const release = vi.fn();
  const reader = packageDownloadBody(new Uint8Array(512 * 1024), release).getReader();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(59_000);
  expect((await reader.read()).value?.byteLength).toBe(64 * 1024);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(release).not.toHaveBeenCalled();
  await reader.cancel();
  expect(release).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(release).toHaveBeenCalledOnce();
});
