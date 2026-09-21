// v2.5 桌面「系统 / 本地数据」域桥:设置「数据存储」与「关于」两张卡的主进程侧。
//
// 语义全部复用 v2.1 保留的服务函数(electron/system/{backup,paths,reset,logger,about}),
// 本域只做三件事:(1) 出参裁剪成 path-free 契约形状;(2) 入参按白名单收窄
// (备份只认备份目录内的文件名、存储位置只认 5 个 id、外链只认 https 白名单);
// (3) 服务函数的 code 化异常翻译成稳定 BridgeError,且 message 绝不含绝对路径。
//
// 唯一允许出现路径的出参是 storageLocation.displayPath ——「告诉用户数据在哪」就是这张卡的功能,
// 且只在桌面宿主渲染(capabilities.hasLocalDataManagement)。

import {
  type BackupInfo,
  backupFileNameSchema,
  backupListSchema,
  clearAllDataInputSchema,
  createBackupResultSchema,
  clearAllDataResultSchema,
  diagnosticLogSchema,
  openExternalInputSchema,
  openStorageLocationInputSchema,
  restoreBackupInputSchema,
  restoreBackupResultSchema,
  storageLocationListSchema,
  type StorageLocationId,
  appInfoSchema,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { hasActiveImageJobs } from '@musefold/core/services/generation';
import { app, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { getUpdateChannel } from '../../settings/update-channel';
import { openAboutResource } from '../../system/about';
import { APP_VERSION } from '../../system/app-version';
import { createBackup, listBackups, restoreBackup } from '../../system/backup';
import { getPaths } from '../../system/paths';
import { tailLog } from '../../system/logger';
import { resetBusinessData } from '../../system/reset';
import { isAllowedExternalUrl } from '../external-links';
import { BridgeError, type MethodDef } from './envelope';

const noInput = z.undefined().or(z.object({}).strict());

/** 日志查看器一次给到的行数(承 v2.1「最近 300 行」)。 */
const LOG_TAIL_LINES = 300;
/** 单次日志返回上限;超出只给尾部并置 truncated。 */
const LOG_MAX_CHARS = 200 * 1024;

/** 重启前留一点时间让信封回到渲染层,否则用户只看到窗口突然消失。 */
const RELAUNCH_DELAY_MS = 120;

const STORAGE_LOCATION_LABELS: Record<StorageLocationId, string> = {
  database: '数据库',
  images: '图片输出',
  backups: '备份目录',
  logs: '诊断日志',
  userData: '应用数据',
};

/** 恢复失败的稳定码 → 人话文案。服务函数的原始 message 可能带 fs 路径,只在确认无路径时透传。 */
const RESTORE_FALLBACK_MESSAGES: Record<string, string> = {
  FORBIDDEN: '只能恢复备份目录中的数据库文件',
  BACKUP_NOT_FOUND: '备份不存在、已移动或不是普通文件',
  INVALID_BACKUP: '备份文件损坏或不是 Musefold 数据库备份',
  INCOMPATIBLE_BACKUP: '备份来自更高版本的 Musefold,请先升级应用',
  RESTORE_FAILED: '恢复未完成,请重启应用并核对备份',
};

const RESTORE_FAILED_MESSAGE = '恢复未完成,请重启应用并核对备份';

/** 带路径(或异常冗长)的底层 message 一律换成静态文案:渲染层错误不泄漏绝对路径。 */
function pathFreeMessage(message: string, fallback: string): string {
  const text = message.trim();
  if (!text || text.length > 160 || /[/\\]/.test(text)) return fallback;
  return text;
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** 服务函数把 code 也塞进了 message 前缀(`CODE: 文案`),取回纯文案。 */
function messageWithoutCodePrefix(error: unknown, code: string | null): string {
  const raw = error instanceof Error ? error.message : '';
  return code && raw.startsWith(`${code}: `) ? raw.slice(code.length + 2) : raw;
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/Z$/, '+00:00');
}

/** 去掉 path 字段并丢弃名字不符合契约的杂项文件(备份目录里的手工文件不该让整张卡崩)。 */
async function readBackupList(): Promise<BackupInfo[]> {
  const rows = await listBackups();
  const items = rows
    .filter((row) => backupFileNameSchema.safeParse(row.file).success)
    .map((row) => ({
      file: row.file,
      size: row.size,
      createdAt: toIso(row.createdAt),
      kind: row.kind,
    }));
  return backupListSchema.parse(items);
}

function restoreError(error: unknown): never {
  if (error instanceof BridgeError) throw error;
  const code = codeOf(error);
  const fallback = code ? RESTORE_FALLBACK_MESSAGES[code] : undefined;
  if (!code || !fallback) throw new BridgeError('RESTORE_FAILED', RESTORE_FAILED_MESSAGE);
  // RESTORE_FAILED 的 message 来自 fs 异常(常带路径),固定用静态文案。
  const message =
    code === 'RESTORE_FAILED'
      ? fallback
      : pathFreeMessage(messageWithoutCodePrefix(error, code), fallback);
  throw new BridgeError(code, message);
}

function schemaVersion(): number {
  try {
    const version = Number(getDb().pragma('user_version', { simple: true }));
    return Number.isInteger(version) && version >= 0 ? version : 0;
  } catch {
    return 0;
  }
}

export function buildSystemDomainMethods(): Record<string, MethodDef> {
  return {
    'system.getAppInfo': {
      input: noInput,
      handle: async () =>
        appInfoSchema.parse({
          version: APP_VERSION,
          platform: process.platform,
          arch: process.arch,
          schemaVersion: schemaVersion(),
          channel: getUpdateChannel(),
        }),
    },
    'system.listBackups': {
      input: noInput,
      handle: async () => readBackupList(),
    },
    'system.createBackup': {
      input: noInput,
      handle: async () => {
        let file: string;
        try {
          file = basename(await createBackup('manual'));
        } catch (error) {
          throw new BridgeError(
            'BACKUP_FAILED',
            pathFreeMessage(
              messageWithoutCodePrefix(error, codeOf(error)),
              '创建备份失败,请检查磁盘空间后重试',
            ),
          );
        }
        const created = (await readBackupList()).find((backup) => backup.file === file);
        if (!created) {
          throw new BridgeError('BACKUP_FAILED', '备份已创建但无法读取,请刷新备份列表');
        }
        return createBackupResultSchema.parse({ backup: created });
      },
    },
    'system.restoreBackup': {
      input: restoreBackupInputSchema,
      handle: async (payload) => {
        const { file } = payload as z.infer<typeof restoreBackupInputSchema>;
        try {
          const { safetyBackupPath } = await restoreBackup(file);
          return restoreBackupResultSchema.parse({
            safetyBackupFile: basename(safetyBackupPath),
            needsRestart: true,
          });
        } catch (error) {
          restoreError(error);
        }
      },
    },
    'system.listStorageLocations': {
      input: noInput,
      handle: async () => {
        const paths = getPaths();
        const byId: Record<StorageLocationId, string> = {
          database: paths.db,
          images: paths.pictures,
          backups: paths.backups,
          logs: paths.logs,
          userData: paths.userData,
        };
        return storageLocationListSchema.parse(
          (Object.keys(byId) as StorageLocationId[]).map((id) => ({
            id,
            label: STORAGE_LOCATION_LABELS[id],
            displayPath: byId[id],
          })),
        );
      },
    },
    'system.openStorageLocation': {
      input: openStorageLocationInputSchema,
      handle: async (payload) => {
        const { id } = payload as z.infer<typeof openStorageLocationInputSchema>;
        const paths = getPaths();
        // database 是文件:在文件管理器里定位它;其余是目录,先确保存在再打开。
        if (id === 'database') {
          shell.showItemInFolder(paths.db);
          return null;
        }
        const directories: Record<Exclude<StorageLocationId, 'database'>, string> = {
          images: paths.pictures,
          backups: paths.backups,
          logs: paths.logs,
          userData: paths.userData,
        };
        const directory = directories[id];
        await mkdir(directory, { recursive: true }).catch(() => undefined);
        // openPath 的失败串带绝对路径,不透传。
        const failure = await shell.openPath(directory);
        if (failure) throw new BridgeError('OPEN_FAILED', '打开该位置失败,请检查目录是否仍存在');
        return null;
      },
    },
    'system.readDiagnosticLog': {
      input: noInput,
      handle: async () => {
        const tail = await tailLog(LOG_TAIL_LINES);
        const truncated = tail.length > LOG_MAX_CHARS;
        return diagnosticLogSchema.parse({
          text: truncated ? tail.slice(tail.length - LOG_MAX_CHARS) : tail,
          truncated,
        });
      },
    },
    'system.clearAllData': {
      input: clearAllDataInputSchema,
      handle: async () => {
        // 生成中的任务会在清空后写回已删除的行,先要求用户等待或取消(承 v2.1 RESET_BUSY)。
        if (hasActiveImageJobs()) {
          throw new BridgeError('CLEAR_BUSY', '仍有图片生成任务,请等待完成或取消后再清空数据');
        }
        try {
          const { backupPath } = await resetBusinessData('RESET');
          return clearAllDataResultSchema.parse({ safetyBackupFile: basename(backupPath) });
        } catch (error) {
          throw new BridgeError(
            'CLEAR_FAILED',
            pathFreeMessage(
              messageWithoutCodePrefix(error, codeOf(error)),
              '清空数据失败,数据未被改动',
            ),
          );
        }
      },
    },
    'system.openExternal': {
      input: openExternalInputSchema,
      handle: async (payload) => {
        const { url } = payload as z.infer<typeof openExternalInputSchema>;
        if (!isAllowedExternalUrl(url)) {
          throw new BridgeError('FORBIDDEN', '不允许打开该链接');
        }
        await shell.openExternal(url);
        return null;
      },
    },
    'system.openProductDocs': {
      input: noInput,
      handle: async () => {
        try {
          await openAboutResource('product-docs');
        } catch {
          throw new BridgeError('DOCS_OPEN_FAILED', '文档打开失败,请检查安装文件是否完整');
        }
        return null;
      },
    },
    'system.relaunch': {
      input: noInput,
      handle: async () => {
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, RELAUNCH_DELAY_MS);
        return null;
      },
    },
  };
}
