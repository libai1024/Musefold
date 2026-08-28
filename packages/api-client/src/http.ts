import { type ApiErrorCode, apiErrorResponseSchema } from '@musefold/contracts';
import type { z } from 'zod';

export interface ApiClientConfig {
  /** apps/api 根地址,如 https://api.musefold.app(不含 /api/v1)。 */
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
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type QueryValue = string | number | boolean | string[] | null | undefined;

export class ApiHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

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
  }): Promise<z.output<S>> {
    const url = new URL(`${this.baseUrl}/api/v1${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        // null 走契约 wire 约定(字面量 'null'),见 contracts 各 query schema。
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      method: options.method,
      credentials: 'include',
      headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw await this.toError(response);
    }
    return options.response.parse(await response.json());
  }

  private async toError(response: Response): Promise<ApiRequestError> {
    const parsed = apiErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (parsed.success) {
      const { code, message, retryable, requestId } = parsed.data.error;
      return new ApiRequestError(code, message, response.status, retryable, requestId);
    }
    return new ApiRequestError(
      'INTERNAL_ERROR',
      `请求失败(HTTP ${response.status})`,
      response.status,
      response.status >= 500,
    );
  }
}
