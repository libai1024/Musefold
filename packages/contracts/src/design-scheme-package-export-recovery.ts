import { z } from 'zod';
import { opaqueIdSchema } from './design-scheme';
import { designSchemePackageExportSchema } from './design-scheme-package-export';

export const designSchemePackageExportHistoryQuerySchema = z
  .object({
    cursor: opaqueIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Discovery is metadata only; a ready record still needs current authorization and basis checks. */
export const designSchemePackageExportRecordSchema = z
  .object({
    export: designSchemePackageExportSchema,
    expectedVersion: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    schemeName: z.string().max(160).nullable(),
  })
  .strict();

export const designSchemePackageExportHistorySchema = z
  .object({
    items: z.array(designSchemePackageExportRecordSchema).max(50),
    nextCursor: opaqueIdSchema.nullable(),
  })
  .strict();

/** Advisory read-only eligibility. The content endpoint rechecks it before and after object IO. */
export const designSchemePackageExportRecoverySchema = designSchemePackageExportRecordSchema
  .extend({
    canDownload: z.boolean(),
    blockedReason: z
      .enum(['session_changed', 'export_unavailable', 'export_in_progress', 'basis_changed'])
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.canDownload !== (value.blockedReason === null) ||
      (value.canDownload && value.export.status !== 'ready')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Download eligibility must agree with export state',
      });
  });

export type DesignSchemePackageExportHistoryQuery = z.infer<
  typeof designSchemePackageExportHistoryQuerySchema
>;
export type DesignSchemePackageExportRecord = z.infer<typeof designSchemePackageExportRecordSchema>;
export type DesignSchemePackageExportHistory = z.infer<
  typeof designSchemePackageExportHistorySchema
>;
export type DesignSchemePackageExportRecovery = z.infer<
  typeof designSchemePackageExportRecoverySchema
>;
