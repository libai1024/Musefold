import { createHash } from 'crypto';
import { mkdir, readdir, stat, unlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { appError, fail, ok, type AppError, type AppResult } from '@musefold/domain/app-result';
import { GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE } from '@musefold/domain/constants';
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
import {
  readZipAgentSkillRuntimeBundle,
  readZipAgentSkillSource,
  SKILL_MAX_ARCHIVE_BYTES,
  type AgentSkillRuntimeBundle,
  type AgentSkillRuntimeFile,
} from './zip-reader';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_ARCHIVE_ORIGIN = 'https://codeload.github.com';
const GITHUB_RESPONSE_TIMEOUT_MS = 30_000;
/** 整包下载的总时长上限；大仓库（如 20MB+ 的示例图仓库）在慢网络下可能超过 30 秒。 */
const GITHUB_ARCHIVE_TOTAL_TIMEOUT_MS = 180_000;
/** 下载过程中持续无数据到达即视为停滞。 */
const GITHUB_ARCHIVE_IDLE_TIMEOUT_MS = 20_000;
const GITHUB_TREE_RESPONSE_BYTES = 8 * 1024 * 1024;
const GITHUB_BLOB_RESPONSE_BYTES = 24 * 1024 * 1024;
const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const GITHUB_REF = /^[A-Za-z0-9._/-]+$/;
const GIT_SHA = /^[a-f0-9]{40,64}$/i;
const IGNORED_SEGMENTS = new Set(['.git', '.github', '.hg', '.svn', '__MACOSX', 'node_modules']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const GITHUB_ARCHIVE_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export interface PublicGithubSkillRequest {
  repositoryUrl: string;
  requestedRef?: string;
  skillPath?: string;
  /** Update checks bypass the saved archive while ordinary imports reuse it. */
  refresh?: boolean;
}

export interface PublicGithubSkillReadResult {
  scan: AgentSkillScanResult;
  resolvedRef: string;
  commitHash: string | null;
  /** Present for runtime calls; import persistence continues to use scan only. */
  runtimeFiles?: AgentSkillRuntimeFile[];
}

export interface PublicGithubSkillReaderDeps {
  fetchImpl?: typeof fetch;
  archiveBaseUrl?: string;
  cacheDir?: string;
  /** Test-only compatibility path for the legacy REST fixture. */
  apiBaseUrl?: string;
}

type GithubTreeEntry = {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

type PlannedGithubFile = {
  relativePath: string;
  sha: string;
  size: number;
};

class GithubSkillError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
    this.name = 'GithubSkillError';
  }
}

function githubError(
  code: AppError['code'],
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): AppError {
  return appError(code, message, {
    retryable: options.retryable ?? false,
    recoveryAction: code === 'NETWORK_ERROR' || code === 'TIMEOUT' ? 'retry' : 'select-source',
    ...(options.details ? { details: options.details } : {}),
  });
}

function rejectGithub(error: AppError): never {
  throw new GithubSkillError(error);
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

function safeRelativePath(value: string, label: string): AppResult<string> {
  const segments = value.split('/');
  if (
    !value
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || /^[a-zA-Z]:\//.test(value)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return fail(githubError('INVALID_TYPE', `${label}包含不安全路径`, { details: { relativePath: value } }));
  }
  return ok(value);
}

function parseRepository(repositoryUrl: string): AppResult<{ owner: string; repository: string }> {
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    return fail(githubError('INVALID_TYPE', 'GitHub 仓库地址格式不正确'));
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || url.username
    || url.password
    || url.search
    || url.hash
    || segments.length !== 2
  ) {
    return fail(githubError('INVALID_TYPE', '仅支持不含凭据和参数的 github.com HTTPS 仓库地址'));
  }
  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  if (!GITHUB_SEGMENT.test(owner) || !GITHUB_SEGMENT.test(repository) || !repository) {
    return fail(githubError('INVALID_TYPE', 'GitHub 仓库所有者或名称格式不正确'));
  }
  return ok({ owner, repository });
}

function validateRef(requestedRef: string | undefined): AppResult<string | null> {
  if (!requestedRef) return ok(null);
  if (
    requestedRef.length > 200
    || !GITHUB_REF.test(requestedRef)
    || requestedRef.includes('..')
    || requestedRef.includes('//')
    || requestedRef.includes('@{')
    || requestedRef.startsWith('/')
    || requestedRef.endsWith('/')
  ) {
    return fail(githubError('INVALID_TYPE', 'GitHub 分支或标签格式不正确'));
  }
  return ok(requestedRef);
}

function validateSkillPath(skillPath: string | undefined): AppResult<string | null> {
  if (!skillPath) return ok(null);
  if (skillPath.length > 500) return fail(githubError('INVALID_TYPE', 'GitHub Skill 路径过长'));
  const path = safeRelativePath(skillPath, 'GitHub Skill 路径');
  return path.ok ? ok(path.data.replace(/\/$/, '')) : path;
}

function apiUrl(baseUrl: string, path: string): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), base);
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  options: { idleTimeoutMs?: number } = {},
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    rejectGithub(githubError('INVALID_RANGE', 'GitHub 响应超过安全大小限制', {
      details: { maxBytes },
    }));
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) rejectGithub(githubError('INVALID_RANGE', 'GitHub 响应超过安全大小限制'));
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const readNext = async (): Promise<Awaited<ReturnType<typeof reader.read>>> => {
    if (!options.idleTimeoutMs) return reader.read();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = setTimeout(() => {
            void reader.cancel().catch(() => undefined);
            reject(new GithubSkillError(githubError('TIMEOUT', 'GitHub 仓库下载超时，请重试', { retryable: true })));
          }, options.idleTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(idleTimer);
    }
  };
  while (true) {
    const next = await readNext();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      rejectGithub(githubError('INVALID_RANGE', 'GitHub 响应超过安全大小限制', {
        details: { maxBytes },
      }));
    }
    chunks.push(next.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: URL,
  maxBytes: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(GITHUB_RESPONSE_TIMEOUT_MS),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Musefold-Skill-Scanner',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    if (error instanceof GithubSkillError) throw error;
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    rejectGithub(githubError(
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      isTimeout ? 'GitHub 读取超时，请重试' : '无法连接 GitHub，请检查网络后重试',
      { retryable: true },
    ));
  }
  if (!response.ok) {
    if (response.status === 404) {
      rejectGithub(githubError(
        'MISSING_REFERENCE',
        `GitHub 仓库、版本或 Skill 路径不存在。${GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE}`,
      ));
    }
    if (response.status === 401 || response.status === 403) {
      const rateLimited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
      if (rateLimited) {
        rejectGithub(githubError('NETWORK_ERROR', 'GitHub 匿名读取额度已用尽，请稍后重试', {
          retryable: true,
          details: { status: response.status },
        }));
      }
      rejectGithub(githubError('AUTH_REQUIRED', GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE));
    }
    rejectGithub(githubError('NETWORK_ERROR', `GitHub 暂时不可用（HTTP ${response.status}）`, {
      retryable: response.status >= 500 || response.status === 429,
      details: { status: response.status },
    }));
  }
  const bytes = await readResponseBytes(response, maxBytes);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    rejectGithub(githubError('INVALID_TYPE', 'GitHub 返回了无法解析的数据'));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isIgnored(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment))
    || IGNORED_FILES.has(segments.at(-1) ?? '');
}

