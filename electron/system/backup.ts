// electron/system/backup.ts
// 破坏性操作前的自动备份（TASK-SET-02）
//
// 用 SQLite 自己的 VACUUM INTO 而不是 fs.copyFile：WAL 模式下 data.db 只是三件套之一
// （还有 -wal / -shm），单独拷主库会漏掉尚未 checkpoint 的事务，拿到一个"过去某刻"的库。
// VACUUM INTO 由引擎在一致性快照上生成单文件副本，天然不需要停写。

import Database from 'better-sqlite3';
import { copyFile, lstat, mkdir, readdir, rename, rm, stat, unlink } from 'fs/promises';
import { basename, join } from 'path';
import type { BackupInfo } from '@shared/types/ipc';
import { closeDb, getDb, initDb } from '@musefold/core/db/index';
import { getPaths } from './paths';
import { createLogger } from './logger';

const logger = createLogger('backup');

/** 备份保留个数；超出的按时间从旧到新删 */
const KEEP = 10;

const BACKUP_PREFIX = 'backup-';

function backupError(code: string, message: string): Error {
  const error = new Error(`${code}: ${message}`);
  (error as Error & { code: string }).code = code;
  return error;
}

function backupKind(file: string): BackupInfo['kind'] {
  return /-manual(?:-\d{2})?\.db$/i.test(file) ? 'manual' : 'auto';
}

/**
 * 文件名时间戳，**带毫秒**。
 *
 * 秒级精度不够：VACUUM INTO 要求目标文件不存在，同一秒内的第二次备份会直接抛
 * 「output file already exists」，把调用方（比如 replace 导入）整个带崩。
 * 毫秒仍是零填充定长的，字典序 == 时间序的性质不变，pruneBackups 照旧不用 stat。
 */
function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${ms}`;
}

/**
 * 生成一份数据库快照，返回其绝对路径。
 *
 * @param label 备份原因（如 `import-replace`），写进文件名方便事后辨认
 */
export async function createBackup(label = 'manual'): Promise<string> {
  const { backups } = getPaths();
  await mkdir(backups, { recursive: true });
  // label 进的是文件名，先掐掉路径分隔符与其它意外字符
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'manual';

  // 毫秒级时间戳基本排除撞名，但同一毫秒内并发调用仍有可能 ——
  // VACUUM INTO 遇到已存在的目标文件会抛错，所以这里兜一层递增后缀。
  const base = join(backups, `${BACKUP_PREFIX}${stamp()}-${safeLabel}`);
  let target = `${base}.db`;
  for (let i = 2; i <= 20; i += 1) {
    if (!(await stat(target).catch(() => null))) break;
    target = `${base}-${String(i).padStart(2, '0')}.db`;
  }

  const db = getDb();
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const info = await stat(target).catch(() => null);
  logger.info('已创建备份', target, info ? `${Math.round(info.size / 1024)}KB` : '');

  await pruneBackups();
  return target;
}

/** 只保留最近 KEEP 份，其余删除。清理失败不影响主流程。 */
export async function pruneBackups(): Promise<void> {
  const { backups } = getPaths();
  try {
    const names = (await readdir(backups)).filter(
      (n) => n.startsWith(BACKUP_PREFIX) && n.endsWith('.db')
    );
    // 文件名时间戳是零填充定长的，字典序 == 时间序，不必去 stat
    const stale = names.sort().slice(0, Math.max(0, names.length - KEEP));
    for (const n of stale) {
      await unlink(join(backups, n)).catch(() => undefined);
    }
    if (stale.length > 0) logger.info('清理旧备份', `${stale.length} 份`);
  } catch (err) {
    logger.warn('清理备份失败', (err as Error).message);
  }
}

/** 列出现有备份（新→旧），包括导入前快照和数据库升级前的 db-*.db。 */
export async function listBackups(): Promise<BackupInfo[]> {
  const { backups } = getPaths();
  try {
    await mkdir(backups, { recursive: true });
    const names = (await readdir(backups)).filter((name) => name.toLowerCase().endsWith('.db'));
    const out: BackupInfo[] = [];
    for (const n of names) {
      const p = join(backups, n);
      // lstat 可拒绝指向目录外的符号链接；恢复时会再次执行相同校验。
      const info = await lstat(p).catch(() => null);
      if (info?.isFile()) {
        out.push({
          file: n,
          path: p,
          size: info.size,
          createdAt: info.mtimeMs,
          kind: backupKind(n),
        });
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function validateMusefoldBackup(path: string): void {
  let candidate: Database.Database | null = null;
  try {
    candidate = new Database(path, { readonly: true, fileMustExist: true });
    const quickCheck = candidate.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') throw backupError('INVALID_BACKUP', '备份数据库完整性检查失败');

    const version = Number(candidate.pragma('user_version', { simple: true }));
    const currentVersion = Number(getDb().pragma('user_version', { simple: true }));
    const hasPromptsTable = candidate
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompts'")
      .get();
    if (!Number.isInteger(version) || version < 1 || !hasPromptsTable) {
      throw backupError('INVALID_BACKUP', '所选文件不是 Musefold 数据库备份');
    }
    if (version > currentVersion) {
      throw backupError('INCOMPATIBLE_BACKUP', '备份来自更高版本的 Musefold，请先升级应用');
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'INVALID_BACKUP' || code === 'INCOMPATIBLE_BACKUP') throw error;
    throw backupError('INVALID_BACKUP', '备份文件损坏或无法读取');
  } finally {
    candidate?.close();
  }
}

/** 恢复前校验、保全当前库，再原子替换 data.db。调用方随后必须重启应用。 */
export async function restoreBackup(file: string): Promise<{ safetyBackupPath: string }> {
  const paths = getPaths();
  await mkdir(paths.backups, { recursive: true });

  if (!file || basename(file) !== file || !file.toLowerCase().endsWith('.db')) {
    throw backupError('FORBIDDEN', '只能恢复备份目录中的数据库文件');
  }

  const source = join(paths.backups, file);
  const sourceInfo = await lstat(source).catch(() => null);
  if (!sourceInfo?.isFile()) {
    throw backupError('BACKUP_NOT_FOUND', '备份不存在、已移动或不是普通文件');
  }

  validateMusefoldBackup(source);

  // 先复制到 data.db 同目录。createBackup 会执行保留策略，最旧备份可能被清理，
  // staging 能保证用户选择的源在整个恢复过程中保持可用。
  const staging = `${paths.db}.restore-next-${process.pid}-${Date.now()}`;
  const previous = `${paths.db}.restore-previous`;
  await copyFile(source, staging);
  let safetyBackupPath: string;
  try {
    safetyBackupPath = await createBackup('pre-restore');
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }

  let closed = false;
  let movedCurrent = false;
  try {
    closeDb();
    closed = true;
    await rm(`${paths.db}-wal`, { force: true });
    await rm(`${paths.db}-shm`, { force: true });
    await rm(previous, { force: true });

    try {
      await rename(paths.db, previous);
      movedCurrent = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await rename(staging, paths.db);
    await rm(previous, { force: true });
    logger.info('已恢复数据库备份', file, '等待应用重启');
    return { safetyBackupPath };
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    if (movedCurrent) {
      await rm(paths.db, { force: true }).catch(() => undefined);
      await rename(previous, paths.db).catch(() => undefined);
    }
    if (closed) {
      try {
        initDb();
      } catch {
        // 保留原错误；下次启动仍会重新初始化数据库。
      }
    }
    throw backupError('RESTORE_FAILED', (error as Error).message || '恢复数据库失败');
  }
}
