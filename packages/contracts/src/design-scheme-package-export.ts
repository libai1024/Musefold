import { z } from 'zod';
import {
  opaqueIdSchema,
  designSchemeHashSchema,
  canonicalDesignSchemePackageFormatVersionSchema,
} from './design-scheme';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from './design-scheme-package-limits';

/** Freeze the exact formal version the user selected; ownership and storage remain server-only. */
export const beginDesignSchemePackageExportSchema = z
  .object({
    requestId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    expectedVersion: z.number().int().positive(),
    formatVersion: canonicalDesignSchemePackageFormatVersionSchema,
  })
  .strict();

/** Ready means validated bytes exist. Only the host can report successful delivery to the user. */
export const designSchemePackageExportSchema = z
  .object({
    exportId: opaqueIdSchema,
    requestId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    status: z.enum(['preparing', 'ready', 'cancelled', 'failed', 'expired']),
    formatVersion: canonicalDesignSchemePackageFormatVersionSchema,
    packageHash: designSchemeHashSchema.nullable(),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes)
      .nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'ready' && (!value.packageHash || !value.sizeBytes))
      ctx.addIssue({ code: 'custom', message: 'Ready exports require actual byte size and hash' });
  });
export type BeginDesignSchemePackageExport = z.infer<typeof beginDesignSchemePackageExportSchema>;
export type DesignSchemePackageExport = z.infer<typeof designSchemePackageExportSchema>;

/** Host-only receipt. A browser download handoff does not prove filesystem delivery. */
export const designSchemePackageDeliverySchema = z
  .object({
    exportId: opaqueIdSchema,
    status: z.enum(['delivered', 'download-started', 'cancelled']),
  })
  .strict();
export type DesignSchemePackageDelivery = z.infer<typeof designSchemePackageDeliverySchema>;
