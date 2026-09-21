import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  MAX_OBJECT_CLEANUP_ATTEMPTS,
  objectInventoryCandidates as candidates,
  runRetentionTransaction,
} from '@musefold/db';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  type InventoryDependencies,
  type InventoryMode,
  isManagedInventoryKey,
} from './object-inventory.js';
import { z } from 'zod';
import { retireObjectsInTransaction } from './object-retirement.js';

export const INVENTORY_DELETE_BATCH_SIZE = 20;
const CLAIM_MS = 10 * 60_000;
const STORAGE_TIMEOUT_MS = 30_000;
type Candidate = typeof candidates.$inferSelect;
const headSchema = z.object({
  ETag: z.string().min(1).max(256),
  LastModified: z.date(),
  ContentLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Persist claim/retry facts independently of both discovery cursors and legacy outbox. */
export async function processObjectInventoryCandidates(
  deps: InventoryDependencies,
  mode: InventoryMode = 'record',
) {
  if (!/^[0-9a-f]{64}$/.test(deps.scopeId) || !['record', 'dry-run'].includes(mode))
    throw new Error('InvalidInventoryScope');
  const counts = {
    claimed: 0,
    protected: 0,
    changed: 0,
    deleted: 0,
    missing: 0,
    failed: 0,
    abandoned: 0,
    stale: 0,
    dryRun: mode === 'dry-run' ? 1 : 0,
  };
  if (mode === 'dry-run') return counts;
  const clock = deps.now ?? (() => new Date());
  const identity = (row: Candidate) =>
    and(eq(candidates.scopeId, deps.scopeId), eq(candidates.objectKey, row.objectKey));
  const owned = (row: Candidate) => {
    if (!row.claimToken) throw new Error('MissingInventoryClaim');
    return and(
      identity(row),
      eq(candidates.claimToken, row.claimToken),
      gt(candidates.claimUntil, clock()),
    );
  };
  const claimed = await runRetentionTransaction(deps.db, async (tx) => {
    const now = clock();
    const due = await tx
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.scopeId, deps.scopeId),
          isNull(candidates.abandonedAt),
          lte(candidates.eligibleAt, now),
          lte(candidates.nextAttemptAt, now),
          or(isNull(candidates.claimUntil), lte(candidates.claimUntil, now)),
        ),
      )
      .orderBy(candidates.eligibleAt, candidates.objectKey)
      .limit(INVENTORY_DELETE_BATCH_SIZE)
      .for('update', { skipLocked: true });
    const rows: Candidate[] = [];
    for (const row of due) {
      // A process that died on its last attempt must not leave an invisible stuck claim.
      if (row.attemptCount >= MAX_OBJECT_CLEANUP_ATTEMPTS) {
        await tx
          .update(candidates)
          .set({
            abandonedAt: now,
            claimToken: null,
            claimUntil: null,
            lastError: 'InventoryClaimExpired',
          })
          .where(identity(row));
        counts.abandoned++;
        continue;
      }
      const [claim] = await tx
        .update(candidates)
        .set({
          claimToken: randomUUID(),
          claimUntil: new Date(now.getTime() + CLAIM_MS),
          attemptCount: row.attemptCount + 1,
          lastAttemptAt: now,
        })
        .where(identity(row))
        .returning();
      rows.push(claim);
    }
    return rows;
  });
  counts.claimed = claimed.length;

  async function fail(row: Candidate, errorCode: string, invalid = false) {
    const now = clock();
    const abandoned = invalid || row.attemptCount >= MAX_OBJECT_CLEANUP_ATTEMPTS;
    const backoff = Math.min(86400, 300 * 2 ** Math.min(9, Math.max(0, row.attemptCount - 1)));
    const result = await deps.db
      .update(candidates)
      .set({
        claimToken: null,
        claimUntil: null,
        lastError: errorCode,
        nextAttemptAt: new Date(now.getTime() + backoff * 1000),
        abandonedAt: abandoned ? now : null,
      })
      .where(owned(row))
      .returning({ key: candidates.objectKey });
    if (!result.length) {
      counts.stale++;
      return;
    }
    counts.failed++;
    if (abandoned) counts.abandoned++;
  }

  async function execute(row: Candidate) {
    if (
      !isManagedInventoryKey(row.objectKey) ||
      !INVENTORY_PREFIXES.some(
        (prefix) => prefix === row.prefix && row.objectKey.startsWith(prefix),
      )
    ) {
      await fail(row, 'InvalidInventoryKey', true);
      return;
    }
    let head: Awaited<ReturnType<typeof readHead>>;
    try {
      head = await readHead(row.objectKey);
    } catch (error) {
      await fail(row, error instanceof z.ZodError ? 'InvalidInventoryHead' : 'InventoryHeadFailed');
      return;
    }
    try {
      const authorization = await runRetentionTransaction(deps.db, async (tx) => {
        const [current] = await tx.select().from(candidates).where(owned(row)).for('update');
        if (!current) return 'stale' as const;
        const now = clock();
        if (!current.claimUntil || current.claimUntil <= now) return 'stale' as const;
        if (
          head &&
          (current.etag !== head.ETag ||
            current.modifiedAt.getTime() !== head.LastModified.getTime() ||
            current.byteSize !== head.ContentLength)
        ) {
          // A changed object, even identical bytes with a new timestamp, receives a full new grace period.
          await tx
            .update(candidates)
            .set({
              etag: head.ETag,
              modifiedAt: head.LastModified,
              byteSize: head.ContentLength,
              firstObservedAt: now,
              lastObservedAt: now,
              eligibleAt: new Date(
                Math.max(now.getTime(), head.LastModified.getTime()) + INVENTORY_GRACE_MS,
              ),
              claimToken: null,
              claimUntil: null,
              attemptCount: 0,
              lastAttemptAt: null,
              lastError: null,
              nextAttemptAt: now,
            })
            .where(identity(row));
          return 'changed' as const;
        }
        if (current.eligibleAt > now) {
          await tx
            .update(candidates)
            .set({
              claimToken: null,
              claimUntil: null,
              attemptCount: Math.max(0, current.attemptCount - 1),
            })
            .where(identity(row));
          return 'changed' as const;
        }
        const protection = await retireObjectsInTransaction(tx, [row.objectKey], now);
        if (current.claimUntil <= clock()) throw new Error('InventoryClaimExpired');
        if (protection.permanent.length || protection.leased.length) {
          // Future discovery starts a new observation only after references/leases disappear.
          await tx.delete(candidates).where(identity(row));
          return 'protected' as const;
        }
        return 'authorized' as const;
      });
      if (authorization !== 'authorized') {
        counts[authorization]++;
        return;
      }
      if (head) {
        const result = await deps.s3.send(
          new DeleteObjectsCommand({
            Bucket: deps.bucket,
            Delete: { Objects: [{ Key: row.objectKey }], Quiet: true },
          }),
          { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) },
        );
        if (result.Errors?.length) {
          await fail(row, 'S3DeleteObjectsError');
          return;
        }
      }
      // Retirement stays committed if storage succeeds but acknowledgement crashes.
      const ack = await deps.db
        .delete(candidates)
        .where(owned(row))
        .returning({ key: candidates.objectKey });
      if (!ack.length) counts.stale++;
      else if (head) counts.deleted++;
      else counts.missing++;
    } catch {
      await fail(row, 'InventoryDeleteFailed');
    }
  }

  async function readHead(key: string) {
    try {
      const response = await deps.s3.send(
        new HeadObjectCommand({ Bucket: deps.bucket, Key: key }),
        {
          abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
        },
      );
      headSchema.parse(response);
      // HTTP Last-Modified loses milliseconds in HEAD. Compare the same directory
      // metadata as discovery instead of rounding away a real same-content overwrite.
      const page = await deps.s3.send(
        new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: key, MaxKeys: 1 }),
        { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) },
      );
      if (typeof page.IsTruncated !== 'boolean' || (page.Contents?.length ?? 0) > 1)
        throw new Error('InvalidInventoryPage');
      const object = page.Contents?.find((item) => item.Key === key);
      if (!object) return null;
      return headSchema.parse({
        ETag: object.ETag,
        LastModified: object.LastModified,
        ContentLength: object.Size,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
  }
  // Four concurrent objects bound twenty HEAD/List/Delete request triples within the claim lease.
  for (let offset = 0; offset < claimed.length; offset += 4) {
    const results = await Promise.allSettled(claimed.slice(offset, offset + 4).map(execute));
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('ObjectInventoryDeleteFailed');
  }
  return counts;
}
