import { executionDigest, type designSchemePackageStages } from '@musefold/db';

/** Persisted mapping and retry policy shared by admission and its read-only recovery projection. */
export const PACKAGE_IMPORT_MAPPING_VERSION = 1;
export const PACKAGE_IMPORT_MAX_ATTEMPTS = 16;
export const PACKAGE_IMPORT_MIN_IO_LIFETIME_MS = 35_000;

export function packageConfirmationHash(
  stage: Pick<
    typeof designSchemePackageStages.$inferSelect,
    | 'id'
    | 'userId'
    | 'authorityHash'
    | 'packageHash'
    | 'formatVersion'
    | 'parserVersion'
    | 'preview'
    | 'expiresAt'
  >,
) {
  return executionDigest({
    id: stage.id,
    userId: stage.userId,
    authorityHash: stage.authorityHash,
    packageHash: stage.packageHash,
    formatVersion: stage.formatVersion,
    parserVersion: stage.parserVersion,
    preview: stage.preview,
    expiresAt: stage.expiresAt.toISOString(),
  });
}
