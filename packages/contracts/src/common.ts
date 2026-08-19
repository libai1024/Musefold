import { z } from 'zod';

export const entityIdSchema = z.string().trim().min(1).max(64);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const paginationCursorSchema = z.string().min(1).max(1024);

export const apiErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_CREDENTIALS_INVALID',
  'AUTH_REGISTRATION_DISABLED',
  'OAUTH_INVALID_GRANT',
  'OAUTH_SCOPE_INSUFFICIENT',
  'ACCOUNT_QUOTA_INSUFFICIENT',
  'ACCOUNT_REDEEM_INVALID',
  'PROMPT_NOT_FOUND',
  'PROMPT_VERSION_CONFLICT',
  'SYNC_CURSOR_EXPIRED',
  'SYNC_MUTATION_CONFLICT',
  'WORKBENCH_SESSION_NOT_FOUND',
  'WORKBENCH_VERSION_CONFLICT',
  'GENERATION_NOT_FOUND',
  'GENERATION_ALREADY_TERMINAL',
  'GENERATION_UPSTREAM_REJECTED',
  'GENERATION_UPSTREAM_UNKNOWN',
  'GENERATION_STORAGE_FAILED',
  'GENERATION_APPROVAL_REQUIRED',
  'GENERATION_APPROVAL_EXPIRED',
  'MCP_BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().min(1).max(128),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