function planTreeFiles(treeValue: unknown, skillPath: string | null): AppResult<PlannedGithubFile[]> {
  if (!isRecord(treeValue) || !Array.isArray(treeValue.tree)) {
    return fail(githubError('INVALID_TYPE', 'GitHub 仓库树结构无效'));
  }
  if (treeValue.truncated === true) {
    return fail(githubError('TOO_MANY_ITEMS', 'GitHub 仓库树过大，请选择更具体的 Skill 目录'));
  }
  const prefix = skillPath ? `${skillPath}/` : '';
  const underRoot: GithubTreeEntry[] = [];
  for (const value of treeValue.tree) {
    if (!isRecord(value) || typeof value.path !== 'string') continue;
    if (skillPath && value.path !== skillPath && !value.path.startsWith(prefix)) continue;
    if (!skillPath && !value.path) continue;
    if (!['blob', 'tree', 'commit'].includes(String(value.type))) continue;
    const relativePath = skillPath
      ? value.path === skillPath ? '' : value.path.slice(prefix.length)
      : value.path;
    if (!relativePath) continue;
    const safePath = safeRelativePath(relativePath, 'GitHub 仓库树');
    if (!safePath.ok) return safePath;
    if (isIgnored(relativePath)) continue;
    underRoot.push({
      path: relativePath,
      mode: typeof value.mode === 'string' ? value.mode : '',
      type: value.type as GithubTreeEntry['type'],
      sha: typeof value.sha === 'string' ? value.sha : '',
      ...(typeof value.size === 'number' ? { size: value.size } : {}),
    });
    if (underRoot.length > SKILL_MAX_ENTRIES) {
      return fail(githubError('TOO_MANY_ITEMS', `GitHub Skill 目录项不能超过 ${SKILL_MAX_ENTRIES} 个`));
    }
  }

  const files: PlannedGithubFile[] = [];
  let textFiles = 0;
  let textBytes = 0;
  let totalBytes = 0;
  for (const entry of underRoot) {
    if (entry.mode === '120000') {
      return fail(githubError('INVALID_TYPE', `GitHub Skill 不允许包含符号链接：${entry.path}`));
    }
    if (entry.type === 'commit' || entry.mode === '160000') {
      return fail(githubError('INVALID_TYPE', `GitHub Skill 不允许包含子模块：${entry.path}`));
    }
    if (entry.type === 'tree') continue;
    if (!GIT_SHA.test(entry.sha) || !Number.isSafeInteger(entry.size) || (entry.size ?? -1) < 0) {
      return fail(githubError('INVALID_TYPE', `GitHub 文件元数据无效：${entry.path}`));
    }
    const size = entry.size!;
    if (size > SKILL_MAX_FILE_BYTES) {
      return fail(githubError('INVALID_RANGE', `GitHub Skill 文件过大：${entry.path}`));
    }
    const fileKind = classifyAgentSkillFile(entry.path);
    if (fileKind !== 'asset') {
      textFiles += 1;
      textBytes += size;
      if (size > SKILL_MAX_TEXT_FILE_BYTES) {
        return fail(githubError('INVALID_RANGE', `GitHub Skill 文本文件过大：${entry.path}`));
      }
    }
    totalBytes += size;
    files.push({ relativePath: entry.path, sha: entry.sha, size });
  }
  if (textFiles > SKILL_MAX_TEXT_FILES) {
    return fail(githubError('TOO_MANY_ITEMS', `GitHub Skill 文本文件不能超过 ${SKILL_MAX_TEXT_FILES} 个`));
  }
  if (textBytes > SKILL_MAX_TEXT_BYTES || totalBytes > SKILL_MAX_TOTAL_BYTES) {
    return fail(githubError('INVALID_RANGE', 'GitHub Skill 内容总大小超过安全限制'));
  }
  return ok(files);
}

