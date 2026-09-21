import { createHash } from 'node:crypto';
import { sourceCommitSchema, sourceConfirmationSchema } from '@musefold/contracts';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { readGithubSourceArchive } from './github-source-archive.js';
import {
  GITHUB_SOURCE_LIMITS,
  type GithubSourceLimits,
  sourceError,
  withAbort,
} from './github-source-common.js';

export { GITHUB_SOURCE_LIMITS } from './github-source-common.js';

const repositoryName = /^[A-Za-z0-9_.-]{1,100}$/;
const ownerName = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const repositorySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().regex(repositoryName),
  full_name: z.string().max(140),
  owner: z.object({ login: z.string().regex(ownerName) }),
  html_url: z.string().max(2048),
  private: z.literal(false),
  visibility: z.literal('public').optional(),
  default_branch: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  license: z.object({ spdx_id: z.string().trim().min(1).max(256).nullable() }).nullable(),
});
const exactCommitSchema = z
  .string()
  .refine((value) => value === value.trim())
  .pipe(sourceCommitSchema);
const commitSchema = z.object({
  sha: exactCommitSchema,
  commit: z.object({ tree: z.object({ sha: exactCommitSchema }) }),
});
const requestSchema = z
  .object({
    repositoryUrl: z.string().min(1).max(2048),
    requestedRef: z.string().min(1).max(200).optional(),
  })
  .strict();

export interface GithubSourceReaderDependencies {
  /** Tests may map these fixed production URLs to a local fake HTTP server. */
  fetchImpl?: typeof fetch;
  /** Limits can only be tightened. Share one reader instance across requests. */
  limits?: Partial<GithubSourceLimits>;
}

function invalidMetadata() {
  return sourceError(
    'GITHUB_SOURCE_INVALID_RESPONSE',
    'GitHub 来源信息无效或与请求仓库不一致',
    502,
  );
}

function parseRepository(raw: string) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(raw);
  if (raw !== raw.trim() || !match || !ownerName.test(match[1]) || !repositoryName.test(match[2]))
    throw sourceError('GITHUB_SOURCE_INVALID_URL', '仅支持规范的公开 GitHub 仓库 HTTPS 地址');
  const repository = match[2].replace(/\.git$/, '');
  if (!repository || repository === '.' || repository === '..')
    throw sourceError('GITHUB_SOURCE_INVALID_URL', 'GitHub 仓库名称无效');
  return { owner: match[1], repository };
}

function validateRef(ref: string) {
  // Git refs are data encoded into one URL segment. Deliberately exclude unusual
  // refs in this slice rather than accept a URL/path or Git revision expression.
  if (
    ref !== ref.trim() ||
    !/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/.test(ref) ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.endsWith('.') ||
    ref.endsWith('/') ||
    ref.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))
  )
    throw sourceError('GITHUB_SOURCE_INVALID_REF', 'GitHub 分支、标签或 commit 格式无效');
  return ref;
}

async function readBytes(response: Response, signal: AbortSignal, maximum: number) {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > maximum)
  )
    throw sourceError('GITHUB_SOURCE_TOO_LARGE', 'GitHub 来源超过读取大小限制');
  if (!response.body) throw invalidMetadata();
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum)
        throw sourceError('GITHUB_SOURCE_TOO_LARGE', 'GitHub 来源超过读取大小限制');
      chunks.push(chunk.value);
    }
    if (length === 0) throw invalidMetadata();
    return Buffer.concat(chunks, length);
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Non-paid source preparation only: no storage, identities, Agent invocation, or execution. */
export class GithubDesignSchemeSourceReader {
  private readonly fetchImpl: typeof fetch;
  private readonly limits: GithubSourceLimits;
  private activeReads = 0;

  constructor(deps: GithubSourceReaderDependencies = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.limits = { ...GITHUB_SOURCE_LIMITS, ...deps.limits };
    for (const key of Object.keys(GITHUB_SOURCE_LIMITS) as Array<keyof GithubSourceLimits>) {
      if (
        !Number.isSafeInteger(this.limits[key]) ||
        this.limits[key] < 1 ||
        this.limits[key] > GITHUB_SOURCE_LIMITS[key]
      )
        throw new Error('Invalid GitHub source resource limit');
    }
  }

