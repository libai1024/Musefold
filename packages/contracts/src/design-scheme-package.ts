import { z } from 'zod';
import {
  type sharePackageManifestSchema,
  LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  designSchemeHashSchema,
  httpsRepositoryUriSchema,
  relativePathSchema,
  resolvedRefSchema,
} from './design-scheme';

/** Existing v1 ZIP manifest, retained as the same canonical legacy contract for all hosts. */
export const legacyDesignSchemePackageSnapshotSchema = z
  .object({
    dir: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    kind: z.enum(['github', 'history', 'user-brief']),
    role: z.enum(['normative', 'reference', 'example', 'context']),
    repositoryUrl: httpsRepositoryUriSchema.nullable(),
    ref: resolvedRefSchema,
    commitHash: z.string().trim().min(1).max(128).nullable(),
    license: z.string().trim().min(1).max(256).nullable(),
    scan: z.unknown(),
  })
  .strict();

export const legacyDesignSchemePackageManifestSchema = z
  .object({
    format: z.literal('musefold.design'),
    formatVersion: z.literal(LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION),
    exportedAt: z.number().int().nonnegative(),
    scheme: z
      .object({
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().max(500),
        fidelity: z.enum(['verified', 'faithful', 'adapted', 'unsupported']),
        sourceLabel: z.string().trim().max(160),
        sourcePresentation: z.enum(['skill', 'musefold-created']),
      })
      .strict(),
    revisionId: z.string().trim().min(1).max(128),
    snapshots: z.array(legacyDesignSchemePackageSnapshotSchema).max(32),
    files: z.record(relativePathSchema, designSchemeHashSchema),
  })
  .strict();

export type CanonicalDesignSchemePackageManifest = z.infer<typeof sharePackageManifestSchema>;
export type LegacyDesignSchemePackageManifest = z.infer<
  typeof legacyDesignSchemePackageManifestSchema
>;
