import { z } from 'zod';
import {
  opaqueIdSchema,
  designSchemePackageFormatVersionSchema,
  designSchemeHashSchema,
} from './design-scheme';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from './design-scheme-package-limits';

export const DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS = 60 * 60_000;
export const DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS = 2 * 60_000;
export const DESIGN_SCHEME_PACKAGE_PARSER_VERSION = 1;
const hash = designSchemeHashSchema.transform((value) =>
  value.toLowerCase().replace(/^sha256:/, ''),
);
/** Immutable upload intent. Neither paths, object coordinates nor ownership come from clients. */
export const beginDesignSchemePackageUploadSchema = z
  .object({
    requestId: opaqueIdSchema,
    packageHash: hash,
    sizeBytes: z.number().int().positive().max(DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes),
    formatVersion: designSchemePackageFormatVersionSchema,
  })
  .strict();

export const designSchemePackagePreviewSchema = z
  .object({
    name: z.string().max(120),
    summary: z.string().max(500),
    sourceCount: z.number().int().min(0).max(32),
    imageCount: z.number().int().min(0).max(DESIGN_SCHEME_PACKAGE_LIMITS.entries),
    entryCount: z.number().int().positive().max(DESIGN_SCHEME_PACKAGE_LIMITS.entries),
    /** Legacy previews are preserved in the package but do not establish cover/trial authority. */
    legacyPreviewCount: z.number().int().nonnegative(),
  })
  .strict();
export const designSchemePackageStageSchema = z
  .object({
    stagedPackageId: opaqueIdSchema,
    requestId: opaqueIdSchema,
    packageHash: hash,
    sizeBytes: z.number().int().positive().max(DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes),
    formatVersion: designSchemePackageFormatVersionSchema,
    status: z.enum([
      'awaiting_upload',
      'uploading',
      'ready',
      'confirmed',
      'imported',
      'rejected',
      'cancelled',
      'expired',
      'failed',
    ]),
    parserVersion: z.literal(DESIGN_SCHEME_PACKAGE_PARSER_VERSION),
    confirmationHash: hash.nullable(),
    preview: designSchemePackagePreviewSchema.nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ['ready', 'confirmed', 'imported'].includes(value.status) &&
      (!value.preview || !value.confirmationHash)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Ready packages require an exact content preview and confirmation',
      });
  });
export const decideDesignSchemePackageStageSchema = z
  .object({
    packageHash: hash,
    formatVersion: designSchemePackageFormatVersionSchema,
    parserVersion: z.literal(DESIGN_SCHEME_PACKAGE_PARSER_VERSION),
    confirmationHash: hash,
    decision: z.enum(['confirm', 'reject']),
  })
  .strict();
export type BeginDesignSchemePackageUpload = z.infer<typeof beginDesignSchemePackageUploadSchema>;
export type DesignSchemePackageStage = z.infer<typeof designSchemePackageStageSchema>;
export type DecideDesignSchemePackageStage = z.infer<typeof decideDesignSchemePackageStageSchema>;
