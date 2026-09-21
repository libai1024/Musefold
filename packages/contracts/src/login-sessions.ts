import { z } from 'zod';
import { isoDateTimeSchema } from './common';

export const loginSessionSelectionSchema = z
  .object({
    sessionRef: z.string().min(1).max(64),
    version: z.number().int().positive(),
  })
  .strict();

export const loginSessionViewSchema = loginSessionSelectionSchema
  .extend({
    current: z.boolean(),
    client: z.string().min(1).max(80),
    platform: z.string().min(1).max(40),
    createdAt: isoDateTimeSchema,
    lastInteractiveAt: isoDateTimeSchema.nullable(),
    lastSeenAt: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema,
    maskedIp: z.string().max(64),
  })
  .strict();

export const loginSessionPageSchema = z
  .object({
    items: z.array(loginSessionViewSchema).max(1000),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    required: z.number().int().nonnegative(),
    requiresReauthentication: z.boolean(),
  })
  .strict()
  .refine((page) => page.total === page.items.length, 'Incomplete session list');

export const loginCapacityReviewSchema = z
  .object({
    flowRef: z.string().uuid(),
    expiresAt: isoDateTimeSchema,
    sessions: loginSessionPageSchema,
  })
  .strict();

export const loginCapacityRequestSchema = z.object({ flowRef: z.string().uuid() }).strict();
const selectedSessionsSchema = z
  .array(loginSessionSelectionSchema)
  .max(1000)
  .refine(
    (items) => new Set(items.map((item) => item.sessionRef)).size === items.length,
    'Duplicate session',
  );
export const completeLoginCapacitySchema = loginCapacityRequestSchema
  .extend({
    operationId: z.string().uuid(),
    selected: selectedSessionsSchema,
  })
  .strict();

export const revokeLoginSessionsSchema = z
  .object({
    operationId: z.string().uuid(),
    selected: selectedSessionsSchema.refine((items) => items.length > 0, 'Select a session'),
    password: z.string().min(1).max(256).optional(),
    twoFactorCode: z.string().min(1).max(128).optional(),
  })
  .strict();
export const revokeLoginSessionsResultSchema = z
  .object({
    released: z.number().int().nonnegative(),
  })
  .strict();
export const loginReleaseStatusSchema = z
  .object({ pending: z.number().int().nonnegative() })
  .strict();

export type LoginSessionSelection = z.infer<typeof loginSessionSelectionSchema>;
export type LoginSessionView = z.infer<typeof loginSessionViewSchema>;
export type LoginSessionPage = z.infer<typeof loginSessionPageSchema>;
export type LoginCapacityReview = z.infer<typeof loginCapacityReviewSchema>;
export type LoginCapacityRequest = z.infer<typeof loginCapacityRequestSchema>;
export type CompleteLoginCapacity = z.infer<typeof completeLoginCapacitySchema>;
export type RevokeLoginSessions = z.infer<typeof revokeLoginSessionsSchema>;
export type RevokeLoginSessionsResult = z.infer<typeof revokeLoginSessionsResultSchema>;
export type LoginReleaseStatus = z.infer<typeof loginReleaseStatusSchema>;
