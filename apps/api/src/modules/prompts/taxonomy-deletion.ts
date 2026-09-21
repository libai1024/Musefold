import {
  type PromptFolder,
  type PromptTag,
  type SyncEntityType,
  promptFolderSchema,
  promptTagSchema,
} from '@musefold/contracts';
import { syncTaxonomyTombstones } from '@musefold/db';
import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../sync/change-log.js';

type TaxonomyType = Exclude<SyncEntityType, 'prompt'>;

/**
 * 文件夹树的写者先取此锁，再取目标身份锁/行锁，避免两次交错移动形成环。
 * 只串行同 owner 的 Folder 结构写，不串行不同 owner 或普通 Prompt 编辑。
 * 持锁事务不得执行外部 IO。
 */
export async function lockFolderTopology(tx: DbLike, userId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['folder-topology', userId])}, 0))`,
  );
}

/**
 * 主表与持久删除身份之间的跨表互斥：先锁再检查/创建/修改/删除。
 * Folder 写者必须先取 topology；引用读者使用父级/标签的 KEY SHARE 行锁。
 */
export async function lockTaxonomyIdentity(
  tx: DbLike,
  userId: string,
  entityType: TaxonomyType,
  entityId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['taxonomy-identity', userId, entityType, entityId])}, 0))`,
  );
}

export async function readTaxonomyTombstone(
  tx: DbLike,
  userId: string,
  entityType: TaxonomyType,
  entityId: string,
): Promise<PromptFolder | PromptTag | null> {
  const rows = await tx
    .select()
    .from(syncTaxonomyTombstones)
    .where(
      and(
        eq(syncTaxonomyTombstones.userId, userId),
        eq(syncTaxonomyTombstones.entityType, entityType),
        eq(syncTaxonomyTombstones.entityId, entityId),
      ),
    );
  const row = rows[0];
  if (!row) return null;
  const shared = {
    id: row.entityId,
    version: row.version,
    createdAt: row.entityCreatedAt.toISOString(),
    updatedAt: row.deletedAt.toISOString(),
    deletedAt: row.deletedAt.toISOString(),
  };
  // 这是兼容旧 syncSnapshotSchema 的删除投影，不是原分类内容。
  return entityType === 'folder'
    ? promptFolderSchema.parse({ ...shared, name: '已删除文件夹', parentId: null, sortOrder: 0 })
    : promptTagSchema.parse({ ...shared, name: '已删除标签', group: null, color: null });
}

export async function recordTaxonomyTombstone(
  tx: DbLike,
  userId: string,
  entityType: TaxonomyType,
  snapshot: PromptFolder | PromptTag,
): Promise<void> {
  if (!snapshot.deletedAt)
    throw new Error('A persistent deletion identity requires a deleted snapshot');
  await tx.insert(syncTaxonomyTombstones).values({
    userId,
    entityType,
    entityId: snapshot.id,
    version: snapshot.version,
    entityCreatedAt: new Date(snapshot.createdAt),
    deletedAt: new Date(snapshot.deletedAt),
  });
}
