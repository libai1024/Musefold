/**
 * 「检查更新」（UI 规范 §4.2 / 设计规范 §2.2）：
 * 对比上游 GitHub 来源的最新 commit 与方案绑定的快照；有变化时重新
 * 固化快照 → Analyst → Compiler，产出待验证草稿（正式方案写 workingDraft，
 * 草稿方案直接更新当前版本）。当前正式版本始终保持可用。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ZodType } from 'zod';
import {
  designSchemeHashSchema,
  designSchemeRevisionDocumentSchema as canonicalDocumentSchema,
  httpsRepositoryUriSchema,
  httpsUriSchema,
  opaqueIdSchema,
  relativePathSchema,
  sourceConfirmationSchema,
} from '@musefold/contracts';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import type { AnalystReport } from '@musefold/desktop-contracts/design-scheme/agents';
import type {
  CompilationTraceItem,
  DesignSchemeRevisionDocument,
  SourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type {
  DesignSchemeCheckUpdateResult,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';
import { classifyAiError } from '../../ai/openai-compatible-assistant';
import {
  DesignSchemeRepository,
  DesignSchemeVersionConflictError,
} from '@musefold/core/db/design-scheme/repositories';
import { buildInputSlots } from './orchestrator';
import { runRepositoryAnalyst } from './roles/analyst';
import { runSchemeCompiler } from './roles/compiler';
import {
  persistGithubSnapshot,
  resolveGithubSource,
  type ResolvedGithubSource,
} from './source-ingestion';
import type { OpenAiCompatibleTextAdapter } from './text-adapter';

export interface UpdateCheckDeps {
  db: Database.Database;
  resolveAdapter: () => OpenAiCompatibleTextAdapter | null;
  signal?: AbortSignal;
  userDataDir?: string;
}

interface ResolvedBinding {
  binding: SourceBinding & { uri: string };
  source: ResolvedGithubSource;
  changed: boolean;
}

class CanonicalValidationError extends Error {
  constructor(label: string, issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
    const detail = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    super(`${label}未通过共享契约校验${detail ? `: ${detail}` : ''}`);
    this.name = 'TypeValidationError';
  }
}

function parseCanonical<T>(schema: ZodType<T>, candidate: unknown, label: string): T {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) throw new CanonicalValidationError(label, parsed.error.issues);
  return parsed.data;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
}

function repositoryLabel(repositoryUrl: string): string {
  const parsed = new URL(repositoryUrl);
  return parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

/** GitHub 下载结果是网络输入；只把共享契约接受的 path-free 字段交给 AI/持久化。 */
function validateResolvedSource(
  source: ResolvedGithubSource,
  expectedRepositoryUrl: string,
): ResolvedGithubSource {
  const expectedUrl = parseCanonical(
    httpsRepositoryUriSchema,
    expectedRepositoryUrl,
    '方案 GitHub 来源',
  );
  const confirmation = parseCanonical(
    sourceConfirmationSchema,
    {
      repositoryUrl: source.repositoryUrl,
      name: source.name,
      description: source.description,
      resolvedRef: source.resolvedRef,
      commitHash: source.commitHash,
      textFileCount: source.textFiles.length,
      textNames: source.textFiles.slice(0, 100).map((file) => file.path),
      imageFileCount: source.imageFiles.length,
      license: source.license,
    },
    'GitHub 来源',
  );
  if (confirmation.repositoryUrl !== expectedUrl) {
    throw new CanonicalValidationError('GitHub 来源', [
      { path: ['repositoryUrl'], message: '解析结果与方案绑定的仓库不一致' },
    ]);
  }

  const textFiles = source.textFiles.map((file) => ({
    ...file,
    path: parseCanonical(relativePathSchema, file.path, 'GitHub 文本路径'),
    contentHash: parseCanonical(designSchemeHashSchema, file.contentHash, 'GitHub 文本哈希'),
  }));
  const imageFiles = source.imageFiles.map((file) => ({
    ...file,
    relativePath: parseCanonical(relativePathSchema, file.relativePath, 'GitHub 图片路径'),
    contentHash: parseCanonical(designSchemeHashSchema, file.contentHash, 'GitHub 图片哈希'),
  }));
  return {
    ...source,
    repositoryUrl: confirmation.repositoryUrl,
    repositoryLabel: repositoryLabel(confirmation.repositoryUrl),
    name: confirmation.name,
    description: confirmation.description,
    resolvedRef: confirmation.resolvedRef,
    commitHash: confirmation.commitHash,
    license: confirmation.license,
    textFiles,
    imageFiles,
  };
}