/** 无指定目录时，公开仓库若只有一个嵌套 SKILL.md，沿用归档读取器的自动选择行为。 */
function inferUniqueSkillPath(treeValue: unknown): AppResult<string | null> {
  if (!isRecord(treeValue) || !Array.isArray(treeValue.tree)) {
    return fail(githubError('INVALID_TYPE', 'GitHub 仓库树结构无效'));
  }
  const paths = treeValue.tree
    .filter((value): value is Record<string, unknown> => isRecord(value))
    .filter((value) => value.type === 'blob' && typeof value.path === 'string')
    .map((value) => String(value.path))
    .filter((path) => path.endsWith('/SKILL.md'));
  const roots = [...new Set(paths.map((path) => path.slice(0, -'/SKILL.md'.length)))];
  if (roots.length > 1) {
    return fail(githubError('MISSING_REFERENCE', '仓库包含多个 SKILL.md，请指定 Skill 目录'));
  }
  return ok(roots[0] ?? null);
}

function decodeGithubBlob(value: unknown, expected: PlannedGithubFile): AppResult<Buffer> {
  if (!isRecord(value) || value.encoding !== 'base64' || typeof value.content !== 'string') {
    return fail(githubError('INVALID_TYPE', `GitHub 文件内容格式无效：${expected.relativePath}`));
  }
  const compact = value.content.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return fail(githubError('INVALID_TYPE', `GitHub 文件 Base64 无效：${expected.relativePath}`));
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.byteLength !== expected.size || (typeof value.size === 'number' && value.size !== expected.size)) {
    return fail(githubError('INVALID_TYPE', `GitHub 文件大小校验失败：${expected.relativePath}`));
  }
  return ok(bytes);
}

