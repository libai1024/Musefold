import { z } from 'zod';
import { entityIdSchema } from './common';

export const accountSummarySchema = z.object({
  id: entityIdSchema,
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(80).nullable(),
  quota: z.number().finite().nonnegative(),
  quotaUnit: z.string().trim().min(1).max(24),
  canGenerate: z.boolean(),
});

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const accountSessionSchema = z.object({
  account: accountSummarySchema,
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
