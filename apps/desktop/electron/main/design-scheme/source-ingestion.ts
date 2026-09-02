/**
 * 来源治理切片：把 GitHub 仓库固化为「固定 commit 快照」写入 design-scheme 库。
 * 复用 skill-import 的 github-reader（归档下载 + 预算 + 许可证识别）。
 */
import { createHash, randomUUID } from 'crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import type Database from 'better-sqlite3';
import { readPublicGithubAgentSkillRuntimeSource } from '../skill-import/github-reader';
import type { AgentSkillRuntimeFile } from '../skill-import/zip-reader';
import { ok, type AppResult } from '@musefold/domain/app-result';
import type {
  DesignSchemeHistorySourceItem,
  DesignSchemeSourceConfirmation,
} from '@musefold/desktop-contracts/design-scheme';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { resolveManagedMediaFile } from './asset-store';
import { probeImageSize } from './evaluation';
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

// ---------------------------------------------------------------------------
// v6 真实文件元数据探测（主进程专用）：stat / sha256 / 魔数 / 尺寸。
// 全部基于真实读取，任何一步失败返回 null —— 读模型据此省略该资产，绝不伪造。
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ProbedAssetMetadata {
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentHash: string;
}

/** 魔数嗅探图片 MIME；无法识别返回 null（扩展名不可信）。接受 Buffer/Uint8Array。 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'image/avif';
  return null;
}

/** 文本类来源文件按扩展名给 MIME（内容已被固化为 UTF-8 文本）。 */
export function textMimeTypeForPath(path: string): string {
  const extension = extensionOf(path);
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.json') return 'application/json';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.html' || extension === '.htm') return 'text/html';
  return 'text/plain';
}

/**
 * 探测本地图片文件的完整 canonical 元数据（尺寸解析复用质量门的 probeImageSize，
 * 只支持生图产物格式 PNG/JPEG/WebP；其余格式缺尺寸 → null → 详情省略该资产）。
 */
export function probeImageAssetMetadata(absolutePath: string): ProbedAssetMetadata | null {
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const buffer = readFileSync(absolutePath);
    const mimeType = sniffImageMimeType(buffer);
    if (!mimeType) return null;
    const size = probeImageSize(absolutePath);
    if (!size || size.width <= 0 || size.height <= 0) return null;
    return {
      mimeType,
      width: size.width,
      height: size.height,
      byteSize: buffer.byteLength,
      contentHash: createHash('sha256').update(buffer).digest('hex'),
    };
  } catch {
    return null; // 缺失 / 不可读 / 非常规文件：交由调用方省略，不伪造。
  }
}

/** 下载并整理仓库内容；不写库，先供安装确认层展示。 */
export async function resolveGithubSource(
  repositoryUrl: string,
): Promise<AppResult<ResolvedGithubSource>> {
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
    if (
      runtimeFile &&
      IMAGE_EXTENSIONS.has(extensionOf(file.relativePath)) &&
      imageFiles.length < MAX_SNAPSHOT_IMAGES
    ) {
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
    license: scan.licenseText ? (scan.licenseText.split('\n')[0]?.slice(0, 200) ?? null) : null,
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
      // v6：真实字节魔数嗅探，识别不了记 null（不按扩展名伪造）。
      mimeType: sniffImageMimeType(file.bytes),
    };
  });

  const textRows = source.textFiles.map((file) => ({
    path: file.path,
    kind: 'text' as const,
    contentHash: file.contentHash,
    sizeBytes: file.sizeBytes,
    textContent: file.text,
    mimeType: textMimeTypeForPath(file.path),
  }));

  const totalBytes =
    textRows.reduce((sum, row) => sum + row.sizeBytes, 0) +
    imageRows.reduce((sum, row) => sum + row.sizeBytes, 0);

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
 *
 * 条目路径是不可信输入（历史调用方来自渲染层）：只接受受管根
 * （userData/pictures）内的常规文件；越根路径、symlink 与已消失文件同样
 * 跳过该条，不阻塞创建，也绝不读盘外文件。
 */
export function persistHistorySnapshot(
  db: Database.Database,
  items: DesignSchemeHistorySourceItem[],
  userData = getPaths().userData,
  picturesDir = getPaths().pictures,
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
    mimeType?: string | null;
  }> = [];

  for (const item of items) {
    const managed = resolveManagedMediaFile(item.imagePath, userData, picturesDir);
    if (!managed) {
      continue; // 越根/symlink/已不存在：与旧「文件已不存在」同语义，跳过不阻塞。
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(managed.path);
    } catch {
      continue; // 历史图片文件已不存在：跳过该条，不阻塞创建。
    }
    const extension = extname(managed.path) || '.png';
    const relativePath = `history/${item.historyId}${extension}`;
    const absolutePath = join(snapshotDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    copyFileSync(managed.path, absolutePath);
    fileRows.push({
      path: relativePath,
      kind: 'image',
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
      storeKey: join('design-scheme-sources', snapshotId, relativePath),
      mimeType: sniffImageMimeType(bytes),
    });
    if (item.promptText?.trim()) {
      const text = item.promptText.trim();
      fileRows.push({
        path: `history/${item.historyId}.prompt.txt`,
        kind: 'text',
        contentHash: createHash('sha256').update(text).digest('hex'),
        sizeBytes: Buffer.byteLength(text),
        textContent: text,
        mimeType: 'text/plain',
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
