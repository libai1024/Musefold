import { createHash } from 'crypto';
import { lstat, readFile, readdir } from 'fs/promises';
import { relative, resolve, sep } from 'path';
import { appError, fail, ok, type AppError, type AppResult } from '@shared/app-result';
import {
  classifyAgentSkillFile,
  scanAgentSkillFiles,
  type AgentSkillFileInput,
  type AgentSkillScanResult,
} from '@shared/skill-scanner';

export const SKILL_MAX_ENTRIES = 500;
export const SKILL_MAX_TEXT_FILES = 100;
export const SKILL_MAX_TEXT_FILE_BYTES = 1 * 1024 * 1024;
export const SKILL_MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const SKILL_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const SKILL_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const IGNORED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

type ReadableLocalSkillSourceKind = 'local_folder' | 'local_file';

export interface LocalSkillReadRequest {
  sourceKind: ReadableLocalSkillSourceKind;
  absolutePath: string;
}

class LocalSkillReadError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
    this.name = 'LocalSkillReadError';
  }
}

function rejectRead(error: AppError): never {
  throw new LocalSkillReadError(error);
}

function safeReadError(
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

function canonicalRelativePath(relativePath: string): string {
  const normalized = relativePath.split(sep).join('/');
  return !normalized.includes('/') && normalized.toLowerCase() === 'skill.md'
    ? 'SKILL.md'
    : normalized;
}

function ensureInsideRoot(root: string, candidate: string, relativePath: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    rejectRead(safeReadError('INVALID_TYPE', 'Skill 文件路径超出所选目录', { relativePath }));
  }
}

async function readRegularFile(
  absolutePath: string,
  relativePath: string,
  state: { entryCount: number; textFileCount: number; textBytes: number; totalBytes: number },
): Promise<AgentSkillFileInput> {
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) {
    rejectRead(safeReadError('INVALID_TYPE', `Skill 不允许包含符号链接：${relativePath}`, { relativePath }));
  }
  if (!info.isFile()) {
    rejectRead(safeReadError('INVALID_TYPE', `Skill 只允许普通文件：${relativePath}`, { relativePath }));
  }
  const canonicalPath = canonicalRelativePath(relativePath);
  const fileKind = classifyAgentSkillFile(canonicalPath);
  const isTextFile = fileKind !== 'asset';
  if (info.size > SKILL_MAX_FILE_BYTES) {
    rejectRead(safeReadError('INVALID_RANGE', `Skill 文件过大：${relativePath}`, {
      relativePath,
      maxBytes: SKILL_MAX_FILE_BYTES,
    }));
  }
  if (isTextFile && info.size > SKILL_MAX_TEXT_FILE_BYTES) {
    rejectRead(safeReadError('INVALID_RANGE', `Skill 文本文件过大：${relativePath}`, {
      relativePath,
      maxBytes: SKILL_MAX_TEXT_FILE_BYTES,
    }));
  }
  state.totalBytes += info.size;
  if (isTextFile) {
    state.textFileCount += 1;
    state.textBytes += info.size;
  }
  if (state.textFileCount > SKILL_MAX_TEXT_FILES) {
    rejectRead(safeReadError('TOO_MANY_ITEMS', `Skill 文本文件数量不能超过 ${SKILL_MAX_TEXT_FILES} 个`, {
      maxTextFiles: SKILL_MAX_TEXT_FILES,
    }));
  }
  if (state.textBytes > SKILL_MAX_TEXT_BYTES) {
    rejectRead(safeReadError('INVALID_RANGE', 'Skill 文本总大小超过安全限制', {
      maxTextBytes: SKILL_MAX_TEXT_BYTES,
    }));
  }
  if (state.totalBytes > SKILL_MAX_TOTAL_BYTES) {
    rejectRead(safeReadError('INVALID_RANGE', 'Skill 文件总大小超过安全限制', {
      maxBytes: SKILL_MAX_TOTAL_BYTES,
    }));
  }

  const bytes = await readFile(absolutePath);
  return {
    relativePath: canonicalPath,
    contentHash: sha256(bytes),
    sizeBytes: bytes.byteLength,
    textContent: fileKind === 'asset' ? null : utf8Text(bytes),
  };
}

async function readDirectoryFiles(root: string): Promise<AgentSkillFileInput[]> {
  const files: AgentSkillFileInput[] = [];
  const state = { entryCount: 0, textFileCount: 0, textBytes: 0, totalBytes: 0 };

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isFile() && IGNORED_FILES.has(entry.name)) continue;
      state.entryCount += 1;
      if (state.entryCount > SKILL_MAX_ENTRIES) {
        rejectRead(safeReadError('TOO_MANY_ITEMS', `Skill 目录项不能超过 ${SKILL_MAX_ENTRIES} 个`, {
          maxEntries: SKILL_MAX_ENTRIES,
        }));
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath);
      ensureInsideRoot(root, absolutePath, relativePath);
      if (entry.isSymbolicLink()) {
        rejectRead(safeReadError('INVALID_TYPE', `Skill 不允许包含符号链接：${relativePath}`, { relativePath }));
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        rejectRead(safeReadError('INVALID_TYPE', `Skill 只允许普通文件和目录：${relativePath}`, { relativePath }));
      }
      files.push(await readRegularFile(absolutePath, relativePath, state));
    }
  }

  await visit(root);
  return files;
}

export async function readLocalAgentSkillSource(
  request: LocalSkillReadRequest,
): Promise<AppResult<AgentSkillScanResult>> {
  try {
    const rootInfo = await lstat(request.absolutePath);
    let files: AgentSkillFileInput[];
    if (request.sourceKind === 'local_file') {
      if (!rootInfo.isFile() || rootInfo.isSymbolicLink()) {
        return fail(safeReadError('INVALID_TYPE', '所选 SKILL.md 不是普通文件'));
      }
      files = [await readRegularFile(request.absolutePath, 'SKILL.md', {
        entryCount: 1,
        textFileCount: 0,
        textBytes: 0,
        totalBytes: 0,
      })];
    } else {
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        return fail(safeReadError('INVALID_TYPE', '所选 Skill 来源不是普通文件夹'));
      }
      files = await readDirectoryFiles(request.absolutePath);
    }
    return scanAgentSkillFiles(files);
  } catch (error) {
    if (error instanceof LocalSkillReadError) return fail(error.appError);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    return fail(safeReadError(
      code === 'ENOENT' ? 'MISSING_REFERENCE' : 'UNKNOWN',
      code === 'ENOENT' ? '所选 Skill 来源已经不存在，请重新选择' : '无法读取所选 Skill 来源',
      code ? { systemCode: code } : undefined,
    ));
  }
}
