import { z } from 'zod';
import {
  automationBudgetMonthSchema,
  automationSpendActionSchema,
  automationSpendStatusSchema,
} from '@musefold/contracts';

const id = z.string().min(1).max(200);
const points = z.number().finite().nonnegative();
const timestamp = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** A credential revision is an opaque non-secret identifier, never a key suffix or token. */
export const automationPayerBindingSchema = z
  .object({
    providerId: id,
    providerType: z.string().min(1).max(80),
    model: z.string().min(1).max(200),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return !url.username && !url.password && !url.search && !url.hash;
      }, 'Provider URL must not contain credentials, query parameters or fragments'),
    credentialEpoch: id.nullable(),
    payerKind: z.enum(['account', 'external', 'unbound']),
    ownerId: id.nullable(),
    issuer: z.string().url().nullable(),
    policy: z.enum(['managed', 'external']),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.payerKind === 'account' &&
      (!value.ownerId || !value.issuer || !value.credentialEpoch)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Account payer requires verified owner, issuer and credential epoch',
      });
    }
    if (
      value.payerKind === 'external' &&
      (!value.credentialEpoch ||
        value.policy !== 'external' ||
        value.ownerId !== null ||
        value.issuer !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'External credentials are not a Musefold account balance',
      });
    }
    if (value.payerKind === 'unbound' && (value.ownerId !== null || value.issuer !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Unbound credentials must not claim an account owner',
      });
    }
  });

export const automationCostEvidenceSchema = z
  .object({
    /** Executor-reported points; not necessarily a verified upstream charge. */
    reportedPoints: points.nullable(),
    source: z.enum(['unknown', 'local_price_estimate', 'provider_reported', 'verified_charge']),
    /** Opaque reconciliation reference, never credentials, URLs or raw billing payloads. */
    evidenceRef: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.:-]+$/)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.source === 'unknown') !== (value.reportedPoints === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Unknown evidence has no reported cost; a number requires provenance',
      });
    }
    if (value.source === 'verified_charge' && !value.evidenceRef) {
      context.addIssue({
        code: 'custom',
        message: 'Verified charges require an evidence reference',
      });
    }
  });

export const automationSpendRequestSchema = z
  .object({
    id,
    scopeId: id,
    idempotencyKey: id.nullable(),
    inputHash: hash,
    action: automationSpendActionSchema,
    caller: z.string().min(1).max(200),
    /** Host-validated, local-only execution snapshot; never raw headers or credentials. */
    frozenInput: z.record(z.string(), z.json()),
    bindings: z.array(automationPayerBindingSchema).min(1).max(4),
    promptText: z.string().nullable(),
    executionId: id,
    maxImageCalls: z.number().int().min(0).max(16),
    maxTextCalls: z.number().int().min(0).max(32),
    state: z.enum(['pending_confirmation', 'authorized', 'running', 'terminal']),
    outcome: automationSpendStatusSchema.nullable(),
    errorCode: id.nullable(),
    approvalSource: z.enum(['budget', 'confirmation', 'consent', 'external']).nullable(),
    confirmationId: id.nullable(),
    confirmationExpiresAt: timestamp.nullable(),
    budgetMonth: automationBudgetMonthSchema,
    estimatedPoints: points.nullable(),
    reservationState: z.enum(['none', 'held', 'unknown', 'released']),
    reservationPoints: points.nullable(),
    createdAt: timestamp,
    authorizedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const registerAutomationSpendSchema = z
  .object({
    idempotencyKey: id.nullable(),
    action: automationSpendActionSchema,
    caller: z.string().min(1).max(200),
    /** Canonical caller input before choosing mutable defaults; used only for a hash. */
    input: z.record(z.string(), z.json()),
    frozenInput: z.record(z.string(), z.json()),
    bindings: z.array(automationPayerBindingSchema).min(1).max(4),
    promptText: z.string().nullable(),
    executionId: id,
    maxImageCalls: z.number().int().min(0).max(16),
    maxTextCalls: z.number().int().min(0).max(32),
    estimatedPoints: points.nullable(),
    declaredBudgetPoints: points.optional(),
    consent: z.literal('interactive').optional(),
    now: timestamp,
  })
  .strict();

export const automationSpendCallSchema = z
  .object({
    id,
    requestId: id,
    ordinal: z.number().int().nonnegative(),
    kind: z.enum(['image', 'text']),
    binding: automationPayerBindingSchema,
    inputHash: hash,
    generationRunId: id.nullable(),
    state: z.enum(['pending', 'started', 'completed', 'unknown', 'not_sent']),
    claimId: id.nullable(),
    runtimeEpoch: id.nullable(),
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    reportedPoints: points.nullable(),
    policyPoints: points.nullable(),
    costSource: automationCostEvidenceSchema.shape.source,
    evidenceRef: automationCostEvidenceSchema.shape.evidenceRef,
  })
  .strict();

export const prepareAutomationCallSchema = z
  .object({
    requestId: id,
    ordinal: z.number().int().nonnegative(),
    kind: z.enum(['image', 'text']),
    binding: automationPayerBindingSchema,
    input: z.record(z.string(), z.json()),
    generationRunId: id.nullable(),
  })
  .strict();

export const automationLegacyBudgetSchema = z
  .object({
    monthlyLimitPoints: points,
    usedPoints: points,
    month: automationBudgetMonthSchema,
  })
  .strict();

export type AutomationPayerBinding = z.infer<typeof automationPayerBindingSchema>;
export type AutomationCostEvidence = z.infer<typeof automationCostEvidenceSchema>;
export type AutomationSpendRequest = z.infer<typeof automationSpendRequestSchema>;
export type RegisterAutomationSpend = z.infer<typeof registerAutomationSpendSchema>;
export type AutomationSpendCall = z.infer<typeof automationSpendCallSchema>;
export type PrepareAutomationCall = z.infer<typeof prepareAutomationCallSchema>;
export type AutomationLegacyBudget = z.infer<typeof automationLegacyBudgetSchema>;