  async read(raw: z.input<typeof requestSchema>, callerSignal?: AbortSignal) {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success)
      throw sourceError('GITHUB_SOURCE_INVALID_REQUEST', 'GitHub 来源读取参数无效');
    const request = parsed.data;
    const requestedRepository = parseRepository(request.repositoryUrl);
    if (request.requestedRef) validateRef(request.requestedRef);
    if (callerSignal?.aborted)
      throw sourceError('GITHUB_SOURCE_CANCELLED', 'GitHub 来源读取已取消');
    if (this.activeReads >= this.limits.concurrentReads)
      throw sourceError('GITHUB_SOURCE_BUSY', '来源读取繁忙，请稍后重试', 429, true);
    this.activeReads += 1;
    const deadline = AbortSignal.timeout(this.limits.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
    try {
      const repositoryPath = `/repos/${encodeURIComponent(requestedRepository.owner)}/${encodeURIComponent(requestedRepository.repository)}`;
      const metadata = repositorySchema.safeParse(
        await this.readJson(new URL(repositoryPath, 'https://api.github.com'), signal),
      );
      if (!metadata.success) throw invalidMetadata();
      const repository = metadata.data;
      const fullName = `${repository.owner.login}/${repository.name}`;
      if (
        repository.name === '.' ||
        repository.name === '..' ||
        repository.full_name !== fullName ||
        fullName.toLowerCase() !==
          `${requestedRepository.owner}/${requestedRepository.repository}`.toLowerCase() ||
        repository.html_url !== `https://github.com/${fullName}`
      )
        throw invalidMetadata();
      // Validate even when a requested ref is supplied: do not retain malformed metadata.
      const defaultRef = validateRef(repository.default_branch);
      const requestedRef = request.requestedRef ?? defaultRef;
      const canonicalPath = `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}`;
      const commit = commitSchema.safeParse(
        await this.readJson(
          new URL(
            `${canonicalPath}/commits/${encodeURIComponent(requestedRef)}`,
            'https://api.github.com',
          ),
          signal,
        ),
      );
      if (!commit.success) throw invalidMetadata();
      const commitHash = commit.data.sha.toLowerCase();
      if (
        /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(requestedRef) &&
        requestedRef.toLowerCase() !== commitHash
      )
        throw invalidMetadata();
      // A moving branch is resolved exactly once; all bytes thereafter use only the SHA.
      const archiveUrl = new URL(
        `/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/zip/${commitHash}`,
        'https://codeload.github.com',
      );
      const archive = await this.request(archiveUrl, signal, false);
      const bundle = await readGithubSourceArchive(
        archive,
        `${repository.name}-${commitHash}`,
        this.limits,
        signal,
      );
      signal.throwIfAborted();
      const confirmation = sourceConfirmationSchema.parse({
        repositoryUrl: repository.html_url,
        name: fullName,
        description: repository.description ?? '',
        resolvedRef: commitHash,
        commitHash,
        textFileCount: bundle.files.filter((file) => file.metadata.kind === 'text').length,
        textNames: bundle.files
          .filter((file) => file.metadata.kind === 'text')
          .map((file) => file.metadata.relativePath),
        imageFileCount: bundle.files.filter((file) => file.metadata.kind === 'image').length,
        // The repository endpoint describes its current default branch, not the
        // frozen commit. This reader preserves license bytes but does not infer SPDX.
        license: null,
      });
      const manifest = bundle.files.map((file) => [
        file.metadata.relativePath,
        file.metadata.kind,
        file.metadata.sizeBytes,
        file.metadata.contentHash,
      ]);
      return {
        repositoryId: repository.id,
        requestedRef,
        resolvedRef: commitHash,
        commitHash,
        treeHash: commit.data.commit.tree.sha.toLowerCase(),
        archiveHash: createHash('sha256').update(archive).digest('hex'),
        contentHash: createHash('sha256')
          .update(JSON.stringify({ repositoryId: repository.id, commitHash, files: manifest }))
          .digest('hex'),
        confirmation,
        licenseFiles: bundle.files
          .filter(
            (file) =>
              /^(license|licence|copying)(\.[^/]*)?$/i.test(file.metadata.relativePath) &&
              file.metadata.kind === 'text',
          )
          .map((file) => file.metadata),
        warnings: [
          '固定 commit 的许可范围尚未识别或确认；请核对快照中的许可证文件，不能按仓库当前 metadata 推断授权。',
        ],
        ...bundle,
      };
    } catch (error) {
      if (callerSignal?.aborted)
        throw sourceError('GITHUB_SOURCE_CANCELLED', 'GitHub 来源读取已取消');
      if (deadline.aborted)
        throw sourceError('GITHUB_SOURCE_TIMEOUT', 'GitHub 来源读取超时，请稍后重试', 504, true);
      if (error instanceof AppError) throw error;
      throw invalidMetadata();
    } finally {
      this.activeReads -= 1;
    }
  }

  private async readJson(url: URL, signal: AbortSignal): Promise<unknown> {
    const bytes = await this.request(url, signal, true);
    try {
      return JSON.parse(utf8.decode(bytes));
    } catch {
      throw invalidMetadata();
    }
  }

  private async request(url: URL, signal: AbortSignal, json: boolean) {
    signal.throwIfAborted();
    let response: Response | undefined;
    try {
      const pending = this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal,
        headers: {
          Accept: json ? 'application/vnd.github+json' : 'application/zip',
          'User-Agent': 'Musefold-Source-Reader',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      // Even a test transport that ignores abort must not leave a late body unclosed.
      void pending
        .then((late) => {
          if (signal.aborted && late.body && !late.body.locked)
            void late.body.cancel().catch(() => undefined);
        })
        .catch(() => undefined);
      response = await withAbort(pending, signal);
      if (response.status === 429 || response.status === 403)
        throw sourceError(
          'GITHUB_SOURCE_RATE_LIMITED',
          'GitHub 来源暂不可读取，请稍后重试',
          429,
          true,
        );
      if (response.status === 404)
        throw sourceError('GITHUB_SOURCE_NOT_FOUND', '未找到公开仓库或指定版本');
      if (response.status !== 200)
        throw sourceError(
          'GITHUB_SOURCE_UPSTREAM_ERROR',
          'GitHub 来源暂不可用',
          502,
          response.status >= 500,
        );
      const mime = response.headers.get('content-type') ?? '';
      if (
        json
          ? !/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(mime)
          : !/^application\/(?:zip|x-zip-compressed|octet-stream)(?:\s*;|$)/i.test(mime)
      )
        throw invalidMetadata();
      return await readBytes(
        response,
        signal,
        json ? this.limits.jsonBytes : this.limits.archiveBytes,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof AppError) throw error;
      throw sourceError(
        'GITHUB_SOURCE_UPSTREAM_ERROR',
        '无法连接 GitHub 来源，请稍后重试',
        502,
        true,
      );
    } finally {
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => undefined);
    }
  }
}

export type ResolvedGithubDesignSchemeSource = Awaited<
  ReturnType<GithubDesignSchemeSourceReader['read']>
>;