async function readPublicGithubAgentSkillSourceViaApi(
  request: PublicGithubSkillRequest,
  deps: PublicGithubSkillReaderDeps = {},
): Promise<AppResult<PublicGithubSkillReadResult>> {
  try {
    const repository = parseRepository(request.repositoryUrl);
    if (!repository.ok) return repository;
    const requestedRef = validateRef(request.requestedRef);
    if (!requestedRef.ok) return requestedRef;
    const skillPath = validateSkillPath(request.skillPath);
    if (!skillPath.ok) return skillPath;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const apiBaseUrl = deps.apiBaseUrl ?? GITHUB_API_ORIGIN;
    const repoPath = `/repos/${encodeURIComponent(repository.data.owner)}/${encodeURIComponent(repository.data.repository)}`;

    let resolvedRef = requestedRef.data;
    if (!resolvedRef) {
      const repo = await fetchJson<unknown>(fetchImpl, apiUrl(apiBaseUrl, repoPath), GITHUB_TREE_RESPONSE_BYTES);
      if (!isRecord(repo) || typeof repo.default_branch !== 'string') {
        return fail(githubError('INVALID_TYPE', 'GitHub 仓库缺少默认分支信息'));
      }
      const validatedDefault = validateRef(repo.default_branch);
      if (!validatedDefault.ok || !validatedDefault.data) return fail(githubError('INVALID_TYPE', 'GitHub 默认分支格式不正确'));
      resolvedRef = validatedDefault.data;
    }

    const commit = await fetchJson<unknown>(
      fetchImpl,
      apiUrl(apiBaseUrl, `${repoPath}/commits/${encodeURIComponent(resolvedRef)}`),
      GITHUB_TREE_RESPONSE_BYTES,
    );
    const commitHash = isRecord(commit) && typeof commit.sha === 'string' ? commit.sha : '';
    const commitValue = isRecord(commit) && isRecord(commit.commit) ? commit.commit : null;
    const treeValue = commitValue && isRecord(commitValue.tree) ? commitValue.tree : null;
    const treeHash = treeValue && typeof treeValue.sha === 'string' ? treeValue.sha : '';
    if (!GIT_SHA.test(commitHash) || !GIT_SHA.test(treeHash)) {
      return fail(githubError('INVALID_TYPE', 'GitHub Commit 信息无效'));
    }

    const tree = await fetchJson<unknown>(
      fetchImpl,
      apiUrl(apiBaseUrl, `${repoPath}/git/trees/${encodeURIComponent(treeHash)}?recursive=1`),
      GITHUB_TREE_RESPONSE_BYTES,
    );
    let inferredSkillPath = skillPath.data;
    if (!inferredSkillPath) {
      const inferred = await inferUniqueSkillPath(tree);
      if (!inferred.ok) return inferred;
      inferredSkillPath = inferred.data;
    }
    const plan = planTreeFiles(tree, inferredSkillPath);
    if (!plan.ok) return plan;

    const files: AgentSkillFileInput[] = [];
    const runtimeFiles: AgentSkillRuntimeFile[] = [];
    for (const file of plan.data) {
      const blob = await fetchJson<unknown>(
        fetchImpl,
        apiUrl(apiBaseUrl, `${repoPath}/git/blobs/${encodeURIComponent(file.sha)}`),
        GITHUB_BLOB_RESPONSE_BYTES,
      );
      const decoded = decodeGithubBlob(blob, file);
      if (!decoded.ok) return decoded;
      const fileKind = classifyAgentSkillFile(file.relativePath);
      files.push({
        relativePath: file.relativePath,
        contentHash: sha256(decoded.data),
        sizeBytes: decoded.data.byteLength,
        textContent: fileKind === 'asset' ? null : utf8Text(decoded.data),
      });
      runtimeFiles.push({
        relativePath: file.relativePath,
        contentHash: sha256(decoded.data),
        bytes: decoded.data,
      });
    }
    const scan = scanAgentSkillFiles(files);
    if (!scan.ok) return scan;
    return ok({ scan: scan.data, resolvedRef, commitHash, runtimeFiles });
  } catch (error) {
    if (error instanceof GithubSkillError) return fail(error.appError);
    return fail(githubError('NETWORK_ERROR', '读取 GitHub Skill 时发生未知错误', { retryable: true }));
  }
}

