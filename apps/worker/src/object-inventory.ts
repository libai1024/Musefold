import { createHash, randomUUID } from 'node:crypto';
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import {
  type MusefoldDatabase,
  objectInventoryCandidates as candidates,
  objectInventoryCursors as cursors,
  runRetentionTransaction,
} from '@musefold/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { findProtectedObjects } from './object-protection.js';

export const INVENTORY_PREFIXES = [
  'users/',
  'scheme-sources/',
  'scheme-packages/',
  'scheme-imports/',
  'scheme-exports/',
] as const;
export const INVENTORY_PAGE_SIZE = 100;
export const INVENTORY_GRACE_MS = 24 * 60 * 60_000;
const SCAN_LEASE_MS = 10 * 60_000;
export type InventoryMode = 'record' | 'dry-run';
export type InventoryPrefix = (typeof INVENTORY_PREFIXES)[number];

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const hash = '[0-9a-f]{64}';
const patterns = [
  new RegExp(`^users/[A-Za-z0-9_-]{1,128}/generations/${uuid}/${uuid}$`),
  new RegExp(`^users/[A-Za-z0-9_-]{1,128}/(?:references|design-scheme-uploads)/${uuid}$`),
  new RegExp(`^scheme-sources/${hash}/${uuid}/${uuid}$`),
  new RegExp(`^scheme-packages/${hash}/${uuid}$`),
  new RegExp(`^scheme-imports/${uuid}/${uuid}/${hash}$`),
  new RegExp(`^scheme-exports/${uuid}$`),
];
export function isManagedInventoryKey(key: string): boolean {
  return key.length <= 512 && patterns.some((pattern) => pattern.test(key));
}

/** Never persist endpoint credentials, bucket names or continuation tokens in logs. */
export function inventoryScopeId(bucket: string, endpoint: string): string {
  return createHash('sha256')
    .update(JSON.stringify([bucket, endpoint]))
    .digest('hex');
}

