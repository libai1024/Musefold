import { createHash } from 'crypto';
import { lstat } from 'fs/promises';
import * as yauzl from 'yauzl';
import { appError, fail, ok, type AppError, type AppResult } from '@musefold/domain/app-result';
import {
  classifyAgentSkillFile,
  scanAgentSkillFiles,
  type AgentSkillFileInput,
  type AgentSkillScanResult,
} from './skill-scanner';
import {
  SKILL_MAX_ENTRIES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_TEXT_BYTES,
  SKILL_MAX_TEXT_FILE_BYTES,
  SKILL_MAX_TEXT_FILES,
  SKILL_MAX_TOTAL_BYTES,
} from './source-reader';

export const SKILL_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const SKILL_MAX_COMPRESSION_RATIO = 100;
export const SKILL_MAX_ARCHIVE_ENTRIES = 5_000;

export interface ReadZipAgentSkillOptions {
  /** Optional path inside a repository archive, without the packaging root. */
  skillPath?: string;
}

export interface AgentSkillRuntimeFile {
  relativePath: string;
  contentHash: string;
  bytes: Uint8Array;
}

export interface AgentSkillRuntimeBundle {
  scan: AgentSkillScanResult;
  files: AgentSkillRuntimeFile[];
}

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const IGNORED_SEGMENTS = new Set(['.git', '.hg', '.svn', '__MACOSX', 'node_modules']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

type ZipEntryDescriptor = Pick<
  yauzl.Entry,
  'fileName' | 'versionMadeBy' | 'externalFileAttributes'
>;

type PlannedZipFile = {
  entry: yauzl.Entry;
  relativePath: string;
};

class SkillZipError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
    this.name = 'SkillZipError';
  }
}

function zipError(
  code: AppError['code'],
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return appError(code, message, {
    retryable: false,
    recoveryAction: 'select-source',
    ...(details ? { details } : {}),
  });
}

function rejectZip(error: AppError): never {
  throw new SkillZipError(error);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function utf8Text(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function normalizeZipPath(fileName: string): AppResult<string> {
  const withoutTrailingSlash = fileName.endsWith('/') ? fileName.slice(0, -1) : fileName;
  const segments = withoutTrailingSlash.split('/');
  if (
    !withoutTrailingSlash
    || withoutTrailingSlash.length > 1_024
    || fileName.includes('\\')
    || fileName.includes('\0')
    || withoutTrailingSlash.startsWith('/')
    || /^[a-zA-Z]:\//.test(withoutTrailingSlash)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return fail(zipError('INVALID_TYPE', `ZIP 包含不安全路径：${fileName}`, { entryName: fileName }));
  }
  return ok(withoutTrailingSlash);
}

export function validateZipEntryFileType(entry: ZipEntryDescriptor): AppResult<'file' | 'directory'> {
  const normalized = normalizeZipPath(entry.fileName);
  if (!normalized.ok) return normalized;
  const isDirectoryName = entry.fileName.endsWith('/');
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixMode = hostSystem === 3 ? entry.externalFileAttributes >>> 16 : 0;
  const unixType = unixMode & UNIX_FILE_TYPE_MASK;
  if (unixType === UNIX_SYMLINK) {
    return fail(zipError('INVALID_TYPE', `ZIP 不允许包含符号链接：${normalized.data}`, {
      entryName: normalized.data,
    }));
  }
  if (unixType !== 0 && unixType !== UNIX_REGULAR_FILE && unixType !== UNIX_DIRECTORY) {
    return fail(zipError('INVALID_TYPE', `ZIP 不允许包含设备或特殊文件：${normalized.data}`, {
      entryName: normalized.data,
      unixType,
    }));
  }
  if (isDirectoryName || unixType === UNIX_DIRECTORY) return ok('directory');
  return ok('file');
}

function isIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment))
    || IGNORED_FILES.has(segments.at(-1) ?? '');
}

function openZip(absolutePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(absolutePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(new SkillZipError(zipError('INVALID_TYPE', 'ZIP 文件损坏或格式不受支持')));
        return;
      }
      resolve(zipFile);
    });
  });
}

function listZipEntries(zipFile: yauzl.ZipFile, maxEntries: number): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    let settled = false;
    const failOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof SkillZipError
        ? error
        : new SkillZipError(zipError('INVALID_TYPE', 'ZIP 目录结构损坏或不可读取')));
    };
    zipFile.on('error', failOnce);
    zipFile.on('entry', (entry: yauzl.Entry) => {
      if (settled) return;
      entries.push(entry);
      if (entries.length > maxEntries) {
        failOnce(new SkillZipError(zipError(
          'TOO_MANY_ITEMS',
          `ZIP 目录项不能超过 ${maxEntries} 个`,
          { maxEntries },
        )));
        return;
      }
      zipFile.readEntry();
    });
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

