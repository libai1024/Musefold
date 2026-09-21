import { z } from 'zod';
import { importDesignSchemeResultSchema, opaqueIdSchema } from './design-scheme';
import { designSchemePackageStageSchema } from './design-scheme-package-staging';

/** A cursor is an owner-scoped stage reference, never an authority or an offset. */
export const designSchemePackageRecoveryQuerySchema = z
  .object({
    cursor: opaqueIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Read-only projection of durable intent and execution. Continuation still reauthorizes on write. */
export const designSchemePackageRecoverySchema = z
  .object({
    stage: designSchemePackageStageSchema,
    createdAt: z.iso.datetime(),
    execution: z.enum(['not_started', 'running', 'retryable', 'completed']),
    receipt: importDesignSchemeResultSchema.nullable(),
    canContinue: z.boolean(),
    blockedReason: z
      .enum([
        'session_changed',
        'stage_unavailable',
        'upload_in_progress',
        'import_in_progress',
        'retry_limit',
        'incompatible_version',
        'confirmation_changed',
      ])
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.execution === 'completed') !== (value.receipt !== null))
      ctx.addIssue({ code: 'custom', message: 'Only completed imports have immutable receipts' });
    if (value.execution === 'completed') {
      if (value.stage.status !== 'imported' || value.canContinue || value.blockedReason !== null)
        ctx.addIssue({ code: 'custom', message: 'Completed imports are read-only' });
    } else if (
      value.stage.status === 'imported' ||
      value.canContinue !== (value.blockedReason === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Continuation must agree with durable import state',
      });
    }
    if (value.execution === 'running' && value.canContinue)
      ctx.addIssue({ code: 'custom', message: 'Running imports cannot be resumed concurrently' });
  });

export const designSchemePackageRecoveryPageSchema = z
  .object({
    items: z.array(designSchemePackageRecoverySchema).max(50),
    nextCursor: opaqueIdSchema.nullable(),
  })
  .strict();
export type DesignSchemePackageRecoveryQuery = z.infer<
  typeof designSchemePackageRecoveryQuerySchema
>;
export type DesignSchemePackageRecovery = z.infer<typeof designSchemePackageRecoverySchema>;
export type DesignSchemePackageRecoveryPage = z.infer<typeof designSchemePackageRecoveryPageSchema>;
