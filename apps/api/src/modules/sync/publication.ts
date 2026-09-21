import { lockSyncPublication } from '@musefold/db';
import { AppError } from '../../lib/errors.js';

/** A busy publication boundary is retryable and never returns an unsafe cursor. */
export async function acquireSyncPublication(
  tx: Parameters<typeof lockSyncPublication>[0],
  mode: 'read' | 'write',
): Promise<void> {
  try {
    await lockSyncPublication(tx, mode);
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '55P03')
      throw new AppError('INTERNAL_ERROR', '同步数据正在提交，请稍后重试', 503, true);
    throw error;
  }
}
