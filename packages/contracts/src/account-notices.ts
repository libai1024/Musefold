import { z } from 'zod';

/** Stable content IDs retain the legacy read-marker format, not an authorization identity. */
export const accountNoticeIdSchema = z.string().regex(/^n-[a-z0-9]{1,16}$/);
export const accountNoticeSchema = z.object({
  id: accountNoticeIdSchema,
  /** Older string announcements hashed untrimmed text. Keep only their public read markers. */
  legacyReadIds: z.array(accountNoticeIdSchema).max(100).optional(),
  /** Untrusted plain text. Never interpret announcement HTML, Markdown or script. */
  content: z.string().trim().min(1).max(16_384),
  /** Upstream publication time in milliseconds, when supplied and valid. */
  publishedAt: z.number().int().min(0).max(8_640_000_000_000_000).nullable(),
});
export const accountNoticeListSchema = z.array(accountNoticeSchema).max(100);
export const accountNoticeReadIdsSchema = z.array(accountNoticeIdSchema).max(2000);
export const accountNoticesSchema = z.object({
  apiIssuer: z.string().url().max(2048),
  issuer: z.string().url().max(2048),
  items: accountNoticeListSchema,
});
export type AccountNotice = z.infer<typeof accountNoticeSchema>;
export type AccountNotices = z.infer<typeof accountNoticesSchema>;
