import { z } from 'zod';
import { executionBindingSchema } from './account-identity';
import { entityIdSchema, isoDateTimeSchema } from './common';
import { generationStatusSchema, generationIdempotencyKeySchema } from './generation';

export const generationReceiptOperationSchema = z.enum([
  'ordinary_create',
  'explicit_retry',
  'scheme_run',
  /** Historical runKind=retry did not record which HTTP operation admitted it. */
  'legacy_unknown',
]);
export const generationReceiptBindingStateSchema = z.enum(['bound', 'legacy_unbound']);
/** A claimed send can have reached the provider even when no response was saved. */
export const generationReceiptDispatchSchema = z.enum([
  'not_started',
  'claimed',
  'confirmed_not_sent',
]);
export const generationReceiptCostProvenanceSchema = z.enum([
  'not_sent',
  'unknown',
  'provider_reported',
]);
/** Includes the server-reserved scheme namespace for read-only recovery. */
export const generationReceiptKeySchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[\x20-\x7e]+$/);
export const generationReceiptQuerySchema = z.object({ key: generationReceiptKeySchema }).strict();

export const retryGenerationInputSchema = z
  .object({ expectedBinding: executionBindingSchema.optional() })
  .strict();

/** Same user intent across gateway retries; desktop legacy string input is adapted only by its host. */
export const retryGenerationCommandSchema = retryGenerationInputSchema
  .extend({
    id: entityIdSchema,
    idempotencyKey: generationIdempotencyKeySchema,
  })
  .strict();

/**
 * Durable, secret-free execution metadata. It survives removal of the result, assets,
 * scheme and authorizing session. It carries no prompt text or storage locations.
 * Missing historical binding is explicit and never inferred from today's credential.
 */
export const generationExecutionReceiptSchema = z
  .object({
    id: entityIdSchema,
    principalId: entityIdSchema,
    idempotencyKey: generationReceiptKeySchema,
    operation: generationReceiptOperationSchema,
    originalRunId: entityIdSchema,
    sourceRunId: entityIdSchema.nullable(),
    bindingState: generationReceiptBindingStateSchema,
    binding: executionBindingSchema.nullable(),
    status: generationStatusSchema,
    dispatch: generationReceiptDispatchSchema,
    costProvenance: generationReceiptCostProvenanceSchema,
    /** Null means cost not recorded; success/cancellation never implies a free request. */
    costPoints: z.number().int().nonnegative().nullable(),
    revision: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    terminalAt: isoDateTimeSchema.nullable(),
    purgedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.bindingState === 'bound') !== (value.binding !== null)) {
      context.addIssue({ code: 'custom', path: ['binding'], message: 'Binding state mismatch' });
    }
    if (value.operation === 'legacy_unknown' && value.bindingState !== 'legacy_unbound') {
      context.addIssue({
        code: 'custom',
        path: ['operation'],
        message: 'Unknown operations are historical only',
      });
    }
    if (value.binding && value.binding.principalId !== value.principalId) {
      context.addIssue({
        code: 'custom',
        path: ['binding'],
        message: 'Binding principal mismatch',
      });
    }
    if (value.costProvenance === 'unknown' && value.costPoints !== null) {
      context.addIssue({
        code: 'custom',
        path: ['costPoints'],
        message: 'Unknown cost must be null',
      });
    }
    if (value.costProvenance === 'provider_reported' && value.costPoints === null) {
      context.addIssue({
        code: 'custom',
        path: ['costPoints'],
        message: 'Provider cost is required',
      });
    }
    if (
      value.costProvenance === 'not_sent' &&
      value.costPoints !== null &&
      value.costPoints !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['costPoints'],
        message: 'An unsent request cannot report positive cost',
      });
    }
  });

export type GenerationExecutionReceipt = z.infer<typeof generationExecutionReceiptSchema>;
export type GenerationReceiptOperation = z.infer<typeof generationReceiptOperationSchema>;
export type GenerationReceiptDispatch = z.infer<typeof generationReceiptDispatchSchema>;
export type GenerationReceiptCostProvenance = z.infer<typeof generationReceiptCostProvenanceSchema>;
export type RetryGenerationInput = z.infer<typeof retryGenerationInputSchema>;
