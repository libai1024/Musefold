import type { ApiErrorCode } from '@musefold/contracts';

const DEFAULT_STATUS: Partial<Record<ApiErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_CREDENTIALS_INVALID: 401,
  AUTH_REGISTRATION_DISABLED: 403,
  OAUTH_INVALID_GRANT: 400,
  OAUTH_SCOPE_INSUFFICIENT: 403,
  ACCOUNT_QUOTA_INSUFFICIENT: 402,
  ACCOUNT_REDEEM_INVALID: 400,
  PROMPT_NOT_FOUND: 404,
  PROMPT_VERSION_CONFLICT: 409,
  SYNC_CURSOR_EXPIRED: 410,
  SYNC_MUTATION_CONFLICT: 409,
  WORKBENCH_SESSION_NOT_FOUND: 404,
  WORKBENCH_VERSION_CONFLICT: 409,
  GENERATION_NOT_FOUND: 404,
  GENERATION_ALREADY_TERMINAL: 409,
  GENERATION_IDEMPOTENCY_CONFLICT: 409,
  GENERATION_UPSTREAM_REJECTED: 502,
  GENERATION_UPSTREAM_UNKNOWN: 502,
  GENERATION_STORAGE_FAILED: 502,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 400,
  INTERNAL_ERROR: 500,
};

/** 业务错误统一走契约错误码;HTTP 状态与 retryable 有默认映射,可按需覆盖。 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status?: number,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? DEFAULT_STATUS[code] ?? 500;
  }
}

export function toErrorBody(error: AppError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      retryable: error.retryable,
      details: error.details,
    },
  };
}
