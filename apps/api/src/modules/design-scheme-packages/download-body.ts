const CHUNK_BYTES = 64 * 1024;
const IDLE_TIMEOUT_MS = 60_000;

/** Keep the admission lease until consumption/cancellation, retaining only bounded copied chunks. */
export function packageDownloadBody(bytes: Uint8Array, release: () => void, signal?: AbortSignal) {
  let payload: Uint8Array | undefined = bytes;
  let offset = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    if (finished) return;
    finished = true;
    payload = undefined;
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    release();
  };
  const aborted = () => {
    if (finished) return;
    finish();
    controller.error(new Error('Package download interrupted'));
  };
  const armIdleTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(aborted, IDLE_TIMEOUT_MS);
    timer.unref();
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      else armIdleTimeout();
    },
    pull(value) {
      if (!payload) return;
      if (offset === payload.byteLength) {
        finish();
        value.close();
        return;
      }
      const end = Math.min(offset + CHUNK_BYTES, payload.byteLength);
      // A subarray queued for a slow socket would retain the entire archive after release.
      const chunk = new Uint8Array(end - offset);
      chunk.set(payload.subarray(offset, end));
      offset = end;
      value.enqueue(chunk);
      armIdleTimeout();
    },
    cancel() {
      finish();
    },
  });
}
