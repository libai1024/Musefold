import { z } from 'zod';
import { designSchemeVersionSchema, opaqueIdSchema } from './design-scheme';

export const purgeDesignSchemeInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    /** Current soft-deleted version (remove increments the version). */
    expectedVersion: designSchemeVersionSchema,
  })
  .strict();
export const designSchemePurgeInputSchema = purgeDesignSchemeInputSchema;

export const purgeDesignSchemeResultSchema = z
  .object({
    schemeId: opaqueIdSchema,
    purged: z.literal(true),
    /** Keys retired in the transaction, not a claim that physical bytes are gone. */
    retiredKeys: z.number().int().nonnegative(),
    /** Keys retained by another canonical reference or a live upload/export lease. */
    deferredKeys: z.number().int().nonnegative(),
  })
  .strict();
export const designSchemePurgeResultSchema = purgeDesignSchemeResultSchema;

export type PurgeDesignSchemeInput = z.infer<typeof purgeDesignSchemeInputSchema>;
export type PurgeDesignSchemeResult = z.infer<typeof purgeDesignSchemeResultSchema>;
