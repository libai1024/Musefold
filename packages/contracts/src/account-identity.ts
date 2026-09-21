import { z } from 'zod';
import { cloudModelIdSchema, entityIdSchema, isoDateTimeSchema } from './common';

/** A public service identity, never an address supplied for forwarding credentials. */
export const accountIssuerSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Expected an HTTP service issuer without credentials, query or fragment');

export const accountIdentityStatusSchema = z.enum([
  'unverified',
  'active',
  'verification_pending',
  'identity_conflict',
  'recovery_required',
]);

export const accountIdentitySchema = z
  .object({
    apiIssuer: accountIssuerSchema,
    /** Internal Musefold principal; AccountSummary.id remains the upstream account ID. */
    principalId: entityIdSchema,
    status: accountIdentityStatusSchema,
    identityVersion: z.number().int().nonnegative(),
  })
  .strict();

export const accountRecoveryReasonSchema = z.enum([
  'legacy_issuer_unknown',
  'legacy_evidence_missing',
  'legacy_identity_conflict',
  'verification_pending',
]);

export const accountRecoveryActionSchema = z.enum([
  'retry',
  'verify_original_session',
  'create_independent_workspace',
]);

export const accountRecoverySchema = z
  .object({
    /** Opaque request identity. Possession is not proof of ownership or authorization. */
    requestId: entityIdSchema,
    reason: accountRecoveryReasonSchema,
    expiresAt: isoDateTimeSchema,
    actions: z
      .array(accountRecoveryActionSchema)
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'Duplicate recovery action'),
  })
  .strict();

export const accountRecoveryRequestSchema = z.object({ requestId: entityIdSchema }).strict();

/** Only returned to an existing session that proves the matching issuer and owner. */
export const accountRecoveryReviewSchema = z
  .object({
    requestId: entityIdSchema,
    expiresAt: isoDateTimeSchema,
    candidate: z
      .object({
        issuer: accountIssuerSchema,
        ownerId: entityIdSchema,
        username: z.string().trim().min(1).max(64),
        displayName: z.string().trim().min(1).max(80).nullable(),
      })
      .strict(),
  })
  .strict();

/** Stable payer identity frozen at admission; timestamps and login revisions are not identity. */
export const executionBindingSchema = z
  .object({
    apiIssuer: accountIssuerSchema,
    principalId: entityIdSchema,
    payer: z.object({ issuer: accountIssuerSchema, ownerId: entityIdSchema }).strict(),
    credential: z.object({ ref: entityIdSchema, version: z.number().int().positive() }).strict(),
    providerId: z.literal('cloud-default'),
    model: cloudModelIdSchema,
    capabilities: z.object({ image: z.literal(true), text: z.literal(false) }).strict(),
  })
  .strict();

/** Account/credential identity only; it grants no image or text capability by itself. */
export const accountExecutionIdentitySchema = executionBindingSchema.pick({
  apiIssuer: true,
  principalId: true,
  payer: true,
  credential: true,
});
export type AccountExecutionIdentity = z.infer<typeof accountExecutionIdentitySchema>;

/** Read-only description of a server-verified binding; not a bearer grant or a secret. */
export const accountExecutionBindingSchema = z.discriminatedUnion('status', [
  executionBindingSchema.extend({
    status: z.literal('available'),
    verifiedAt: isoDateTimeSchema,
  }),
  z
    .object({
      status: z.literal('unavailable'),
      apiIssuer: accountIssuerSchema,
      principalId: entityIdSchema,
      reason: z.enum(['IDENTITY_UNVERIFIED', 'CREDENTIAL_UNAVAILABLE']),
    })
    .strict(),
]);

export type AccountIdentityStatus = z.infer<typeof accountIdentityStatusSchema>;
export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type AccountRecoveryReason = z.infer<typeof accountRecoveryReasonSchema>;
export type AccountRecoveryAction = z.infer<typeof accountRecoveryActionSchema>;
export type AccountRecovery = z.infer<typeof accountRecoverySchema>;
export type AccountRecoveryRequest = z.infer<typeof accountRecoveryRequestSchema>;
export type AccountRecoveryReview = z.infer<typeof accountRecoveryReviewSchema>;
export type AccountExecutionBinding = z.infer<typeof accountExecutionBindingSchema>;
export type ExecutionBinding = z.infer<typeof executionBindingSchema>;
