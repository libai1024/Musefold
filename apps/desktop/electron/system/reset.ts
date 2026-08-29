import { getDb } from '@musefold/core/db/index';
import { createBackup } from './backup';

// 单账本:生成账本(generated_assets → generation_runs)取代旧 history 两表。
const RESET_ORDER = [
  'prompt_tags',
  'search_history',
  'smart_sets',
  'generated_assets',
  'generation_runs',
  'prompts',
  'tags',
  'folders',
] as const;

function resetError(code: string, message: string): Error {
  const error = new Error(`${code}: ${message}`);
  (error as Error & { code: string }).code = code;
  return error;
}

/** 清空业务内容与历史；Provider、密钥、计费设置和磁盘图片不在此边界内。 */
export async function resetBusinessData(confirm: string): Promise<{ backupPath: string }> {
  if (confirm !== 'RESET') {
    throw resetError('CONFIRMATION_REQUIRED', '清空确认无效');
  }

  // 先落一致性快照。失败即停止，不允许进入删除事务。
  const backupPath = await createBackup('pre-reset');
  const db = getDb();
  db.transaction(() => {
    for (const table of RESET_ORDER) db.prepare(`DELETE FROM ${table}`).run();
    db.prepare('DELETE FROM prompts_fts').run();
  })();

  return { backupPath };
}
