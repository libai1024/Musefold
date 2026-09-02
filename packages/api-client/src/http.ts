import { type ApiErrorCode, apiErrorCodeSchema, apiErrorResponseSchema } from '@musefold/contracts';
import { z } from 'zod';

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

const betterAuthErrorSchema = z.object({ code: z.string(), message: z.string() });

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
    headers?: Record<string, string>;
    /** 路径前缀,默认业务面 /api/v1;Better Auth 端点传 /api/auth。 */
    prefix?: '/api/v1' | '/api/auth';
  }): Promise<z.output<S>> {
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
    const response = await this.fetchImpl(url, {
      method: options.method,
      credentials: 'include',
      headers: {
        ...(options.body === undefined || isFormData ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body:
        options.body === undefined
          ? undefined
          : isFormData
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw await this.toError(response);
    }
    return options.response.parse(await response.json());
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
      return new ApiRequestError(
        code.success ? code.data : 'INTERNAL_ERROR',
        authError.data.message,
        response.status,
        response.status >= 500,
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