const observationSchema = z.object({
  Key: z.string().max(512),
  ETag: z.string().min(1).max(256),
  LastModified: z.date(),
  Size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
type Observation = z.infer<typeof observationSchema>;

export interface InventoryDependencies {
  db: MusefoldDatabase;
  s3: S3Client;
  bucket: string;
  scopeId: string;
  now?: () => Date;
}

/**
 * Commit observations and the next page atomically. The S3 request runs outside DB
 * locks; a durable token fences a delayed response after another worker takes over.
 * Recording a candidate is not deletion authorization.
 */
export async function scanObjectInventoryPage(
  deps: InventoryDependencies,
  prefix: InventoryPrefix,
  mode: InventoryMode = 'record',
) {
  if (
    !INVENTORY_PREFIXES.includes(prefix) ||
    !['record', 'dry-run'].includes(mode) ||
    !/^[0-9a-f]{64}$/.test(deps.scopeId)
  )
    throw new Error('InvalidInventoryScope');
  const clock = deps.now ?? (() => new Date());
  const owner = and(
    eq(cursors.scopeId, deps.scopeId),
    eq(cursors.prefix, prefix),
    eq(cursors.mode, mode),
  );
  const counts = {
    scanned: 0,
    unmanaged: 0,
    invalid: 0,
    protected: 0,
    young: 0,
    candidates: 0,
    recorded: 0,
    completed: 0,
    busy: 0,
  };
  const leaseToken = randomUUID();
  const claimed = await runRetentionTransaction(deps.db, async (tx) => {
    const now = clock();
    await tx
      .insert(cursors)
      .values({ scopeId: deps.scopeId, prefix, mode, updatedAt: now })
      .onConflictDoNothing();
    const [row] = await tx.select().from(cursors).where(owner).for('update', { skipLocked: true });
    if (!row || (row.leaseUntil && row.leaseUntil > now)) return null;
    await tx
      .update(cursors)
      .set({ leaseToken, leaseUntil: new Date(now.getTime() + SCAN_LEASE_MS), updatedAt: now })
      .where(owner);
    return { continuationToken: row.continuationToken };
  });
  if (!claimed) return { ...counts, busy: 1 };
  try {
    const page = await deps.s3.send(
      new ListObjectsV2Command({
        Bucket: deps.bucket,
        Prefix: prefix,
        MaxKeys: INVENTORY_PAGE_SIZE,
        ContinuationToken: claimed.continuationToken ?? undefined,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    const items = page.Contents ?? [];
    if (
      typeof page.IsTruncated !== 'boolean' ||
      items.length > INVENTORY_PAGE_SIZE ||
      (page.IsTruncated &&
        (!page.NextContinuationToken ||
          page.NextContinuationToken === claimed.continuationToken ||
          page.NextContinuationToken.length > 8192))
    )
      throw new Error('InvalidInventoryPage');
    const observations: Observation[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      counts.scanned++;
      const parsed = observationSchema.safeParse(item);
      if (!parsed.success) {
        counts.invalid++;
        continue;
      }
      if (!parsed.data.Key.startsWith(prefix) || !isManagedInventoryKey(parsed.data.Key)) {
        counts.unmanaged++;
        continue;
      }
      if (seen.has(parsed.data.Key)) throw new Error('DuplicateInventoryObject');
      seen.add(parsed.data.Key);
      observations.push(parsed.data);
    }
    return await runRetentionTransaction(deps.db, async (tx) => {
      const now = clock();
      const [row] = await tx.select().from(cursors).where(owner).for('update');
      if (!row || row.leaseToken !== leaseToken || !row.leaseUntil || row.leaseUntil <= now) {
        return { ...counts, busy: 1 };
      }
      const protection = await findProtectedObjects(
        tx,
        observations.map((item) => item.Key),
        now,
      );
      const protectedKeys = [...protection.permanent, ...protection.leased];
      const protectedSet = new Set(protectedKeys);
      counts.protected = protectedSet.size;
      if (mode === 'record' && protectedKeys.length) {
        await tx
          .delete(candidates)
          .where(
            and(
              eq(candidates.scopeId, deps.scopeId),
              inArray(candidates.objectKey, protectedKeys),
              isNull(candidates.claimToken),
              isNull(candidates.abandonedAt),
            ),
          );
      }
      for (const item of observations) {
        if (protectedSet.has(item.Key)) continue;
        counts.candidates++;
        if (item.LastModified.getTime() > now.getTime() - INVENTORY_GRACE_MS) counts.young++;
        if (mode === 'dry-run') continue;
        // An overwrite, including identical bytes with a later modification time,
        // restarts the observation grace. Repeated unchanged scans do not postpone it.
        const same = sql`${candidates.etag} = excluded.etag AND ${candidates.modifiedAt} = excluded.modified_at
          AND ${candidates.byteSize} = excluded.byte_size`;
        const eligibleAt = new Date(
          Math.max(now.getTime(), item.LastModified.getTime()) + INVENTORY_GRACE_MS,
        );
        const recorded = await tx
          .insert(candidates)
          .values({
            scopeId: deps.scopeId,
            objectKey: item.Key,
            prefix,
            etag: item.ETag,
            modifiedAt: item.LastModified,
            byteSize: item.Size,
            firstObservedAt: now,
            lastObservedAt: now,
            eligibleAt,
          })
          .onConflictDoUpdate({
            target: [candidates.scopeId, candidates.objectKey],
            // An executor owns this observation until acknowledgement or lease takeover.
            // Scanning must not mutate the version being checked or revive failed claims.
            setWhere: and(isNull(candidates.claimToken), isNull(candidates.abandonedAt)),
            set: {
              etag: item.ETag,
              modifiedAt: item.LastModified,
              byteSize: item.Size,
              lastObservedAt: now,
              firstObservedAt: sql`CASE WHEN ${same} THEN ${candidates.firstObservedAt} ELSE ${now}::timestamptz END`,
              eligibleAt: sql`CASE WHEN ${same} THEN ${candidates.eligibleAt} ELSE ${eligibleAt}::timestamptz END`,
            },
          })
          .returning({ key: candidates.objectKey });
        counts.recorded += recorded.length;
      }
      await tx
        .update(cursors)
        .set({
          continuationToken: page.IsTruncated ? page.NextContinuationToken : null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(owner);
      counts.completed = page.IsTruncated ? 0 : 1;
      return counts;
    });
  } catch {
    // Retain the prior continuation token. A retry re-observes this exact page.
    await runRetentionTransaction(deps.db, (tx) =>
      tx
        .update(cursors)
        .set({
          leaseToken: null,
          leaseUntil: null,
          updatedAt: clock(),
        })
        .where(and(owner, eq(cursors.leaseToken, leaseToken))),
    ).catch(() => undefined);
    throw new Error('ObjectInventoryScanFailed');
  }
}

export const inventoryScanRequestSchema = z
  .object({
    mode: z.enum(['record', 'dry-run']).default('record'),
    // Graphile adds this envelope to scheduled/backfilled jobs, including when
    // the crontab has no application payload. It grants no additional scope.
    _cron: z.object({ ts: z.iso.datetime(), backfilled: z.boolean() }).strict().optional(),
  })
  .strict();
