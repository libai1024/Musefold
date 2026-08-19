import type { ApiErrorCode, ApiErrorResponse } from '@musefold/contracts';

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toErrorResponse(
  error: AppError,
  requestId: string,
): ApiErrorResponse {
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