function stripSingleArchiveRoot(paths: string[]): AppResult<Map<string, string>> {
  if (paths.includes('SKILL.md')) return ok(new Map(paths.map((path) => [path, path])));
  const skillPaths = paths.filter((path) => path.endsWith('/SKILL.md'));
  if (skillPaths.length !== 1) {
    return fail(zipError('MISSING_REFERENCE', 'ZIP 根目录中没有唯一的 SKILL.md'));
  }
  const prefix = skillPaths[0].slice(0, -'SKILL.md'.length);
  // GitHub repository archives commonly contain a README or license beside a
  // single nested Skill directory. Those repository-level files are outside
  // the Skill boundary and must not make an otherwise unambiguous Skill fail.
  const selected = paths.filter((path) => path.startsWith(prefix));
  if (selected.length === 0) {
    return fail(zipError('MISSING_REFERENCE', 'ZIP 中的 SKILL.md 不在唯一打包根目录内'));
  }
  return ok(new Map(selected.map((path) => [path, path.slice(prefix.length)])));
}

function selectSkillArchivePaths(
  paths: string[],
  skillPath: string | undefined,
): AppResult<Map<string, string>> {
  if (!skillPath) return stripSingleArchiveRoot(paths);
  const normalized = normalizeZipPath(skillPath.replace(/\/$/, ''));
  if (!normalized.ok) return normalized;
  const suffix = `${normalized.data}/SKILL.md`;
  const skillEntries = paths.filter((path) => path === suffix || path.endsWith(`/${suffix}`));
  if (skillEntries.length !== 1) {
    return fail(zipError('MISSING_REFERENCE', 'ZIP 指定目录中没有唯一的 SKILL.md', {
      skillPath: normalized.data,
    }));
  }
  const skillEntry = skillEntries[0];
  const prefix = skillEntry.slice(0, -'SKILL.md'.length);
  const selected = paths.filter((path) => path.startsWith(prefix));
  if (selected.length > SKILL_MAX_ENTRIES) {
    return fail(zipError('TOO_MANY_ITEMS', `Skill 目录项不能超过 ${SKILL_MAX_ENTRIES} 个`, {
      maxEntries: SKILL_MAX_ENTRIES,
    }));
  }
  return ok(new Map(selected.map((path) => [path, path.slice(prefix.length)])));
}

function planZipFiles(entries: yauzl.Entry[], skillPath?: string): AppResult<PlannedZipFile[]> {
  const safeFiles: Array<{ entry: yauzl.Entry; path: string }> = [];
  for (const entry of entries) {
    const normalized = normalizeZipPath(entry.fileName);
    if (!normalized.ok) return normalized;
    const fileType = validateZipEntryFileType(entry);
    if (!fileType.ok) return fileType;
    if (fileType.data === 'directory' || isIgnoredPath(normalized.data)) continue;
    if (entry.isEncrypted()) {
      return fail(zipError('INVALID_TYPE', `ZIP 不支持加密条目：${normalized.data}`, {
        entryName: normalized.data,
      }));
    }
    safeFiles.push({ entry, path: normalized.data });
  }

  const strippedPaths = selectSkillArchivePaths(safeFiles.map((file) => file.path), skillPath);
  if (!strippedPaths.ok) return strippedPaths;
  const planned = safeFiles.flatMap(({ entry, path }) => {
    const relativePath = strippedPaths.data.get(path);
    return relativePath ? [{ entry, relativePath }] : [];
  });
  const duplicate = planned.find((file, index) => (
    planned.findIndex((candidate) => candidate.relativePath === file.relativePath) !== index
  ));
  if (duplicate) {
    return fail(zipError('DUPLICATE_KEY', `ZIP 包含重复文件路径：${duplicate.relativePath}`, {
      entryName: duplicate.relativePath,
    }));
  }

  let textFiles = 0;
  let textBytes = 0;
  let totalBytes = 0;
  let compressedBytes = 0;
  for (const file of planned) {
    const { entry, relativePath } = file;
    if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize)) {
      return fail(zipError('INVALID_RANGE', `ZIP 条目大小无效：${relativePath}`));
    }
    if (entry.uncompressedSize > SKILL_MAX_FILE_BYTES) {
      return fail(zipError('INVALID_RANGE', `ZIP 文件解压后过大：${relativePath}`, {
        entryName: relativePath,
        maxBytes: SKILL_MAX_FILE_BYTES,
      }));
    }
    const fileKind = classifyAgentSkillFile(relativePath);
    if (fileKind !== 'asset') {
      textFiles += 1;
      textBytes += entry.uncompressedSize;
      if (entry.uncompressedSize > SKILL_MAX_TEXT_FILE_BYTES) {
        return fail(zipError('INVALID_RANGE', `ZIP 文本文件解压后过大：${relativePath}`, {
          entryName: relativePath,
          maxBytes: SKILL_MAX_TEXT_FILE_BYTES,
        }));
      }
    }
    totalBytes += entry.uncompressedSize;
    compressedBytes += entry.compressedSize;
    if (entry.uncompressedSize > 0 && (
      entry.compressedSize === 0
      || entry.uncompressedSize / entry.compressedSize > SKILL_MAX_COMPRESSION_RATIO
    )) {
      return fail(zipError('INVALID_RANGE', `ZIP 条目压缩比过高：${relativePath}`, {
        entryName: relativePath,
        maxCompressionRatio: SKILL_MAX_COMPRESSION_RATIO,
      }));
    }
  }
  if (textFiles > SKILL_MAX_TEXT_FILES) {
    return fail(zipError('TOO_MANY_ITEMS', `ZIP 文本文件数量不能超过 ${SKILL_MAX_TEXT_FILES} 个`, {
      maxTextFiles: SKILL_MAX_TEXT_FILES,
    }));
  }
  if (textBytes > SKILL_MAX_TEXT_BYTES || totalBytes > SKILL_MAX_TOTAL_BYTES) {
    return fail(zipError('INVALID_RANGE', 'ZIP 解压后的内容总大小超过安全限制', {
      maxTextBytes: SKILL_MAX_TEXT_BYTES,
      maxTotalBytes: SKILL_MAX_TOTAL_BYTES,
    }));
  }
  if (totalBytes > 0 && (compressedBytes === 0 || totalBytes / compressedBytes > SKILL_MAX_COMPRESSION_RATIO)) {
    return fail(zipError('INVALID_RANGE', 'ZIP 整体压缩比超过安全限制', {
      maxCompressionRatio: SKILL_MAX_COMPRESSION_RATIO,
    }));
  }
  return ok(planned);
}

