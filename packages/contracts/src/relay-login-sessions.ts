// Server/main-process protocol only. Do not return grants or cleanup tokens to
// a renderer. Public product projections live in login-sessions.ts.
import { z } from 'zod';

export const relaySessionSelectionSchema = z
  .object({
    sid: z.string().min(1).max(64),
    version: z.number().int().positive(),
  })
  .strict();
export const relaySessionViewSchema = relaySessionSelectionSchema.extend({
  current: z.boolean(),
  user_agent: z.string().max(512),
  ip: z.string().max(64),
  created_at: z.number().int().positive(),
  last_interactive_at: z.number().int().positive().nullable(),
  last_seen_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
});
export const relaySessionPageSchema = z
  .object({
    items: z.array(relaySessionViewSchema).max(1000),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(1000),
    required: z.number().int().nonnegative(),
  })
  .refine((page) => page.items.length === page.total, 'Truncated upstream session list');
export const relayLoginReviewSchema = z.object({
  expires_at: z.number().int().positive(),
  sessions: relaySessionPageSchema,
});
export const relayLoginGrantSchema = relayLoginReviewSchema.extend({
  flow_token: z.string().min(32).max(128),
});
export const relaySessionReleaseSchema = z.object({ released: z.literal(true) });
export const relaySessionsRevokeSchema = z.object({
  revoked_count: z.number().int().nonnegative(),
});
export const relayRevokedSessionIdsSchema = z.array(z.string().min(1).max(64)).max(50);

export type RelaySessionSelection = z.infer<typeof relaySessionSelectionSchema>;
export type RelaySessionPage = z.infer<typeof relaySessionPageSchema>;
export type RelayLoginReview = z.infer<typeof relayLoginReviewSchema>;
export type RelayLoginGrant = z.infer<typeof relayLoginGrantSchema>;
