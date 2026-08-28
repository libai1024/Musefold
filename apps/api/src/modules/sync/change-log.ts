import { type MusefoldDatabase, syncChangeLog } from '@musefold/db';

/** 事务或裸连接皆可(drizzle 事务与实例共享查询面)。 */
export type DbLike =
  | MusefoldDatabase
  | Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];

/** 变更来源:desktop push 时带上,pull 端可据此跳过回声;REST 写路径不带。 */
export interface ChangeSource {
  deviceId?: string;
  mutationId?: string;
}

/**
 * 追加一条变更日志。所有写路径(REST 与 sync push)必须在同一事务里调用,
 * 保证实体状态与变更流原子一致。
 */
export async function appendSyncChange(
  tx: DbLike,
  userId: string,
  entityType: 'prompt' | 'folder' | 'tag',
  entityId: string,
  operation: 'upsert' | 'delete',
  version: number,
  snapshot: unknown,
  source?: ChangeSource,
): Promise<void> {
  await tx.insert(syncChangeLog).values({
    userId,
    entityType,
    entityId,
    operation,
    version,
    snapshot: snapshot as Record<string, unknown>,
    sourceDeviceId: source?.deviceId ?? null,
    sourceMutationId: source?.mutationId ?? null,
  });
}
