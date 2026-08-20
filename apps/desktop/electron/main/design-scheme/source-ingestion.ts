/**
 * 来源治理切片：把 GitHub 仓库固化为「固定 commit 快照」写入 design-scheme 库。
 * 复用 skill-import 的 github-reader（归档下载 + 预算 + 许可证识别）。
 */
import { createHash, randomUUID } from 'crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import type Database from 'better-sqlite3';
import { readPublicGithubAgentSkillRuntimeSource } from '../skill-import/github-reader';
import type { AgentSkillRuntimeFile } from '../skill-import/zip-reader';
import { ok, type AppResult } from '@musefold/domain/app-result';
import type {
  DesignSchemeHistorySourceItem,
  DesignSchemeSourceConfirmation,
} from '@shared/types/design-scheme';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { getPaths } from '../../system/paths';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const MAX_SNAPSHOT_IMAGES = 24;

export interface ResolvedGithubSource {
  repositoryUrl: string;
  repositoryLabel: string;
  name: string;
  description: string;
  resolvedRef: string;
  commitHash: string | null;
  license: string | null;
  textFiles: Array<{ path: string; contentHash: string; sizeBytes: number; text: string }>;
  imageFiles: AgentSkillRuntimeFile[];
  otherCount: number;
}

function extensionOf(path: string): string {
  const base = path.split('/').at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

export function repositoryLabelOf(repositoryUrl: string): string {
  const match = repositoryUrl.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return (match?.[1] ?? repositoryUrl).replace(/\.git$/, '');
}

/** 下载并整理仓库内容；不写库，先供安装确认层展示。 */
export async function resolveGithubSource(repositoryUrl: string): Promise<AppResult<ResolvedGithubSource>> {
  const read = await readPublicGithubAgentSkillRuntimeSource({ repositoryUrl });
  if (!read.ok) return read;
  const { scan, resolvedRef, commitHash, runtimeFiles } = read.data;

  const byPath = new Map((runtimeFiles ?? []).map((file) => [file.relativePath, file]));
  const textFiles: ResolvedGithubSource['textFiles'] = [];
  const imageFiles: AgentSkillRuntimeFile[] = [];
  let otherCount = 0;

  for (const file of scan.files) {
    const runtimeFile = byPath.get(file.relativePath);
    if (typeof file.textContent === 'string') {
      textFiles.push({
        path: file.relativePath,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
        text: file.textContent,
      });
      continue;
    }
    if (runtimeFile && IMAGE_EXTENSIONS.has(extensionOf(file.relativePath)) && imageFiles.length < MAX_SNAPSHOT_IMAGES) {
      imageFiles.push(runtimeFile);
      continue;
    }
    otherCount += 1;
  }

  return ok({
    repositoryUrl,
    repositoryLabel: repositoryLabelOf(repositoryUrl),
    name: scan.name,
    description: scan.description,
    resolvedRef,
    commitHash,
    license: scan.licenseText ? scan.licenseText.split('\n')[0]?.slice(0, 200) ?? null : null,
    textFiles,
    imageFiles,
    otherCount,
  });
}

export function toSourceConfirmation(source: ResolvedGithubSource): DesignSchemeSourceConfirmation {
  return {
    repositoryUrl: source.repositoryUrl,
    name: source.name,
    description: source.description,
    resolvedRef: source.resolvedRef,
    commitHash: source.commitHash,
    textFileCount: source.textFiles.length,
    textNames: source.textFiles.map((file) => file.path).slice(0, 12),
    imageFileCount: source.imageFiles.length,
    license: source.license,
  };
}

export interface PersistedSnapshot {
  packageId: string;
  snapshotId: string;
  /** 参考图落盘后的绝对路径（按仓库相对路径命名）。 */
  imagePaths: Array<{ path: string; absolutePath: string }>;
}

/** 用户确认后：参考图落盘 + 文本入库，形成固定 commit 快照。 */
export function persistGithubSnapshot(
  db: Database.Database,
  source: ResolvedGithubSource,
  userData = getPaths().userData,
): PersistedSnapshot {
  const repository = new DesignSchemeRepository(db);
  const snapshotId = `snap_${randomUUID()}`;
  const packageId = `pkg_${createHash('sha256').update(source.repositoryUrl).digest('hex').slice(0, 24)}`;
  const snapshotDir = join(userData, 'design-scheme-sources', snapshotId);

  const imagePaths: PersistedSnapshot['imagePaths'] = [];
  const imageRows = source.imageFiles.map((file) => {
    const absolutePath = join(snapshotDir, file.relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.bytes);
    imagePaths.push({ path: file.relativePath, absolutePath });
    return {
      path: file.relativePath,
      kind: 'image' as const,
      contentHash: file.contentHash,
      sizeBytes: file.bytes.byteLength,
      storeKey: join('design-scheme-sources', snapshotId, file.relativePath),
    };
  });

  const textRows = source.textFiles.map((file) => ({
    path: file.path,
    kind: 'text' as const,
    contentHash: file.contentHash,
    sizeBytes: file.sizeBytes,
    textContent: file.text,
  }));

  const totalBytes = textRows.reduce((sum, row) => sum + row.sizeBytes, 0)
    + imageRows.reduce((sum, row) => sum + row.sizeBytes, 0);

  repository.saveSourceSnapshot({
    package: {
      id: packageId,
      kind: 'github',
      repositoryUrl: source.repositoryUrl,
      license: source.license ?? undefined,
    },
    snapshot: {
      id: snapshotId,
      ref: source.resolvedRef,
      commitHash: source.commitHash,
      totalBytes,
      scan: {
        name: source.name,
        description: source.description,
        textFileCount: source.textFiles.length,
        imageFileCount: source.imageFiles.length,
        otherCount: source.otherCount,
      },
    },
    files: [...textRows, ...imageRows],
  });

  return { packageId, snapshotId, imagePaths };
}

export interface PersistedHistorySnapshot {
  packageId: string;
  snapshotId: string;
  /** 快照内固化后的图片绝对路径（与请求条目一一对应，读取失败的条目被剔除）。 */
  items: Array<DesignSchemeHistorySourceItem & { snapshotImagePath: string }>;
}

/**
 * 历史来源快照：把用户挑选的历史作品复制进快照目录固化（快照不可变；
 * 原历史记录之后被删除也不影响方案来源）。本地内容不需要安装确认。
 */
export function persistHistorySnapshot(
  db: Database.Database,
  items: DesignSchemeHistorySourceItem[],
  userData = getPaths().userData,
): PersistedHistorySnapshot {
  const repository = new DesignSchemeRepository(db);
  const snapshotId = `snap_${randomUUID()}`;
  const packageId = `pkg_hist_${randomUUID().slice(0, 20)}`;
  const snapshotDir = join(userData, 'design-scheme-sources', snapshotId);

  const persistedItems: PersistedHistorySnapshot['items'] = [];
  const fileRows: Array<{
    path: string;
    kind: 'text' | 'image';
    contentHash: string;
    sizeBytes: number;
    storeKey?: string;
    textContent?: string;
  }> = [];

  for (const item of items) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(item.imagePath);
    } catch {
      continue; // 历史图片文件已不存在：跳过该条，不阻塞创建。
    }
    const extension = extname(item.imagePath) || '.png';
    const relativePath = `history/${item.historyId}${extension}`;
    const absolutePath = join(snapshotDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    copyFileSync(item.imagePath, absolutePath);
    fileRows.push({
      path: relativePath,
      kind: 'image',
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
      storeKey: join('design-scheme-sources', snapshotId, relativePath),
    });
    if (item.promptText?.trim()) {
      const text = item.promptText.trim();
      fileRows.push({
        path: `history/${item.historyId}.prompt.txt`,
        kind: 'text',
        contentHash: createHash('sha256').update(text).digest('hex'),
        sizeBytes: Buffer.byteLength(text),
        textContent: text,
      });
    }
    persistedItems.push({ ...item, snapshotImagePath: absolutePath });
  }

  repository.saveSourceSnapshot({
    package: { id: packageId, kind: 'history' },
    snapshot: {
      id: snapshotId,
      ref: 'history',
      commitHash: null,
      totalBytes: fileRows.reduce((sum, row) => sum + row.sizeBytes, 0),
      scan: {
        name: '历史内容',
        description: '用户挑选的历史作品与提示词',
        textFileCount: fileRows.filter((row) => row.kind === 'text').length,
        imageFileCount: fileRows.filter((row) => row.kind === 'image').length,
        otherCount: 0,
      },
    },
    files: fileRows,
  });

  return { packageId, snapshotId, items: persistedItems };
}