function canonicalSource(binding: SourceBinding): Record<string, unknown> {
  const semanticHistoryUri =
    (binding.kind === 'history-image' || binding.kind === 'conversation-turn') &&
    binding.uri?.startsWith('history:');
  if (binding.uri && !semanticHistoryUri) {
    parseCanonical(
      binding.kind.startsWith('github') ? httpsRepositoryUriSchema : httpsUriSchema,
      binding.uri,
      `来源 ${binding.id}`,
    );
  }
  return {
    id: binding.id,
    kind: binding.kind,
    role: binding.role,
    ...(binding.uri && !semanticHistoryUri
      ? binding.kind.startsWith('github')
        ? { repositoryUrl: binding.uri }
        : { uri: binding.uri }
      : {}),
    ...(binding.ref ? { resolvedRef: binding.ref } : {}),
    ...(binding.commit ? { commitHash: binding.commit } : {}),
    ...(binding.filePath ? { relativePath: binding.filePath } : {}),
    ...(binding.contentHash ? { contentHash: binding.contentHash } : {}),
    ...(binding.license ? { license: binding.license } : {}),
  };
}

/** Validate the AI-derived write candidate with the path-free canonical document schema. */
function validateDocument(document: DesignSchemeRevisionDocument): void {
  parseCanonical(
    canonicalDocumentSchema,
    {
      schemaVersion: document.schemaVersion,
      revisionId: document.revisionId,
      schemeId: document.schemeId,
      name: document.name,
      summary: document.summary,
      fidelity: document.fidelity,
      sources: document.sources.map(canonicalSource),
      inputs: document.inputs,
      parameters: document.parameters,
      constraints: document.constraints,
      promptProgram: document.promptProgram,
      compilation: document.compilation,
    },
    '更新后的设计方案文档',
  );
}

/** Missing commit metadata is not enough evidence by itself to trigger an Agent recompile. */
function hasUpstreamChange(binding: SourceBinding, source: ResolvedGithubSource): boolean {
  if (binding.commit && source.commitHash) return binding.commit !== source.commitHash;
  return Boolean(binding.ref && source.resolvedRef && binding.ref !== source.resolvedRef);
}

function refreshedSources(
  base: DesignSchemeRevisionDocument,
  resolved: ResolvedBinding[],
): SourceBinding[] {
  const changedById = new Map(
    resolved.filter((item) => item.changed).map((item) => [item.binding.id, item.source]),
  );
  return base.sources.map((binding) => {
    const source = changedById.get(binding.id);
    if (!source) return { ...binding };
    const { ref: _ref, commit: _commit, license: previousLicense, ...preserved } = binding;
    const license = source.license ?? previousLicense;
    return {
      ...preserved,
      uri: source.repositoryUrl,
      ref: source.resolvedRef,
      ...(source.commitHash ? { commit: source.commitHash } : {}),
      ...(license ? { license } : {}),
    };
  });
}

function updateTrace(changed: ResolvedBinding[]): CompilationTraceItem[] {
  return changed.map(({ binding, source }, index) => ({
    id: `update-check-${index + 1}-${randomUUID().slice(0, 8)}`,
    title: '上游 Skill 更新',
    detail: `commit ${binding.commit?.slice(0, 10) ?? '未知'} → ${source.commitHash?.slice(0, 10) ?? source.resolvedRef}`,
    status: 'success',
  }));
}

