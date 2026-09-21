import {
  purgeDesignSchemeInputSchema,
  purgeDesignSchemeResultSchema,
  type PurgeDesignSchemeInput,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  designSchemePurgeIdentities,
  designSchemePurgeRevisionIdentities,
  enqueueObjectCleanup,
  lockSchemeSourceSnapshots,
  releaseUnboundImportedSchemeSources,
  retireObjectsInTransaction,
} from '@musefold/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { lockNormalAccountAuthority } from '../../lib/normal-account-authority.js';

const conflict = () =>
  new AppError('VALIDATION_FAILED', '方案版本已变化，请重新核对后再永久删除', 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_VERSION_CONFLICT',
  });
const notFound = () =>
  new AppError('VALIDATION_FAILED', '方案不存在', 404, false, {
    designSchemeCode: 'DESIGN_SCHEME_NOT_FOUND',
  });

/** Logical deletion and durable cleanup intent commit together; no storage IO here. */
export async function purgeDesignScheme(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  rawInput: PurgeDesignSchemeInput,
) {
  const input = purgeDesignSchemeInputSchema.parse(rawInput);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await lockNormalAccountAuthority(tx, userId, sessionId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      'musefold:scheme-identity:' || ${input.schemeId}, 0))`);
    const replay = await tx.execute<{
      user_id: string;
      version: number;
      retired_keys: number;
      deferred_keys: number;
    }>(sql`
      SELECT user_id, version, retired_keys, deferred_keys FROM design_scheme_purge_identities
      WHERE scheme_id = ${input.schemeId}
    `);
    const prior = replay.rows[0];
    if (prior) {
      if (prior.user_id !== userId) throw notFound();
      if (prior.version !== input.expectedVersion) throw conflict();
      return purgeDesignSchemeResultSchema.parse({
        schemeId: input.schemeId,
        purged: true,
        retiredKeys: prior.retired_keys,
        deferredKeys: prior.deferred_keys,
      });
    }
    const selected = await tx.execute<{ version: number; deleted_at: Date | null }>(sql`
      SELECT version, deleted_at FROM design_schemes
      WHERE id = ${input.schemeId} AND user_id = ${userId} FOR UPDATE
    `);
    const current = selected.rows[0];
    if (!current) throw notFound();
    if (current.version !== input.expectedVersion) throw conflict();
    if (!current.deleted_at) throw new AppError('VALIDATION_FAILED', '只能永久删除已删除的方案');
    const active = await tx.execute(sql`
      SELECT 1 FROM design_scheme_runs r WHERE r.user_id = ${userId} AND r.scheme_id = ${input.schemeId}
        AND (r.status IN ('planning','executing','evaluating') OR EXISTS (
          SELECT 1 FROM generation_runs g WHERE g.design_scheme_run_id = r.run_id
            AND g.user_id = r.user_id AND g.status IN ('queued','running','cancelling')
        )) LIMIT 1
    `);
    if (active.rows.length)
      throw new AppError('VALIDATION_FAILED', '方案仍有运行中的任务，请等待任务结束', 409, false, {
        designSchemeCode: 'DESIGN_SCHEME_INVALID_STATE',
      });
    const snapshots = await lockSchemeSourceSnapshots(tx, userId, input.schemeId);
    const revisions = await tx.execute<{ revision_id: string }>(sql`
      SELECT revision_id FROM design_scheme_revisions
      WHERE scheme_id = ${input.schemeId} AND user_id = ${userId} ORDER BY revision_id FOR UPDATE
    `);
    const assets = await tx.execute<{ object_key: string }>(sql`
      SELECT a.object_key FROM design_scheme_assets a JOIN design_scheme_revisions r
        ON r.revision_id = a.revision_id AND r.user_id = a.user_id
      WHERE r.scheme_id = ${input.schemeId} AND r.user_id = ${userId}
    `);
    const now = new Date();
    for (const row of revisions.rows)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      'musefold:revision-identity:' || ${row.revision_id}, 0))`);
    if (revisions.rows.length)
      await tx.insert(designSchemePurgeRevisionIdentities).values(
        revisions.rows.map((row) => ({
          revisionId: row.revision_id,
          schemeId: input.schemeId,
          userId,
          purgedAt: now,
        })),
      );
    // Preserve execution receipts, steps, evaluations and original identity.
    await tx.execute(sql`UPDATE design_scheme_runs SET
      origin_scheme_id = COALESCE(origin_scheme_id, scheme_id),
      origin_revision_id = COALESCE(origin_revision_id, revision_id), scheme_id = NULL, revision_id = NULL
      WHERE scheme_id = ${input.schemeId} AND user_id = ${userId}`);
    await tx.execute(
      sql`DELETE FROM design_schemes WHERE id = ${input.schemeId} AND user_id = ${userId}`,
    );
    const sourceKeys = await releaseUnboundImportedSchemeSources(tx, userId, snapshots);
    const keys = [...new Set([...assets.rows.map((row) => row.object_key), ...sourceKeys])];
    const protection = await retireObjectsInTransaction(tx, keys, now);
    const deferred = new Set([...protection.permanent, ...protection.leased]);
    await enqueueObjectCleanup(
      tx,
      keys.map((objectKey) => ({
        objectKey,
        ownerId: userId,
        objectType: 'generation_reference',
        reason: 'design_scheme_purge',
      })),
      now,
    );
    const result = {
      schemeId: input.schemeId,
      purged: true as const,
      retiredKeys: keys.length - deferred.size,
      deferredKeys: deferred.size,
    };
    await tx.insert(designSchemePurgeIdentities).values({
      schemeId: input.schemeId,
      userId,
      version: input.expectedVersion,
      retiredKeys: result.retiredKeys,
      deferredKeys: result.deferredKeys,
      purgedAt: now,
    });
    return purgeDesignSchemeResultSchema.parse(result);
  });
}
