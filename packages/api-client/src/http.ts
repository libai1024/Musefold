import { type ApiErrorCode, apiErrorCodeSchema, apiErrorResponseSchema } from '@musefold/contracts';
import { z } from 'zod';
import { loginCapacityReviewSchema } from '@musefold/contracts';

export interface ApiClientConfig {
  /**
   * apps/api 根地址(不含 /api/v1)。空串表示同源相对路径
   * (浏览器环境,由宿主反代路由到 API,cookie 天然同站)。
   */
  baseUrl: string;
  /** 注入 fetch 便于测试与 SSR;默认 globalThis.fetch。 */
  fetch?: typeof globalThis.fetch;
}

/** API 业务错误(契约错误码);网络层错误抛 TypeError 原样透出。 */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type QueryValue = string | number | boolean | string[] | null | undefined;

const betterAuthErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export class ApiHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  // A cooldown is transport pressure, never cached identity/authorization or response data.
  private readCooldown: { until: number; error: ApiRequestError } | undefined;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<S extends z.ZodType>(options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    response: S;
    query?: Record<string, QueryValue>;
    body?: unknown;
    /** Raw upload bytes; mutually exclusive with JSON or multipart body. */
    binaryBody?: Uint8Array;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** Explicit search workflows surface their domain limit for a user-driven retry. */
    retryRateLimit?: boolean;
    /** 路径前缀,默认业务面 /api/v1;Better Auth 端点传 /api/auth。 */
    prefix?: '/api/v1' | '/api/auth';
  }): Promise<z.output<S>> {
    if (options.binaryBody !== undefined && options.body !== undefined)
      throw new Error('Binary and JSON bodies cannot be combined');
    const target = `${this.baseUrl}${options.prefix ?? '/api/v1'}${options.path}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) search.append(key, item);
      } else {
        // null 走契约 wire 约定(字面量 'null'),见 contracts 各 query schema。
        search.set(key, String(value));
      }
    }
    // 字符串拼接而非 new URL():baseUrl 为空时保持相对路径形态。
    const url = search.size > 0 ? `${target}?${search.toString()}` : target;

    // FormData 直传(参考图上传等 multipart 场景),content-type 由 fetch 自带 boundary。
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const response = await this.fetchResponse(
      url,
      {
        method: options.method,
        credentials: 'include',
        headers: {
          ...(options.body === undefined || isFormData
            ? {}
            : { 'content-type': 'application/json' }),
          ...(options.binaryBody !== undefined
            ? { 'content-type': 'application/octet-stream' }
            : {}),
          ...options.headers,
        },
        signal: options.signal,
        body:
          options.binaryBody !== undefined
            ? // A binary Blob keeps large archives on the browser's binary upload path.
              // It also snapshots the selected view without including its surrounding buffer.
              new Blob([options.binaryBody as Uint8Array<ArrayBuffer>])
            : options.body === undefined
              ? undefined
              : isFormData
                ? (options.body as FormData)
                : JSON.stringify(options.body),
      },
      options.retryRateLimit !== false,
    );

    if (!response.ok) {
      throw await this.toError(response);
    }
    return options.response.parse(response.status === 204 ? undefined : await response.json());
  }

  /** Read an exact, bounded binary response from our API; never follow a download redirect. */
  async downloadBytes(
    path: string,
    expectedSize: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1)
      throw new Error('Invalid download size');
    const response = await this.fetchResponse(`${this.baseUrl}/api/v1${path}`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      signal,
    });
    if (!response.ok) throw await this.toError(response);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing download body');
    try {
      const length = response.headers.get('content-length');
      if (
        response.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream' ||
        (length !== null && Number(length) !== expectedSize)
      )
        throw new Error('Unexpected download metadata');
      const bytes = new Uint8Array(expectedSize);
      let offset = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (offset + part.value.length > expectedSize)
          throw new Error('Download exceeds expected size');
        bytes.set(part.value, offset);
        offset += part.value.length;
      }
      if (offset !== expectedSize) throw new Error('Incomplete download');
      if (signal?.aborted) throw new Error('Download cancelled');
      return bytes;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async fetchResponse(
    url: string,
    init: RequestInit,
    retryRateLimit = true,
  ): Promise<Response> {
    const isRead = init.method === 'GET';
    const deadline = Date.now() + 300_000;
    for (let attempt = 0; ; attempt++) {
      // Other queries on the same gateway must not keep hammering during a known cooldown.
      // Explicit writes (especially stop/logout) are never queued or automatically replayed.
      while (isRead && this.readCooldown && this.readCooldown.until > Date.now()) {
        if (this.readCooldown.until > deadline) throw this.readCooldown.error;
        await waitForReadRetry(this.readCooldown.until - Date.now(), init.signal);
      }
      init.signal?.throwIfAborted();
      const response = await this.fetchImpl(url, init);
      if (response.status !== 429) return response;
      const error = await this.toError(response);
      if (!retryRateLimit) throw error;
      const until = Date.now() + rateLimitDelay(response, error.details, attempt);
      if (!this.readCooldown || until > this.readCooldown.until)
        this.readCooldown = { until, error };
      if (!isRead || attempt >= 3 || this.readCooldown.until > deadline) throw error;
      // Retry only this exact GET. An accepted generation/Agent POST never runs again here.
    }
  }

  private async toError(response: Response): Promise<ApiRequestError> {
    const body = await response.json().catch(() => undefined);
    const parsed = apiErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, retryable, requestId, details } = parsed.data.error;
      return new ApiRequestError(code, message, response.status, retryable, requestId, details);
    }
    // Better Auth 端点(/api/auth)的错误是顶层 { code, message },不走契约信封。
    const authError = betterAuthErrorSchema.safeParse(body);
    if (authError.success) {
      const code = apiErrorCodeSchema.safeParse(authError.data.code);
      const review = z
        .object({ review: loginCapacityReviewSchema })
        .safeParse(authError.data.details);
      return new ApiRequestError(
        code.success ? code.data : 'INTERNAL_ERROR',
        authError.data.message,
        response.status,
        response.status >= 500,
        undefined,
        code.success && code.data === 'AUTH_SESSION_LIMIT' && review.success
          ? { review: review.data.review }
          : {},
      );
    }
    return new ApiRequestError(
      'INTERNAL_ERROR',
      `请求失败(HTTP ${response.status})`,
      response.status,
      response.status >= 500,
    );
  }
}

function rateLimitDelay(response: Response, details: Record<string, unknown>, attempt: number) {
  const header = response.headers.get('retry-after')?.trim();
  const milliseconds = header
    ? /^\d+$/.test(header)
      ? Number(header) * 1000
      : header.includes(',')
        ? Date.parse(header) - Date.now()
        : Number.NaN
    : Number.NaN;
  const seconds = details.retryAfterSeconds;
  const hinted = !Number.isNaN(milliseconds)
    ? milliseconds
    : typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Number.NaN;
  // Missing upstream hints use bounded exponential backoff, not the ordinary polling cadence.
  return Math.max(1000, !Number.isNaN(hinted) ? hinted : Math.min(120_000, 30_000 * 2 ** attempt));
}

function waitForReadRetry(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