function replaceChangedSnapshotBindings(
  db: Database.Database,
  revisionId: string,
  changed: Array<ResolvedBinding & { snapshotId: string }>,
): void {
  const removeSuperseded = db.prepare(
    `DELETE FROM design_scheme_source_bindings
      WHERE revision_id = ?
        AND source_snapshot_id IN (
          SELECT snapshot.id
            FROM source_snapshots snapshot
            JOIN source_packages package ON package.id = snapshot.package_id
           WHERE package.kind = 'github'
             AND package.repository_url = ?
             AND snapshot.id <> ?
        )`,
  );
  for (const item of changed) {
    removeSuperseded.run(revisionId, item.source.repositoryUrl, item.snapshotId);
  }
}

export async function checkSchemeUpdate(
  schemeId: string,
  deps: UpdateCheckDeps,
  requestedRevisionId?: string,
): Promise<AppResult<DesignSchemeCheckUpdateResult>> {
  const repository = new DesignSchemeRepository(deps.db);
  let summary: DesignSchemeSummary;
  try {
    summary = repository.requireSummary(schemeId);
  } catch (error) {
    return fail(
      appError('MISSING_REFERENCE', error instanceof Error ? error.message : '方案不存在', {
        recoveryAction: 'retry',
      }),
    );
  }

  const authoritativeRevisionId =
    summary.status === 'formal' && summary.workingDraftRevisionId
      ? summary.workingDraftRevisionId
      : summary.currentRevisionId;
  if (requestedRevisionId !== undefined && requestedRevisionId !== authoritativeRevisionId) {
    return fail(
      appError('INVALID_STATE', '指定版本不是方案当前可更新的版本，请刷新后重试', {
        recoveryAction: 'retry',
      }),
    );
  }

  const base = repository.getRevisionDocument(authoritativeRevisionId);
  if (!base || base.schemeId !== schemeId) {
    return fail(appError('MISSING_REFERENCE', '方案版本不存在', { recoveryAction: 'retry' }));
  }

  const repoBindings = base.sources.filter(
    (binding): binding is SourceBinding & { uri: string } =>
      binding.kind.startsWith('github') && Boolean(binding.uri),
  );
  if (repoBindings.length === 0) {
    return ok({ status: 'no-source', detail: '这个方案没有 GitHub 来源，不需要检查更新。' });
  }

  try {
    const resolved: ResolvedBinding[] = [];
    for (const binding of repoBindings) {
      const result = await resolveGithubSource(binding.uri);
      throwIfCancelled(deps.signal);
      if (!result.ok) {
        return fail(
          appError('NETWORK_ERROR', result.error.message, {
            retryable: true,
            recoveryAction: 'retry',
          }),
        );
      }
      const source = validateResolvedSource(result.data, binding.uri);
      resolved.push({
        binding,
        source,
        changed: hasUpstreamChange(binding, source),
      });
    }

    const changed = resolved.filter((item) => item.changed);
    if (changed.length === 0) {
      const [only] = resolved;
      return ok({
        status: 'up-to-date',
        detail:
          resolved.length === 1 && only?.source.commitHash
            ? `已是最新（commit ${only.source.commitHash.slice(0, 10)}）。`
            : `${resolved.length} 个 GitHub 来源均已是最新。`,
      });
    }

    const adapter = deps.resolveAdapter();
    if (!adapter) {
      return fail(
        appError(
          'AUTH_REQUIRED',
          '发现上游更新，但需要 Agent 重新编译。请先在「设置 → AI 连接」配置文本模型。',
          {
            recoveryAction: 'configure-ai',
          },
        ),
      );
    }

    const brief = base.compilation.briefExcerpt ?? '';
    const analyzed: Array<ResolvedBinding & { report: AnalystReport }> = [];
    for (const item of changed) {
      const { report } = await runRepositoryAnalyst(
        adapter,
        {
          brief,
          repositoryLabel: item.source.repositoryLabel,
          textFiles: item.source.textFiles.map((file) => ({ path: file.path, text: file.text })),
          imagePaths: item.source.imageFiles.map((file) => file.relativePath),
          license: item.source.license,
        },
        deps.signal,
      );
      throwIfCancelled(deps.signal);
      analyzed.push({ ...item, report });
    }

    const [primary, ...additional] = analyzed;
    if (!primary) throw new Error('GitHub 来源解析结果为空');
    const { output } = await runSchemeCompiler(
      adapter,
      {
        brief,
        repositoryLabel: primary.source.repositoryLabel,
        analystReport: primary.report,
        ...(additional.length > 0
          ? {
              additionalRepositories: additional.map((item) => ({
                repositoryLabel: item.source.repositoryLabel,
                analystReport: item.report,
              })),
            }
          : {}),
      },
      deps.signal,
    );
    throwIfCancelled(deps.signal);

    const githubSourceIds = resolved.map((item) => item.binding.id).slice(0, 16);
    const trace = updateTrace(changed);
    const document: DesignSchemeRevisionDocument = {
      schemaVersion: base.schemaVersion,
      revisionId: `dsrv_${randomUUID()}`,
      schemeId: base.schemeId,
      name: output.name,
      summary: output.summary,
      fidelity: output.fidelity,
      sources: refreshedSources(base, resolved),
      inputs: buildInputSlots(output),
      parameters: base.parameters.map((parameter) => ({ ...parameter })),
      constraints: output.constraints.map((constraint, index) => ({
        id: `con_${index + 1}`,
        domain: constraint.domain,
        statement: constraint.statement,
        mode: constraint.mode,
        userOverridable: constraint.userOverridable,
        sourceIds: githubSourceIds,
      })),
      promptProgram: output.promptProgram.map((module, index) => ({
        id: `pm_${index + 1}`,
        order: index,
        kind: module.kind,
        template: module.template,
        variables: module.variables,
        sourceIds: githubSourceIds,
      })),
      compilation: {
        compiledAt: Date.now(),
        model: { model: adapter.modelId, connectionName: adapter.connectionName },
        adopted: output.adopted,
        omitted: output.omitted,
        warnings: output.warnings,
        ...(base.compilation.briefExcerpt !== undefined
          ? { briefExcerpt: base.compilation.briefExcerpt }
          : {}),
        trace: [...base.compilation.trace, ...trace].slice(-60),
      },
    };
    validateDocument(document);

    const saved = deps.db.transaction(() => {
      const persisted = changed.map((item) => {
        const snapshot = persistGithubSnapshot(deps.db, item.source, deps.userDataDir);
        parseCanonical(opaqueIdSchema, snapshot.packageId, 'GitHub 来源包 ID');
        const snapshotId = parseCanonical(opaqueIdSchema, snapshot.snapshotId, 'GitHub 快照 ID');
        return { ...item, snapshotId };
      });
      const result = repository.applyAgentRevision(
        schemeId,
        authoritativeRevisionId,
        document,
        persisted.map((item) => ({ snapshotId: item.snapshotId, role: item.binding.role })),
        summary.version,
      );
      replaceChangedSnapshotBindings(deps.db, result.document.revisionId, persisted);
      return result;
    })();

    const updatedLabel =
      changed.length === 1
        ? `commit ${changed[0]?.source.commitHash?.slice(0, 10) ?? changed[0]?.source.resolvedRef}`
        : `${changed.length} 个上游来源`;
    return ok({
      status: 'draft-created',
      detail:
        summary.status === 'formal'
          ? `上游已更新到${updatedLabel}；新版本已保存为待验证草稿，正式版本保持可用。`
          : `上游已更新到${updatedLabel}；草稿已更新，请重新试运行。`,
      scheme: saved.summary,
      revisionId: saved.document.revisionId,
    });
  } catch (error) {
    if (
      error instanceof DesignSchemeVersionConflictError ||
      (error instanceof Error && error.message.includes('方案已有更新版本'))
    ) {
      return fail(
        appError('INVALID_STATE', '方案在检查更新期间已发生变化，请刷新后重试', {
          retryable: true,
          recoveryAction: 'retry',
        }),
      );
    }
    return fail(classifyAiError(error, deps.signal));
  }
}
