import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { MusefoldDatabase } from './client.js';
import { findProtectedObjects } from './object-protection.js';
import { runRetentionTransaction } from './retention-transaction.js';
import { objectKeyRetirements } from './schema/object-retirement.js';

/**
 * Serialize the last reference/lease check with publication. Retirement commits
 * before storage IO and survives a process crash or failed acknowledgement.
 * Writers cannot reuse this key; retries recheck protection and remain bounded.
 */
export async function retireUnprotectedObjects(
  db: MusefoldDatabase,
  objectKeys: string[],
  now = new Date(),
): Promise<{ permanent: string[]; leased: string[] }> {
  return runRetentionTransaction(db, (tx) => retireObjectsInTransaction(tx, objectKeys, now));
}

/** The caller must hold a short transaction spanning its own deletion claim. */
export async function retireObjectsInTransaction(
  tx: Pick<MusefoldDatabase, 'execute' | 'insert'>,
  objectKeys: string[],
  now: Date,
): Promise<{ permanent: string[]; leased: string[] }> {
  const keys = [...new Set(objectKeys)].sort();
  if (!keys.length) return { permanent: [], leased: [] };
  for (const key of keys) await tx.execute(sql`SELECT musefold_lock_storage_key(${key})`);
  const protection = await findProtectedObjects(tx, keys, now);
  const protectedKeys = new Set([...protection.permanent, ...protection.leased]);
  const retired = keys.filter((key) => !protectedKeys.has(key));
  if (retired.length) {
    await tx
      .insert(objectKeyRetirements)
      .values(
        retired.map((key) => ({
          keyHash: createHash('sha256').update(key).digest('hex'),
          retiredAt: now,
        })),
      )
      .onConflictDoNothing();
  }
  return protection;
}
