import { designSchemePackageStageSchema } from '@musefold/contracts';
import type { designSchemePackageStages } from '@musefold/db';

const live = new Set(['awaiting_upload', 'uploading', 'ready', 'confirmed']);

/** Expiry is a read projection; completed receipts are not subject to the upload TTL. */
export function packageStageView(
  row: typeof designSchemePackageStages.$inferSelect,
  now = new Date(),
) {
  const expired =
    live.has(row.status) &&
    (row.expiresAt <= now ||
      (row.status === 'uploading' && row.uploadLeaseUntil && row.uploadLeaseUntil <= now));
  return designSchemePackageStageSchema.parse({
    stagedPackageId: row.id,
    requestId: row.requestId,
    packageHash: row.packageHash,
    sizeBytes: row.byteSize,
    formatVersion: row.formatVersion,
    parserVersion: row.parserVersion,
    status: expired ? 'expired' : row.status,
    preview: row.preview,
    confirmationHash: row.confirmationHash,
    expiresAt: row.expiresAt.toISOString(),
  });
}
