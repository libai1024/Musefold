import { z } from 'zod';
import { accountIdentitySchema, accountRecoverySchema } from './account-identity';
import { entityIdSchema } from './common';

export const accountSummarySchema = z
  .object({
    id: entityIdSchema,
    username: z.string().trim().min(1).max(64),
    displayName: z.string().trim().min(1).max(80).nullable(),
    quota: z.number().int().nonnegative(),
    quotaUnit: z.string().trim().min(1).max(24),
    canGenerate: z.boolean(),
    /** Optional only for compatibility with hosts that predate trusted identity projection. */
    identity: accountIdentitySchema.optional(),
    recovery: accountRecoverySchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.canGenerate &&
      (value.recovery || (value.identity && value.identity.status !== 'active'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canGenerate'],
        message: 'Unverified identity cannot generate',
      });
    }
    if (value.recovery && (!value.identity || value.identity.status === 'active')) {
      context.addIssue({
        code: 'custom',
        path: ['recovery'],
        message: 'Recovery requires a restricted identity',
      });
    }
  });

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  twoFactorCode: z.string().min(1).max(128).optional(),
});

export const registerRequestSchema = loginRequestSchema;

export const accountSessionSchema = z.object({
  account: accountSummarySchema,
  csrfToken: z.string().min(32).max(256),
});

export const desktopAccountSessionSchema = accountSessionSchema.extend({
  sessionToken: z.string().min(32).max(512),
});

export const redeemRequestSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

export const redeemResultSchema = z.object({
  account: accountSummarySchema,
  creditedQuota: z.number().int().nonnegative(),
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
export type DesktopAccountSession = z.infer<typeof desktopAccountSessionSchema>;
export type RedeemRequest = z.infer<typeof redeemRequestSchema>;
export type RedeemResult = z.infer<typeof redeemResultSchema>;
