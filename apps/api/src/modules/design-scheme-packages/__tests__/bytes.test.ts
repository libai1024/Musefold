import { expect, it } from 'vitest';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';
import { readPackageUpload } from '../bytes.js';
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}
it('counts actual chunked bytes without a content-length header', async () => {
  await expect(
    readPackageUpload(stream([Buffer.from('ab'), Buffer.from('cd')]), 4),
  ).resolves.toEqual(Buffer.from('abcd'));
});
it.each([3, 5])('rejects mismatch with the immutable declared length %i', async (size) => {
  await expect(readPackageUpload(stream([Buffer.from('abcd')]), size)).rejects.toThrow();
});
it('cancels an unfinished request on caller abort without buffering further chunks', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const result = readPackageUpload(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    4,
    controller.signal,
  );
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(cancelled).toBe(true);
});

it('snapshots only each view range when a stream producer reuses its backing storage', async () => {
  const backing = Buffer.from('!ab?');
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (reads++ === 0) controller.enqueue(backing.subarray(1, 3));
        else {
          backing.write('cd', 1);
          controller.enqueue(backing.subarray(1, 3));
          controller.close();
        }
      },
    },
    { highWaterMark: 0 },
  );
  const bytes = await readPackageUpload(body, 4);
  backing.fill(0);
  expect(bytes).toEqual(Buffer.from('abcd'));
  expect(body.locked).toBe(false);
});

it('never returns a partial buffer when cancelled after receiving valid initial bytes', async () => {
  let reads = 0;
  let cancelled = false;
  let notifyWaiting: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    notifyWaiting = resolve;
  });
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (reads++ === 0) controller.enqueue(Buffer.from('ab'));
        else notifyWaiting();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const result = readPackageUpload(body, 4, controller.signal);
  await waiting;
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

it('releases the reader and rejects when the connection fails after partial data', async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (reads++ === 0) controller.enqueue(Buffer.from('ab'));
        else controller.error(new Error('connection lost'));
      },
    },
    { highWaterMark: 0 },
  );
  await expect(readPackageUpload(body, 4)).rejects.toThrow('connection lost');
  expect(body.locked).toBe(false);
});

it.each([
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes + 1,
])('rejects invalid declared size %s before acquiring the stream reader', async (size) => {
  const body = stream([Buffer.from('abcd')]);
  await expect(readPackageUpload(body, size)).rejects.toThrow('方案包字节、大小、摘要或内容无效');
  expect(body.locked).toBe(false);
});
