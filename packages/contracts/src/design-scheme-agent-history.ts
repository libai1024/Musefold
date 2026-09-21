import { z } from 'zod';
import { opaqueIdSchema } from './design-scheme';
import { designSchemeAgentSessionSchema } from './design-scheme-agent';

export const designSchemeAgentHistoryQuerySchema = z
  .object({
    cursor: opaqueIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Discovery only: persisted status and deadline are not permission to resume or spend. */
export const designSchemeAgentHistoryRecordSchema = z
  .object({
    executionId: designSchemeAgentSessionSchema.shape.executionId,
    operation: designSchemeAgentSessionSchema.shape.operation,
    status: designSchemeAgentSessionSchema.shape.status,
    version: designSchemeAgentSessionSchema.shape.version,
    createdAt: designSchemeAgentSessionSchema.shape.createdAt,
    expiresAt: designSchemeAgentSessionSchema.shape.expiresAt,
    /** Target scheme for modify/update, or created scheme for a completed create. */
    schemeId: opaqueIdSchema.nullable(),
    /** Current owner-scoped name; null also covers deletion. Never expose the original brief. */
    schemeName: z.string().max(160).nullable(),
  })
  .strict();

export const designSchemeAgentHistoryPageSchema = z
  .object({
    items: z.array(designSchemeAgentHistoryRecordSchema).max(50),
    nextCursor: opaqueIdSchema.nullable(),
  })
  .strict();

export type DesignSchemeAgentHistoryQuery = z.infer<typeof designSchemeAgentHistoryQuerySchema>;
export type DesignSchemeAgentHistoryRecord = z.infer<typeof designSchemeAgentHistoryRecordSchema>;
export type DesignSchemeAgentHistoryPage = z.infer<typeof designSchemeAgentHistoryPageSchema>;
