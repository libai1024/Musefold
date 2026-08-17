// electron/providers/retry.ts
// 指数退避重试 + AbortController 支持
// 详见 docs/05-image-generation.md §5

export interface RetryOptions {
  maxRetries: number; // 默认 3
  baseDelayMs: number; // 默认 1000
  maxDelayMs: number; // 默认 30000
  retryOnStatus: number[]; // 默认 [429, 500, 502, 503]
  /** 没有 HTTP 状态码、但符合网络错误特征时是否重试。 */
  retryNetworkErrors: boolean;
  /** 测试和特殊 Provider 可替换等待实现，生产默认使用 setTimeout。 */
  sleep: (ms: number) => Promise<void>;
  /** 退避抖动来源，生产默认使用 Math.random。 */
  random: () => number;
  /** 每次真正等待前通知 UI。attempt 从 1 开始，表示第几次重试。 */
  onRetry?: (progress: RetryProgress) => void;
}

export interface RetryProgress {
  phase: 'retrying';
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status?: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryOnStatus: [429, 500, 502, 503],
  retryNetworkErrors: true,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export class RateLimitError extends Error {
  readonly status = 429;

  constructor(public retryAfterMs?: number, message = 'Rate limited') {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** 解析 Retry-After 的秒数或 HTTP 日期格式。 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === 'AbortError' || e?.message === 'Cancelled';
}

function isNetworkError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const e = err as { status?: number; name?: string; message?: string; code?: string };
  if (e?.status !== undefined) return false;
  const message = `${e?.name ?? ''} ${e?.message ?? ''} ${e?.code ?? ''}`;
  return /fetch failed|network|APIConnectionError|connection error|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|timed out|socket|connection reset|connection refused/i.test(message);
}

function retryAfterFrom(err: unknown): number | undefined {
  const retryAfter = (err as { retryAfterMs?: unknown })?.retryAfterMs;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : undefined;
}

function cancelledError(): Error {
  const cancelled = new Error('Cancelled');
  cancelled.name = 'AbortError';
  return cancelled;
}

async function waitForDelay(ms: number, sleep: (delayMs: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(ms);
    return;
  }
  if (signal.aborted) throw cancelledError();

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(cancelledError());
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void sleep(ms).then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: Partial<RetryOptions> = {},
  signal?: AbortSignal
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw cancelledError();
    }

    try {
      return await fn(signal ?? new AbortController().signal);
    } catch (err) {
      lastError = err;
      if (signal?.aborted) {
        throw cancelledError();
      }

      const status = (err as { status?: number }).status;
      const shouldRetry =
        (status !== undefined && (opts.retryOnStatus.includes(status) || (status >= 500 && status < 600))) ||
        (status === undefined && opts.retryNetworkErrors && isNetworkError(err));

      if (!shouldRetry || attempt === opts.maxRetries) throw err;

      // 退避：优先尊重 Retry-After，否则指数退避 + 抖动
      const retryAfterMs = retryAfterFrom(err);
      let delay = retryAfterMs ?? Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
      // Retry-After 是服务端给出的明确窗口，不再额外加抖动；退避则增加 0-1s 抖动。
      if (retryAfterMs === undefined) delay += opts.random() * 1000;

      opts.onRetry?.({ phase: 'retrying', attempt: attempt + 1, maxRetries: opts.maxRetries, delayMs: delay, status });
      await waitForDelay(delay, opts.sleep, signal);
    }
  }
  throw lastError;
}
