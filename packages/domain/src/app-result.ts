export type AppErrorCode =
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'INVALID_ENUM'
  | 'INVALID_SCHEMA_VERSION'
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'STRING_TOO_LONG'
  | 'PROMPT_TOO_LONG'
  | 'TOO_MANY_ITEMS'
  | 'INVALID_RANGE'
  | 'DUPLICATE_KEY'
  | 'REFERENCE_EXISTS'
  | 'MISSING_REFERENCE'
  | 'INVALID_STATE'
  | 'AUTH_REQUIRED'
  | 'MODEL_UNSUPPORTED'
  | 'ACCOUNT_AUTH'
  | 'ACCOUNT_QUOTA'
  | 'ACCOUNT_MODEL_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'OUTPUT_SCHEMA_INVALID'
  | 'UNKNOWN';

export type AppErrorRecoveryAction =
  | 'retry'
  | 'edit-input'
  | 'shorten-input'
  | 'upgrade-app'
  | 'select-source'
  | 'configure-provider'
  | 'configure-ai'
  | 'relogin'
  | 'redeem'
  | 'refresh-models';

export interface AppError {
  code: AppErrorCode;
  message: string;
  fieldPath?: string;
  retryable: boolean;
  recoveryAction?: AppErrorRecoveryAction;
  details?: Record<string, unknown>;
}

export type AppResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

export function ok<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

export function fail(error: AppError): AppResult<never> {
  return { ok: false, error };
}

export function appError(
  code: AppErrorCode,
  message: string,
  options: Omit<AppError, 'code' | 'message' | 'retryable'> & { retryable?: boolean } = {},
): AppError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.fieldPath ? { fieldPath: options.fieldPath } : {}),
    ...(options.recoveryAction ? { recoveryAction: options.recoveryAction } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

export function fieldPathFromSegments(path: ReadonlyArray<PropertyKey>): string | undefined {
  const segments = path.filter((segment): segment is string | number => (
    typeof segment === 'string' || typeof segment === 'number'
  ));
  return segments.length > 0 ? segments.map(String).join('.') : undefined;
}
