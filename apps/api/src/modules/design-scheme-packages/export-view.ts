import { designSchemePackageExportSchema } from '@musefold/contracts';
import type { designSchemePackageExports } from '@musefold/db';

export const PACKAGE_EXPORT_MIN_IO_MS = 35_000;

export function packageExportView(row: typeof designSchemePackageExports.$inferSelect) {
  const status =
    row.status === 'cancelled' || row.status === 'failed'
      ? row.status
      : row.expiresAt <= new Date() || (row.status === 'preparing' && row.leaseUntil <= new Date())
        ? 'expired'
        : row.status;
  return designSchemePackageExportSchema.parse({
    exportId: row.id,
    requestId: row.requestId,
    schemeId: row.schemeId,
    revisionId: row.revisionId,
    status,
    formatVersion: 2,
    packageHash: row.packageHash,
    sizeBytes: row.sizeBytes,
    expiresAt: row.expiresAt.toISOString(),
  });
}
