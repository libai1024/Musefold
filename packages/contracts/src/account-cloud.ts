import { z } from 'zod';
import { entityIdSchema, isoDateTimeSchema } from './common';
import { accountIssuerSchema } from './account-identity';
import { generationRecoverySchema } from './generation';

/** Explicit account transport. Legacy managedBy metadata is not an execution binding. */
export const ACCOUNT_CLOUD_PROVIDER_TYPE = 'musefold-cloud' as const;
export const accountCloudStatusSchema = z
  .object({
    mode: z.enum(['blocked', 'not_enabled', 'active', 'query_only']),
    principalId: entityIdSchema.nullable(),
    apiIssuer: accountIssuerSchema.nullable(),
    connectionId: entityIdSchema.nullable(),
    reviewRef: z.string().uuid().nullable(),
    reviewAction: z.enum(['connect', 'resume']).nullable(),
    message: z.string().min(1).max(300),
  })
  .strict();
export const accountCloudReviewInputSchema = z.object({ reviewRef: z.string().uuid() }).strict();
export const accountCloudRecoveryItemSchema = z
  .object({
    requestId: entityIdSchema,
    localGenerationId: entityIdSchema.nullable(),
    createdAt: isoDateTimeSchema,
    recovery: generationRecoverySchema,
    canCancel: z.boolean(),
  })
  .strict();
export const accountCloudPageQuerySchema = z
  .object({ cursor: z.string().min(1).max(1024).optional() })
  .strict();
export const accountCloudRecoveryListSchema = z
  .object({
    items: z.array(accountCloudRecoveryItemSchema).max(20),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict();
/** Local diagnostic only: these records have no trusted mapping to the current cloud account. */
export const accountCloudLegacyItemSchema = z
  .object({
    requestId: entityIdSchema,
    createdAt: isoDateTimeSchema,
    kind: z.enum(['image', 'scheme', 'skill', 'other']),
    reason: z.enum(['unknown_cost', 'in_progress', 'unfinished_call']),
  })
  .strict();
export const accountCloudLegacyListSchema = z
  .object({
    items: z.array(accountCloudLegacyItemSchema).max(20),
    nextCursor: z.string().min(1).max(1024).nullable(),
  })
  .strict();
export const accountCloudReconcileInputSchema = z.object({ requestId: entityIdSchema }).strict();
export type AccountCloudStatus = z.infer<typeof accountCloudStatusSchema>;
export type AccountCloudReviewInput = z.infer<typeof accountCloudReviewInputSchema>;
export type AccountCloudRecoveryItem = z.infer<typeof accountCloudRecoveryItemSchema>;
export type AccountCloudRecoveryList = z.infer<typeof accountCloudRecoveryListSchema>;
export type AccountCloudLegacyList = z.infer<typeof accountCloudLegacyListSchema>;
export type AccountCloudPageQuery = z.infer<typeof accountCloudPageQuerySchema>;
export type AccountCloudReconcileInput = z.infer<typeof accountCloudReconcileInputSchema>;
