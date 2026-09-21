import { z } from 'zod';
import { opaqueIdSchema, sourceConfirmationSchema } from './design-scheme';

/** Server-side preparation contract; does not change the completed Agent create response. */
export const prepareGithubSchemeSourceInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    repositoryUrl: z.string().min(1).max(2048),
    requestedRef: z.string().min(1).max(200).optional(),
  })
  .strict();

export const schemeSourcePreparationStatusSchema = z.enum([
  'queued',
  'reading',
  'ready',
  'confirmed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]);

export const schemeSourcePreparationSchema = z
  .object({
    executionId: opaqueIdSchema,
    confirmationId: opaqueIdSchema,
    status: schemeSourcePreparationStatusSchema,
    source: sourceConfirmationSchema.nullable(),
    snapshotId: opaqueIdSchema.nullable(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.status === 'ready' || value.status === 'confirmed') &&
      (!value.source || !value.snapshotId || !value.contentHash)
    )
      ctx.addIssue({ code: 'custom', message: 'Prepared sources require frozen evidence' });
  });

export const decideSchemeSourcePreparationInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    confirmationId: opaqueIdSchema,
    decision: z.enum(['install', 'cancel']),
  })
  .strict();