function readZipEntry(zipFile: yauzl.ZipFile, file: PlannedZipFile): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(file.entry, (openError, stream) => {
      if (openError || !stream) {
        reject(new SkillZipError(zipError('INVALID_TYPE', `无法读取 ZIP 条目：${file.relativePath}`)));
        return;
      }
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      stream.on('data', (chunk: Buffer | Uint8Array) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesRead += buffer.byteLength;
        if (bytesRead > file.entry.uncompressedSize || bytesRead > SKILL_MAX_FILE_BYTES) {
          stream.destroy(new SkillZipError(zipError('INVALID_RANGE', `ZIP 条目读取超限：${file.relativePath}`)));
          return;
        }
        chunks.push(buffer);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        if (bytesRead !== file.entry.uncompressedSize) {
          reject(new SkillZipError(zipError('INVALID_TYPE', `ZIP 条目大小校验失败：${file.relativePath}`)));
          return;
        }
        resolve(Buffer.concat(chunks, bytesRead));
      });
    });
  });
}

export async function readZipAgentSkillRuntimeBundle(
  absolutePath: string,
  options: ReadZipAgentSkillOptions = {},
): Promise<AppResult<AgentSkillRuntimeBundle>> {
  let zipFile: yauzl.ZipFile | null = null;
  try {
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      return fail(zipError('INVALID_TYPE', '所选 ZIP 不是普通文件'));
    }
    if (info.size > SKILL_MAX_ARCHIVE_BYTES) {
      return fail(zipError('INVALID_RANGE', 'ZIP 文件本身超过安全限制', {
        maxArchiveBytes: SKILL_MAX_ARCHIVE_BYTES,
      }));
    }
    zipFile = await openZip(absolutePath);
    const entries = await listZipEntries(
      zipFile,
      options.skillPath ? SKILL_MAX_ARCHIVE_ENTRIES : SKILL_MAX_ENTRIES,
    );
    const plan = planZipFiles(entries, options.skillPath);
    if (!plan.ok) return plan;

    const files: AgentSkillFileInput[] = [];
    const runtimeFiles: AgentSkillRuntimeFile[] = [];
    for (const file of plan.data) {
      const bytes = await readZipEntry(zipFile, file);
      const fileKind = classifyAgentSkillFile(file.relativePath);
      const contentHash = sha256(bytes);
      files.push({
        relativePath: file.relativePath,
        contentHash,
        sizeBytes: bytes.byteLength,
        textContent: fileKind === 'asset' ? null : utf8Text(bytes),
      });
      runtimeFiles.push({ relativePath: file.relativePath, contentHash, bytes });
    }
    const scan = scanAgentSkillFiles(files);
    return scan.ok ? ok({ scan: scan.data, files: runtimeFiles }) : scan;
  } catch (error) {
    if (error instanceof SkillZipError) return fail(error.appError);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    return fail(zipError(
      code === 'ENOENT' ? 'MISSING_REFERENCE' : 'INVALID_TYPE',
      code === 'ENOENT' ? '所选 ZIP 已经不存在，请重新选择' : 'ZIP 文件损坏或无法安全读取',
      code ? { systemCode: code } : undefined,
    ));
  } finally {
    if (zipFile?.isOpen) zipFile.close();
  }
}

export async function readZipAgentSkillSource(
  absolutePath: string,
  options: ReadZipAgentSkillOptions = {},
): Promise<AppResult<AgentSkillScanResult>> {
  const result = await readZipAgentSkillRuntimeBundle(absolutePath, options);
  return result.ok ? ok(result.data.scan) : result;
}
