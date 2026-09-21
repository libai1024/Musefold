import { z } from 'zod';
import { accountExecutionIdentitySchema } from './account-identity';

/** Operator-configured text model on the trusted account issuer; never an arbitrary endpoint. */
export const designSchemeTextModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/);
export const designSchemeTextBindingSchema = accountExecutionIdentitySchema
  .extend({
    providerId: z.literal('cloud-agent'),
    model: designSchemeTextModelSchema,
    policyVersion: z.literal('agent-text-v1'),
    capabilities: z.object({ image: z.literal(false), text: z.literal(true) }).strict(),
  })
  .strict();
export const designSchemeTextAuthorizationSchema = z
  .object({
    binding: designSchemeTextBindingSchema,
    maxModelCalls: z.number().int().min(1).max(17),
    maxOutputTokens: z.literal(8192),
    /** Token usage is not an account bill. No automatic retry/fallback is included. */
    acceptUnknownCost: z.literal(true),
  })
  .strict();
export const designSchemeTextModelOfferSchema = z
  .object({
    binding: designSchemeTextBindingSchema,
    maxModelCalls: z.literal(17),
    maxOutputTokens: z.literal(8192),
    cost: z.literal('unknown'),
  })
  .strict();
export const designSchemeTextProgressSchema = z
  .object({
    model: designSchemeTextModelSchema,
    /** Durable send claims; a crash after claim may mean no bytes reached the provider. */
    callsSent: z.number().int().nonnegative().max(17),
    callsCompleted: z.number().int().nonnegative().max(17),
    maxModelCalls: z.number().int().min(1).max(17),
    cost: z.enum(['not-incurred', 'unknown']),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.callsCompleted > v.callsSent ||
      v.callsSent > v.maxModelCalls ||
      (v.cost === 'not-incurred') !== (v.callsSent === 0)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Text progress must agree with durable claims and limits',
      });
  });
export type DesignSchemeTextBinding = z.infer<typeof designSchemeTextBindingSchema>;
export type DesignSchemeTextAuthorization = z.infer<typeof designSchemeTextAuthorizationSchema>;
export type DesignSchemeTextModelOffer = z.infer<typeof designSchemeTextModelOfferSchema>;

/** Provider-reported token counts; never an independently verified charge or quota deduction. */
export const designSchemeTextUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();
