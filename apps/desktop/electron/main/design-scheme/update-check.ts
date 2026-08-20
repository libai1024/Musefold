/**
 * 「检查更新」（UI 规范 §4.2 / 设计规范 §2.2）：
 * 对比上游 GitHub 来源的最新 commit 与方案绑定的快照；有变化时重新
 * 固化快照 → Analyst → Compiler，产出待验证草稿（正式方案写 workingDraft，
 * 草稿方案直接更新当前版本）。当前正式版本始终保持可用。
 */
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import type {
  CompilationTraceItem,
  DesignSchemeRevisionDocument,
  SourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type { DesignSchemeCheckUpdateResult } from '@shared/types/design-scheme';
import { classifyAiError } from '../../ai/openai-compatible-assistant';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { buildInputSlots } from './orchestrator';
import { runRepositoryAnalyst } from './roles/analyst';
import { runSchemeCompiler } from './roles/compiler';
import { persistGithubSnapshot, resolveGithubSource } from './source-ingestion';
import type { OpenAiCompatibleTextAdapter } from './text-adapter';

export interface UpdateCheckDeps {
  db: Database.Database;
  resolveAdapter: () => OpenAiCompatibleTextAdapter | null;
  signal?: AbortSignal;
  userDataDir?: string;
}

export async function checkSchemeUpdate(
  schemeId: string,
  deps: UpdateCheckDeps,
): Promise<AppResult<DesignSchemeCheckUpdateResult>> {
  const repository = new DesignSchemeRepository(deps.db);
  let summary;
  try {
    summary = repository.requireSummary(schemeId);
  } catch (error) {
    return fail(appError('MISSING_REFERENCE', error instanceof Error ? error.message : '方案不存在', {
      recoveryAction: 'retry',
    }));
  }
  const base = repository.getRevisionDocument(summary.currentRevisionId);
  if (!base) return fail(appError('MISSING_REFERENCE', '方案版本不存在', { recoveryAction: 'retry' }));

  const repoBinding = base.sources.find((binding) => binding.kind.startsWith('github') && binding.uri);
  if (!repoBinding?.uri) {
    return ok({ status: 'no-source', detail: '这个方案没有 GitHub 来源，不需要检查更新。' });
  }

  try {
    const resolved = await resolveGithubSource(repoBinding.uri);
    if (deps.signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
    if (!resolved.ok) {
      return fail(appError('NETWORK_ERROR', resolved.error.message, { retryable: true, recoveryAction: 'retry' }));
    }
    const source = resolved.data;
    if (source.commitHash && repoBinding.commit && source.commitHash === repoBinding.commit) {
      return ok({
        status: 'up-to-date',
        detail: `已是最新（commit ${source.commitHash.slice(0, 10)}）。`,
      });
    }

    const adapter = deps.resolveAdapter();
    if (!adapter) {
      return fail(appError('AUTH_REQUIRED', '发现上游更新，但需要 Agent 重新编译。请先在「设置 → AI 连接」配置文本模型。', {
        recoveryAction: 'configure-ai',
      }));
    }

    const persisted = persistGithubSnapshot(deps.db, source, deps.userDataDir);
    const { report } = await runRepositoryAnalyst(adapter, {
      brief: base.compilation.briefExcerpt ?? '',
      repositoryLabel: source.repositoryLabel,
      textFiles: source.textFiles.map((file) => ({ path: file.path, text: file.text })),
      imagePaths: source.imageFiles.map((file) => file.relativePath),
      license: source.license,
    }, deps.signal);
    if (deps.signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
    const { output } = await runSchemeCompiler(adapter, {
      brief: base.compilation.briefExcerpt ?? '',
      repositoryLabel: source.repositoryLabel,
      analystReport: report,
    }, deps.signal);
    if (deps.signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });

    // 基线是修改校验的锚点：正式方案已有待验证草稿时，在草稿之上继续更新。
    const baseRevisionId = summary.status === 'formal' && summary.workingDraftRevisionId
      ? summary.workingDraftRevisionId
      : summary.currentRevisionId;

    const sources: SourceBinding[] = [];
    const briefBinding = base.sources.find((binding) => binding.kind === 'user-brief');
    if (briefBinding) sources.push({ ...briefBinding });
    const repoBindingId = 'src_repo';
    sources.push({
      id: repoBindingId,
      kind: 'github-skill',
      role: 'normative',
      uri: source.repositoryUrl,
      ref: source.resolvedRef,
      ...(source.commitHash ? { commit: source.commitHash } : {}),
      ...(source.license ? { license: source.license } : {}),
    });
    const trace: CompilationTraceItem[] = [{
      id: 'update-check',
      title: '上游 Skill 更新',
      detail: `commit ${repoBinding.commit?.slice(0, 10) ?? '未知'} → ${source.commitHash?.slice(0, 10) ?? source.resolvedRef}`,
      status: 'success',
    }];
    const document: DesignSchemeRevisionDocument = {
      schemaVersion: base.schemaVersion,
      revisionId: `dsrv_${randomUUID()}`,
      schemeId: base.schemeId,
      name: output.name,
      summary: output.summary,
      fidelity: output.fidelity,
      sources,
      inputs: buildInputSlots(output),
      parameters: [],
      constraints: output.constraints.map((constraint, index) => ({
        id: `con_${index + 1}`,
        domain: constraint.domain,
        statement: constraint.statement,
        mode: constraint.mode,
        userOverridable: constraint.userOverridable,
        sourceIds: [repoBindingId],
      })),
      promptProgram: output.promptProgram.map((module, index) => ({
        id: `pm_${index + 1}`,
        order: index,
        kind: module.kind,
        template: module.template,
        variables: module.variables,
        sourceIds: [repoBindingId],
      })),
      compilation: {
        compiledAt: Date.now(),
        model: { model: adapter.modelId, connectionName: adapter.connectionName },
        adopted: output.adopted,
        omitted: output.omitted,
        warnings: output.warnings,
        ...(base.compilation.briefExcerpt ? { briefExcerpt: base.compilation.briefExcerpt } : {}),
        trace,
      },
    };

    const saved = repository.applyAgentRevision(schemeId, baseRevisionId, document, [
      { snapshotId: persisted.snapshotId, role: 'normative' },
    ]);
    return ok({
      status: 'draft-created',
      detail: summary.status === 'formal'
        ? `上游已更新到 commit ${source.commitHash?.slice(0, 10) ?? source.resolvedRef}；新版本已保存为待验证草稿，正式版本保持可用。`
        : `上游已更新到 commit ${source.commitHash?.slice(0, 10) ?? source.resolvedRef}；草稿已更新，请重新试运行。`,
      scheme: saved.summary,
      revisionId: saved.document.revisionId,
    });
  } catch (error) {
    return fail(classifyAiError(error, deps.signal));
  }
}
