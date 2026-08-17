import { z } from 'zod';

export const entityIdSchema = z.string().trim().min(1).max(64);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const paginationCursorSchema = z.string().min(1).max(1024);

export const apiErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'ACCOUNT_INVALID_CREDENTIALS',
  'ACCOUNT_REGISTRATION_DISABLED',
  'ACCOUNT_QUOTA_EXHAUSTED',
  'PROMPT_NOT_FOUND',
  'PROMPT_VERSION_CONFLICT',
  'PROMPT_VALIDATION_FAILED',
  'GENERATION_NOT_FOUND',
  'GENERATION_INVALID_REQUEST',
  'GENERATION_UNAVAILABLE',
  'GENERATION_CANCELLED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().min(1).max(128).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