function archiveCacheKey(request: PublicGithubSkillRequest): string {
  return createHash('sha256').update(JSON.stringify({
    repositoryUrl: request.repositoryUrl,
    requestedRef: request.requestedRef ?? 'HEAD',
    skillPath: request.skillPath ?? null,
  })).digest('hex').slice(0, 24);
}

function archiveContentKey(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

async function cachedArchives(cacheDir: string, key: string): Promise<string[]> {
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${key}-`) && entry.name.endsWith('.zip'))
      .map((entry) => join(cacheDir, entry.name));
    const dated = await Promise.all(candidates.map(async (path) => ({ path, info: await stat(path) })));
    return dated.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs).map((item) => item.path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function cleanupArchiveCache(cacheDir: string, protectedPath: string): Promise<void> {
  const entries = await readdir(cacheDir, { withFileTypes: true });
  const dated = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.zip'))
    .map(async (entry) => {
      const path = join(cacheDir, entry.name);
      return { path, info: await stat(path) };
    }));
  let total = dated.reduce((sum, item) => sum + item.info.size, 0);
  for (const item of dated.sort((left, right) => left.info.mtimeMs - right.info.mtimeMs)) {
    if (total <= GITHUB_ARCHIVE_CACHE_MAX_BYTES) break;
    if (item.path === protectedPath) continue;
    await unlink(item.path).catch(() => undefined);
    total -= item.info.size;
  }
}

async function readCachedArchive(
  cacheDir: string,
  key: string,
  skillPath: string | undefined,
): Promise<AppResult<AgentSkillScanResult> | null> {
  for (const path of await cachedArchives(cacheDir, key)) {
    const scan = await readZipAgentSkillSource(path, { skillPath });
    if (scan.ok) {
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      return scan;
    }
    await unlink(path).catch(() => undefined);
  }
  return null;
}

async function readCachedRuntimeArchive(
  cacheDir: string,
  key: string,
  skillPath: string | undefined,
): Promise<AppResult<AgentSkillRuntimeBundle> | null> {
  for (const path of await cachedArchives(cacheDir, key)) {
    const bundle = await readZipAgentSkillRuntimeBundle(path, { skillPath });
    if (bundle.ok) {
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      return bundle;
    }
    await unlink(path).catch(() => undefined);
  }
  return null;
}

function archiveUrl(baseUrl: string, owner: string, repository: string, ref: string): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(
    `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zip/${encodeURIComponent(ref)}`,
    base,
  );
}

async function downloadGithubArchive(
  request: PublicGithubSkillRequest,
  repository: { owner: string; repository: string },
  deps: PublicGithubSkillReaderDeps,
  includeRuntimeFiles = false,
): Promise<AppResult<PublicGithubSkillReadResult>> {
  const requestedRef = validateRef(request.requestedRef);
  if (!requestedRef.ok) return requestedRef;
  const skillPath = validateSkillPath(request.skillPath);
  if (!skillPath.ok) return skillPath;
  const resolvedRef = requestedRef.data ?? 'HEAD';
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cacheDir = deps.cacheDir ?? join(tmpdir(), 'musefold-skill-cache-v0.3.0');
  const cacheKey = archiveCacheKey(request);
  await mkdir(cacheDir, { recursive: true });

  if (!request.refresh) {
    if (includeRuntimeFiles) {
      const cached = await readCachedRuntimeArchive(cacheDir, cacheKey, skillPath.data ?? undefined);
      if (cached?.ok) return ok({
        scan: cached.data.scan,
        resolvedRef,
        commitHash: null,
        runtimeFiles: cached.data.files,
      });
    } else {
      const cached = await readCachedArchive(cacheDir, cacheKey, skillPath.data ?? undefined);
      if (cached?.ok) return ok({ scan: cached.data, resolvedRef, commitHash: null });
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(archiveUrl(
      deps.archiveBaseUrl ?? GITHUB_ARCHIVE_ORIGIN,
      repository.owner,
      repository.repository,
      resolvedRef,
    ), {
      method: 'GET',
      redirect: 'error',
      // 归档下载给更长的总上限；下载停滞由 readResponseBytes 的 idle 超时兜底。
      signal: AbortSignal.timeout(GITHUB_ARCHIVE_TOTAL_TIMEOUT_MS),
      headers: {
        Accept: 'application/zip, application/octet-stream',
        'User-Agent': 'Musefold-Skill-Archive',
      },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return fail(githubError(
      isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      isTimeout ? 'GitHub 仓库下载超时，请重试' : '无法下载 GitHub 仓库，请检查网络后重试',
      { retryable: true },
    ));
  }
  if (!response.ok) {
    if (response.status === 404) {
      return fail(githubError(
        'MISSING_REFERENCE',
        `GitHub 仓库、版本或 Skill 路径不存在。${GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE}`,
      ));
    }
    if (response.status === 401 || response.status === 403) {
      return fail(githubError('AUTH_REQUIRED', GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE));
    }
    return fail(githubError('NETWORK_ERROR', `GitHub 仓库下载失败（HTTP ${response.status}）`, {
      retryable: response.status === 429 || response.status >= 500,
      details: { status: response.status },
    }));
  }

  let bytes: Uint8Array;
  try {
    bytes = await readResponseBytes(response, SKILL_MAX_ARCHIVE_BYTES, {
      idleTimeoutMs: GITHUB_ARCHIVE_IDLE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof GithubSkillError) return fail(error.appError);
    return fail(githubError('NETWORK_ERROR', 'GitHub 仓库下载中断，请重试', { retryable: true }));
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return fail(githubError('INVALID_TYPE', 'GitHub 返回的仓库文件不是有效 ZIP'));
  }
  const targetPath = join(cacheDir, `${cacheKey}-${archiveContentKey(bytes)}.zip`);
  await writeFile(targetPath, bytes, { flag: 'wx' }).catch(async (error) => {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
  });
  const runtimeBundle = includeRuntimeFiles
    ? await readZipAgentSkillRuntimeBundle(targetPath, { skillPath: skillPath.data ?? undefined })
    : null;
  const scan = runtimeBundle ?? await readZipAgentSkillSource(targetPath, { skillPath: skillPath.data ?? undefined });
  if (!scan.ok) {
    await unlink(targetPath).catch(() => undefined);
    return scan;
  }
  await cleanupArchiveCache(cacheDir, targetPath);
  return ok(runtimeBundle?.ok
    ? { scan: runtimeBundle.data.scan, resolvedRef, commitHash: null, runtimeFiles: runtimeBundle.data.files }
    : { scan: scan.data as AgentSkillScanResult, resolvedRef, commitHash: null });
}

/**
 * Runtime imports use GitHub's archive download endpoint instead of the REST
 * API. The optional apiBaseUrl remains only for deterministic legacy fixtures.
 */
export async function readPublicGithubAgentSkillSource(
  request: PublicGithubSkillRequest,
  deps: PublicGithubSkillReaderDeps = {},
): Promise<AppResult<PublicGithubSkillReadResult>> {
  const e2eApiBase = process.env.MUSEFOLD_E2E_GITHUB_API_BASE?.trim();
  if (deps.apiBaseUrl || e2eApiBase) {
    return readPublicGithubAgentSkillSourceViaApi(request, {
      ...deps,
      apiBaseUrl: deps.apiBaseUrl ?? e2eApiBase,
    });
  }
  const repository = parseRepository(request.repositoryUrl);
  if (!repository.ok) return repository;
  try {
    return await downloadGithubArchive(request, repository.data, deps);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    return fail(githubError('NETWORK_ERROR', '保存 GitHub Skill 本地快照失败', {
      retryable: true,
      details: code ? { systemCode: code } : undefined,
    }));
  }
}

/** Reads the exact same safe snapshot as import, plus in-memory file bytes for one generation run. */
export async function readPublicGithubAgentSkillRuntimeSource(
  request: PublicGithubSkillRequest,
  deps: PublicGithubSkillReaderDeps = {},
): Promise<AppResult<PublicGithubSkillReadResult>> {
  const e2eApiBase = process.env.MUSEFOLD_E2E_GITHUB_API_BASE?.trim();
  if (deps.apiBaseUrl || e2eApiBase) {
    return readPublicGithubAgentSkillSourceViaApi(request, {
      ...deps,
      apiBaseUrl: deps.apiBaseUrl ?? e2eApiBase,
    });
  }
  const repository = parseRepository(request.repositoryUrl);
  if (!repository.ok) return repository;
  try {
    return await downloadGithubArchive(request, repository.data, deps, true);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
    return fail(githubError('NETWORK_ERROR', '准备 GitHub Skill 运行附件失败', {
      retryable: true,
      details: code ? { systemCode: code } : undefined,
    }));
  }
}
