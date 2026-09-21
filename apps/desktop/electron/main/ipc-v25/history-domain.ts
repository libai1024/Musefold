import {
  purgeLocalGenerationRecords,
  tryDrainLocalAssetCleanup,
} from '@musefold/core/services/local-asset-cleanup';
// v2.5 桌面历史维护域桥(generation.* 的批量与本机文件动作,ui-parity 05 §7):
// 列表/详情/单条回收站语义在 workbench-domain.ts;本文件只装「跨行批量」与
// 「本机资产动作」四个方法,避免 workbench-domain 继续膨胀。
//
// 安全口径:渲染层只提交受管资产 id,路径解析与受管根校验全在这里;
// 返回值与错误信息一律不含绝对路径(渲染层没有路径概念)。

import { generationCleanupInputSchema, entityIdSchema } from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { getPaths } from '@musefold/core/runtime';
import { clipboard, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { collectImageDiskUsage } from '../../system/disk-usage';
import { BridgeError, type MethodDef } from './envelope';

/** 「清 30 天前」的窗口(承旧 HistoryCleanupMenu)。 */
const CLEANUP_OLDER_THAN_MS = 30 * 24 * 60 * 60_000;
/** 桌面 run 的终态集合:批量清理永不碰仍在跑的任务。 */
const TERMINAL_RUN_STATUSES = ['success', 'failed', 'cancelled'] as const;

const TERMINAL_PLACEHOLDERS = TERMINAL_RUN_STATUSES.map(() => '?').join(', ');

/**
 * 受管资产路径校验:解析后必须落在 pictures / previews / userData 之内
 * (与 media-protocol.ts 读盘通道同款约束,防目录穿越与任意路径读取)。
 */
function managedAssetPath(raw: string | null): string | null {
  if (!raw) return null;
  const target = resolve(raw);
  const paths = getPaths();
  const roots = [paths.pictures, paths.previews, paths.userData].map((root) => resolve(root));
  return roots.some((root) => target === root || target.startsWith(root + sep)) ? target : null;
}

/** 按资产 id 取受管绝对路径;不存在 / 越界 / 文件缺失都拒绝,错误文案不含路径。 */
function requireAssetPath(assetId: string): string {
  const row = getDb()
    .prepare('SELECT media_path, status FROM generated_assets WHERE id = ?')
    .get(assetId) as { media_path: string | null; status: string } | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', '图片资产不存在');
  const path = row.status === 'available' ? managedAssetPath(row.media_path) : null;
  if (!path || !existsSync(path)) {
    throw new BridgeError('VALIDATION_FAILED', '图片文件不存在或不可访问');
  }
  return path;
}

/** 软删入回收站:资产文件保留,记录可恢复。返回受影响条数。 */
function softDeleteRuns(where: string, args: unknown[]): number {
  const result = getDb()
    .prepare(
      `UPDATE generation_runs SET deleted_at = ?
       WHERE deleted_at IS NULL AND status IN (${TERMINAL_PLACEHOLDERS}) AND ${where}`,
    )
    .run(Date.now(), ...TERMINAL_RUN_STATUSES, ...args);
  return result.changes;
}

/**
 * 清空回收站:与单条 generation.purge 同一语义 —— 先删行(资产行级联),
 * 同事务保留磁盘清理意图,再按受管路径/引用/文件身份清理；失败可跨重启重试。
 */
function emptyTrash(): number {
  const db = getDb();
  const doomed = db
    .prepare(
      `SELECT id FROM generation_runs
       WHERE deleted_at IS NOT NULL AND status IN (${TERMINAL_PLACEHOLDERS})`,
    )
    .all(...TERMINAL_RUN_STATUSES) as Array<{ id: string }>;
  if (doomed.length === 0) return 0;
  const affected = purgeLocalGenerationRecords(
    doomed.map((row) => row.id),
    db,
  );
  tryDrainLocalAssetCleanup();
  return affected;
}

export function buildHistoryDomainMethods(): Record<string, MethodDef> {
  return {
    'generation.cleanup': {
      input: generationCleanupInputSchema,
      handle: async (input) => {
        const { scope } = input as z.output<typeof generationCleanupInputSchema>;
        if (scope === 'empty-trash') return { affected: emptyTrash() };
        if (scope === 'failed-and-cancelled') {
          return { affected: softDeleteRuns('status IN (?, ?)', ['failed', 'cancelled']) };
        }
        return {
          affected: softDeleteRuns('created_at < ?', [Date.now() - CLEANUP_OLDER_THAN_MS]),
        };
      },
    },
    'generation.getStorageUsage': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const usage = await collectImageDiskUsage(getPaths().pictures);
        // 只回聚合数字:usage.dir 是绝对路径,不进渲染层。
        return { bytes: usage.imagesBytes, fileCount: usage.imagesCount };
      },
    },
    'generation.revealAsset': {
      input: entityIdSchema,
      handle: async (assetId) => {
        shell.showItemInFolder(requireAssetPath(assetId as string));
        return undefined;
      },
    },
    'generation.copyAssetToClipboard': {
      input: entityIdSchema,
      handle: async (assetId) => {
        const image = nativeImage.createFromPath(requireAssetPath(assetId as string));
        if (image.isEmpty()) throw new BridgeError('VALIDATION_FAILED', '图片无法读取为剪贴板内容');
        clipboard.writeImage(image);
        return undefined;
      },
    },
  };
}
