import { SOFT_DELETE_RETENTION_MS } from '@musefold/db';

export {
  purgeGenerationRetentionBatch as purgeExpiredSoftDeletedRuns,
  purgePromptRetentionBatch as purgeExpiredSoftDeletedPrompts,
} from '@musefold/db';

export function collectExpiredSoftDeletedPromptIds(
  rows: ReadonlyArray<{ id: string; deletedAt: Date | null }>,
  now: Date,
): string[] {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  return rows
    .filter((row) => row.deletedAt != null && row.deletedAt.getTime() <= cutoff.getTime())
    .map((row) => row.id);
}
