import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  designSchemeAgentRevisionBaseSchema,
  designSchemeRevisionDocumentSchema,
  sourceSnapshotSchema,
  type cloudCheckDesignSchemeUpdateInputSchema,
  type DesignSchemeAgentRevisionBase,
} from '@musefold/contracts';
import {
  designSchemes,
  designSchemeRevisions,
  designSchemeSourceSnapshots,
  executionDigest,
  type MusefoldDatabase,
  type MusefoldTransaction,
} from '@musefold/db';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/** Scheme lock is acquired before source/reference locks, in both this guard and updateInTransaction. */
export class DesignSchemeRevisionAuthority {
  constructor(private readonly db: MusefoldDatabase) {}
  async lock(
    tx: MusefoldTransaction,
    userId: string,
    input: z.infer<typeof cloudCheckDesignSchemeUpdateInputSchema> & {
      baseDocument?: DesignSchemeAgentRevisionBase['document'];
    },
    expected?: DesignSchemeAgentRevisionBase,
  ) {
    const [scheme] = await tx
      .select()
      .from(designSchemes)
      .where(
        and(
          eq(designSchemes.userId, userId),
          eq(designSchemes.id, input.schemeId),
          isNull(designSchemes.deletedAt),
        ),
      )
      .for('update');
    if (
      !scheme ||
      scheme.version !== input.expectedVersion ||
      (scheme.currentRevisionId !== input.baseRevisionId &&
        (scheme.status !== 'formal' || scheme.workingDraftRevisionId !== input.baseRevisionId))
    )
      throw revisionChanged();
    const [revision] = await tx
      .select({ document: designSchemeRevisions.document })
      .from(designSchemeRevisions)
      .where(
        and(
          eq(designSchemeRevisions.userId, userId),
          eq(designSchemeRevisions.schemeId, input.schemeId),
          eq(designSchemeRevisions.revisionId, input.baseRevisionId),
        ),
      );
    const document = designSchemeRevisionDocumentSchema.parse(revision?.document);
    if (input.baseDocument && executionDigest(document) !== executionDigest(input.baseDocument))
      throw revisionChanged();
    const frozen = designSchemeAgentRevisionBaseSchema.parse({
      expectedVersion: input.expectedVersion,
      document,
    });
    if (expected && executionDigest(frozen) !== executionDigest(expected)) throw revisionChanged();
    return frozen;
  }
  async snapshots(userId: string, base: DesignSchemeAgentRevisionBase) {
    const ids = base.document.sourceSnapshotIds;
    if (!ids.length) return [];
    const stored = await this.db
      .select()
      .from(designSchemeSourceSnapshots)
      .where(
        and(
          eq(designSchemeSourceSnapshots.userId, userId),
          inArray(designSchemeSourceSnapshots.id, ids),
        ),
      );
    if (stored.length !== ids.length) throw revisionChanged();
    return ids.map((id) => sourceSnapshotSchema.parse(stored.find((row) => row.id === id)?.scan));
  }
}
export function revisionChanged() {
  return new AppError(
    'VALIDATION_FAILED',
    '方案基础版本已变化，请查看最新版本后重新发起修改',
    409,
    false,
    { reason: 'AGENT_BASE_REVISION_CHANGED' },
  );
}
