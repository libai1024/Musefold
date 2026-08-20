/**
 * v0.3.2 创建管线的确定性编排器：流程由代码驱动，AI 只在 Analyst/Compiler
 * 两个角色节点内产出结构化 JSON（开发规范 §3.1）。
 *
 * 状态机（创建子集）：
 *   created → [有来源] source_resolving → awaiting_install_confirmation
 *           → source_snapshotting → analyzing → compiling_scheme → draft_ready
 *   任意节点可进入 blocked / failed / cancelled。
 */
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import type { AnalystReport, CompilerOutput } from '@musefold/desktop-contracts/design-scheme/agents';
import type {
  CompilationTraceItem,
  DesignSchemeRevisionDocument,
  SourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type {
  DesignSchemeCreationEvent,
  DesignSchemeCreationResult,
  DesignSchemeCreationState,
  DesignSchemeCreationTraceItem,
  StartDesignSchemeCreationRequest,
} from '@musefold/desktop-contracts/design-scheme';
import { classifyAiError } from '../../ai/openai-compatible-assistant';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { runRepositoryAnalyst } from './roles/analyst';
import { runSchemeCompiler } from './roles/compiler';
import {
  persistGithubSnapshot,
  persistHistorySnapshot,
  resolveGithubSource,
  toSourceConfirmation,
  type PersistedHistorySnapshot,
  type ResolvedGithubSource,
} from './source-ingestion';
import type { OpenAiCompatibleTextAdapter } from './text-adapter';

export interface CreationSessionDeps {
  db: Database.Database;
  /** 返回 null 表示未配置可用文本 AI —— 创建方案必须经 Agent，直接 blocked。 */
  resolveAdapter: () => OpenAiCompatibleTextAdapter | null;
  emit: (event: DesignSchemeCreationEvent) => void;
  userDataDir?: string;
}

function shortHash(commit: string | null): string {
  return commit ? commit.slice(0, 10) : '未知';
}

/**
 * 槽位 id 直接采用模板变量名：试运行时 inputValues[slotId] 即可代入 {{variable}}，
 * 不需要维护第二份映射。变量缺失或重复时回落 input_N。
 */
export function buildInputSlots(compiled: CompilerOutput): DesignSchemeRevisionDocument['inputs'] {
  const used = new Set<string>();
  return compiled.inputs.map((input, index) => {
    const fallback = `input_${index + 1}`;
    const sanitized = (input.variable ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    const id = sanitized && !used.has(sanitized) ? sanitized : fallback;
    used.add(id);
    return {
      id,
      label: input.label,
      kind: input.kind,
      required: input.required,
      ...(input.imageRole ? { imageRole: input.imageRole } : {}),
      ...(input.preserve ? { preserve: input.preserve } : {}),
      ...(input.description ? { description: input.description } : {}),
    };
  });
}

export class DesignSchemeCreationSession {
  private readonly abortController = new AbortController();
  private readonly trace: DesignSchemeCreationTraceItem[] = [];
  private confirmationResolve: ((accepted: boolean) => void) | null = null;
  private stepStartedAt = 0;

  constructor(
    private readonly request: StartDesignSchemeCreationRequest,
    private readonly deps: CreationSessionDeps,
  ) {}

  get executionId(): string {
    return this.request.executionId;
  }

  cancel(): void {
    this.abortController.abort();
    this.confirmationResolve?.(false);
  }

  confirmInstall(accepted: boolean): void {
    if (!accepted) this.abortController.abort();
    this.confirmationResolve?.(accepted);
  }

  private get signal(): AbortSignal {
    return this.abortController.signal;
  }

  private emitState(state: DesignSchemeCreationState): void {
    this.deps.emit({ kind: 'state', executionId: this.executionId, state });
  }

  private upsertTrace(item: DesignSchemeCreationTraceItem): void {
    const index = this.trace.findIndex((existing) => existing.id === item.id);
    if (index >= 0) this.trace[index] = item;
    else this.trace.push(item);
    this.deps.emit({ kind: 'trace', executionId: this.executionId, item });
  }

  private beginStep(id: string, title: string, detail?: string): void {
    this.stepStartedAt = Date.now();
    this.upsertTrace({ id, kind: 'tool', title, ...(detail ? { detail } : {}), status: 'running' });
  }

  private endStep(
    id: string,
    title: string,
    status: 'success' | 'warning' | 'error',
    detail?: string,
  ): void {
    this.upsertTrace({
      id,
      kind: 'tool',
      title,
      ...(detail ? { detail } : {}),
      status,
      durationMs: Math.max(0, Date.now() - this.stepStartedAt),
    });
  }

  private throwIfCancelled(): void {
    if (this.signal.aborted) {
      throw Object.assign(new Error('创建已取消'), { name: 'AbortError' });
    }
  }

  async run(): Promise<AppResult<DesignSchemeCreationResult>> {
    try {
      return await this.execute();
    } catch (error) {
      if (this.signal.aborted) {
        this.upsertTrace({
          id: 'creation-final',
          kind: 'system',
          title: '创建已取消',
          status: 'warning',
        });
        this.emitState('cancelled');
        this.deps.emit({ kind: 'cancelled', executionId: this.executionId });
        return fail(appError('CANCELLED', '创建设计方案已取消', { retryable: false }));
      }
      const classified = classifyAiError(error, this.signal);
      this.upsertTrace({
        id: 'creation-final',
        kind: 'system',
        title: '创建失败',
        detail: classified.message,
        status: 'error',
      });
      this.emitState('failed');
      this.deps.emit({
        kind: 'failed',
        executionId: this.executionId,
        code: classified.code,
        message: classified.message,
      });
      return fail(classified);
    }
  }

  private async execute(): Promise<AppResult<DesignSchemeCreationResult>> {
    this.emitState('created');

    const adapter = this.deps.resolveAdapter();
    if (!adapter) {
      const message = '创建设计方案需要 Agent 参与。请先在「设置 → AI 连接」配置可用的文本模型。';
      this.upsertTrace({ id: 'creation-final', kind: 'system', title: '无法创建', detail: message, status: 'error' });
      this.emitState('blocked');
      this.deps.emit({ kind: 'failed', executionId: this.executionId, code: 'AI_UNAVAILABLE', message });
      return fail(appError('AUTH_REQUIRED', message, { recoveryAction: 'configure-ai' }));
    }

    // 多来源合并（P3）：多个 GitHub 地址依次「解析 → 确认 → 快照 → 分析」，最后合并编译为一个组合方案。
    const urls = this.request.githubUrls?.length
      ? [...new Set(this.request.githubUrls)]
      : this.request.githubUrl
        ? [this.request.githubUrl]
        : [];
    const repositories: Array<{ source: ResolvedGithubSource; snapshotId: string; report: AnalystReport }> = [];
    let history: PersistedHistorySnapshot | null = null;

    for (const [index, url] of urls.entries()) {
      const ordinal = urls.length > 1 ? { index: index + 1, total: urls.length } : null;
      const source = await this.resolveSource(url, ordinal);
      const accepted = await this.awaitInstallConfirmation(source, ordinal);
      if (!accepted) {
        this.abortController.abort();
        this.throwIfCancelled();
      }
      const snapshotId = this.snapshotSource(source, ordinal);
      const report = await this.analyze(adapter, source, ordinal);
      repositories.push({ source, snapshotId, report });
    }

    if (this.request.history?.items.length) {
      history = this.snapshotHistory(this.request.history.items);
    }

    const compiled = await this.compile(adapter, repositories, history);
    const result = this.saveDraft(adapter, repositories, compiled, history);

    this.emitState('draft_ready');
    this.deps.emit({ kind: 'draft-ready', executionId: this.executionId, result });
    return ok(result);
  }

  /** 多来源时给步骤 id 加序号后缀，标题带「(1/2)」标记；单来源保持原样。 */
  private stepId(base: string, ordinal: { index: number; total: number } | null): string {
    return ordinal ? `${base}-${ordinal.index}` : base;
  }

  private stepTitle(base: string, ordinal: { index: number; total: number } | null): string {
    return ordinal ? `${base}（${ordinal.index}/${ordinal.total}）` : base;
  }

  private async resolveSource(
    githubUrl: string,
    ordinal: { index: number; total: number } | null = null,
  ): Promise<ResolvedGithubSource> {
    const id = this.stepId('source-resolve', ordinal);
    const title = this.stepTitle('读取 GitHub 仓库', ordinal);
    this.emitState('source_resolving');
    this.beginStep(id, title, githubUrl);
    const resolved = await resolveGithubSource(githubUrl);
    this.throwIfCancelled();
    if (!resolved.ok) {
      this.endStep(id, title, 'error', resolved.error.message);
      throw new Error(resolved.error.message);
    }
    const source = resolved.data;
    this.endStep(
      id,
      title,
      'success',
      `${source.repositoryLabel} · ${source.textFiles.length} 个文本文件 · ${source.imageFiles.length} 张图片`,
    );
    return source;
  }

  private async awaitInstallConfirmation(
    source: ResolvedGithubSource,
    ordinal: { index: number; total: number } | null = null,
  ): Promise<boolean> {
    const id = this.stepId('source-confirm', ordinal);
    const title = this.stepTitle('等待安装确认', ordinal);
    this.emitState('awaiting_install_confirmation');
    this.beginStep(id, title, '来源将以固定 commit 快照引入');
    this.deps.emit({
      kind: 'confirmation-required',
      executionId: this.executionId,
      source: toSourceConfirmation(source),
    });
    const accepted = await new Promise<boolean>((resolve) => {
      this.confirmationResolve = resolve;
      if (this.signal.aborted) resolve(false);
    });
    this.confirmationResolve = null;
    if (!accepted) {
      this.endStep(id, title, 'warning', '用户未确认引入来源');
      return false;
    }
    this.endStep(id, title, 'success', '用户已确认引入来源');
    return true;
  }

  private snapshotSource(
    source: ResolvedGithubSource,
    ordinal: { index: number; total: number } | null = null,
  ): string {
    const id = this.stepId('source-snapshot', ordinal);
    const title = this.stepTitle('固化来源快照', ordinal);
    this.emitState('source_snapshotting');
    this.beginStep(id, title);
    const persisted = persistGithubSnapshot(this.deps.db, source, this.deps.userDataDir);
    this.endStep(
      id,
      title,
      'success',
      `commit ${shortHash(source.commitHash)} · 快照 ${persisted.snapshotId.slice(0, 13)}`,
    );
    return persisted.snapshotId;
  }

  /** 历史内容是本地可信来源：直接固化快照，不经过安装确认（确认只针对远程来源）。 */
  private snapshotHistory(items: NonNullable<StartDesignSchemeCreationRequest['history']>['items']): PersistedHistorySnapshot {
    this.emitState('source_snapshotting');
    this.beginStep('history-snapshot', '固化历史来源', `${items.length} 项历史内容`);
    const persisted = persistHistorySnapshot(this.deps.db, items, this.deps.userDataDir);
    const promptCount = persisted.items.filter((item) => item.promptText?.trim()).length;
    this.endStep(
      'history-snapshot',
      '固化历史来源',
      persisted.items.length > 0 ? 'success' : 'warning',
      persisted.items.length > 0
        ? `${persisted.items.length} 张图片${promptCount > 0 ? ` · ${promptCount} 条提示词` : ''} · 快照 ${persisted.snapshotId.slice(0, 13)}`
        : '历史图片文件已不存在，来源为空',
    );
    return persisted;
  }

  private async analyze(
    adapter: OpenAiCompatibleTextAdapter,
    source: ResolvedGithubSource,
    ordinal: { index: number; total: number } | null = null,
  ): Promise<AnalystReport> {
    const id = this.stepId('analyst', ordinal);
    const title = this.stepTitle('Repository Analyst 分析仓库', ordinal);
    this.emitState('analyzing');
    this.beginStep(id, title, `模型 ${adapter.modelId}`);
    const { report, retried } = await runRepositoryAnalyst(adapter, {
      brief: this.request.brief,
      repositoryLabel: source.repositoryLabel,
      textFiles: source.textFiles.map((file) => ({ path: file.path, text: file.text })),
      imagePaths: source.imageFiles.map((file) => file.relativePath),
      license: source.license,
    }, this.signal);
    this.throwIfCancelled();
    this.endStep(
      id,
      title,
      retried ? 'warning' : 'success',
      `${report.capabilitySummary}（${report.rules.length} 条规则 · ${report.variables.length} 个输入候选${retried ? ' · 结构校验重试 1 次' : ''}）`,
    );
    if (report.unsupported.length > 0) {
      this.upsertTrace({
        id: this.stepId('analyst-unsupported', ordinal),
        kind: 'system',
        title: ordinal ? `${source.repositoryLabel} 中无法还原的能力` : '仓库中无法还原的能力',
        detail: report.unsupported.join('；'),
        status: 'warning',
      });
    }
    return report;
  }

  private async compile(
    adapter: OpenAiCompatibleTextAdapter,
    repositories: Array<{ source: ResolvedGithubSource; report: AnalystReport }>,
    history: PersistedHistorySnapshot | null,
  ): Promise<CompilerOutput> {
    this.emitState('compiling_scheme');
    this.beginStep(
      'compiler',
      'Scheme Compiler 编译方案',
      repositories.length > 1 ? `模型 ${adapter.modelId} · 合并 ${repositories.length} 个来源` : `模型 ${adapter.modelId}`,
    );
    const historyPrompts = (history?.items ?? [])
      .map((item) => item.promptText?.trim())
      .filter((text): text is string => Boolean(text));
    const [primary] = repositories;
    const { output, retried } = await runSchemeCompiler(adapter, {
      brief: this.request.brief,
      ...(primary ? { repositoryLabel: primary.source.repositoryLabel, analystReport: primary.report } : {}),
      ...(repositories.length > 1
        ? {
          additionalRepositories: repositories.slice(1).map((repo) => ({
            repositoryLabel: repo.source.repositoryLabel,
            analystReport: repo.report,
          })),
        }
        : {}),
      ...(history && history.items.length > 0
        ? { historyContext: { imageCount: history.items.length, prompts: [...new Set(historyPrompts)] } }
        : {}),
    }, this.signal);
    this.throwIfCancelled();
    this.endStep(
      'compiler',
      'Scheme Compiler 编译方案',
      retried ? 'warning' : 'success',
      `「${output.name}」 · ${output.inputs.length} 个输入 · ${output.constraints.length} 条约束 · ${output.promptProgram.length} 个提示词模块${retried ? ' · 结构校验重试 1 次' : ''}`,
    );
    return output;
  }

  private saveDraft(
    adapter: OpenAiCompatibleTextAdapter,
    repositories: Array<{ source: ResolvedGithubSource; snapshotId: string; report: AnalystReport }>,
    compiled: CompilerOutput,
    history: PersistedHistorySnapshot | null,
  ): DesignSchemeCreationResult {
    this.beginStep('save-draft', '保存方案草稿');
    const repository = new DesignSchemeRepository(this.deps.db);
    const document = this.buildDocument(adapter, repositories, compiled, history);
    const bindings: Array<{ snapshotId: string; role: 'normative' | 'example' }> = repositories
      .map((repo) => ({ snapshotId: repo.snapshotId, role: 'normative' as const }));
    if (history && history.items.length > 0) bindings.push({ snapshotId: history.snapshotId, role: 'example' });
    const summary = repository.insertSchemeDraft({
      document,
      sourceLabel: repositories.length > 1
        ? `${repositories[0].source.repositoryLabel} 等 ${repositories.length} 个来源`
        : repositories.length === 1
          ? repositories[0].source.repositoryLabel
          : history && history.items.length > 0
            ? `历史 · ${history.items.length} 张图片`
            : 'Musefold 创建',
      sourcePresentation: repositories.length > 0 ? 'skill' : 'musefold-created',
      createdBy: 'agent',
      bindings,
    });
    this.endStep('save-draft', '保存方案草稿', 'success', `草稿「${summary.name}」已写入方案库`);

    this.upsertTrace({
      id: 'creation-summary',
      kind: 'assistant',
      title: 'Agent',
      output: compiled.creationSummary,
      status: 'success',
    });

    return {
      scheme: summary,
      revisionId: document.revisionId,
      creationSummary: compiled.creationSummary,
      trace: [...this.trace],
    };
  }

  private buildDocument(
    adapter: OpenAiCompatibleTextAdapter,
    repositories: Array<{ source: ResolvedGithubSource; snapshotId: string; report: AnalystReport }>,
    compiled: CompilerOutput,
    history: PersistedHistorySnapshot | null,
  ): DesignSchemeRevisionDocument {
    const schemeId = `dsch_${randomUUID()}`;
    const revisionId = `dsrv_${randomUUID()}`;

    const sources: SourceBinding[] = [];
    const briefBindingId = 'src_brief';
    if (this.request.brief.trim()) {
      sources.push({ id: briefBindingId, kind: 'user-brief', role: 'context' });
    }
    // 单来源保持 src_repo；多来源用 src_repo_N，全部为 normative（组合方案的每个来源都是规范来源）。
    const repoBindingIds: string[] = [];
    for (const [index, repo] of repositories.entries()) {
      const bindingId = repositories.length > 1 ? `src_repo_${index + 1}` : 'src_repo';
      repoBindingIds.push(bindingId);
      sources.push({
        id: bindingId,
        kind: 'github-skill',
        role: 'normative',
        uri: repo.source.repositoryUrl,
        ref: repo.source.resolvedRef,
        ...(repo.source.commitHash ? { commit: repo.source.commitHash } : {}),
        ...(repo.source.license ? { license: repo.source.license } : {}),
      });
    }
    for (const [index, item] of (history?.items ?? []).entries()) {
      // 历史图片是样例（example：帮助抽取变量），提示词是背景（context）；见规范 §5.2。
      sources.push({
        id: `src_hist_${index + 1}`,
        kind: 'history-image',
        role: 'example',
        uri: `history:${item.historyId}`,
      });
      if (item.promptText?.trim()) {
        sources.push({
          id: `src_hist_${index + 1}_prompt`,
          kind: 'conversation-turn',
          role: 'context',
          uri: `history:${item.historyId}`,
        });
      }
    }
    const defaultSourceIds = repoBindingIds.length > 0
      ? repoBindingIds
      : history && history.items.length > 0
        ? sources.filter((binding) => binding.kind === 'history-image').map((binding) => binding.id)
        : (this.request.brief.trim() ? [briefBindingId] : []);

    const compilationTrace: CompilationTraceItem[] = this.trace
      .filter((item) => item.kind === 'tool' && item.status !== 'running')
      .map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.detail ? { detail: item.detail.slice(0, 600) } : {}),
        status: item.status === 'running' ? 'success' : item.status,
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      }));

    return {
      schemaVersion: 1,
      revisionId,
      schemeId,
      name: compiled.name,
      summary: compiled.summary,
      fidelity: compiled.fidelity,
      sources,
      inputs: buildInputSlots(compiled),
      parameters: [],
      constraints: compiled.constraints.map((constraint, index) => ({
        id: `con_${index + 1}`,
        domain: constraint.domain,
        statement: constraint.statement,
        mode: constraint.mode,
        userOverridable: constraint.userOverridable,
        sourceIds: constraint.evidencePaths.length > 0 && repoBindingIds.length > 0 ? repoBindingIds : defaultSourceIds,
      })),
      promptProgram: compiled.promptProgram.map((module, index) => ({
        id: `pm_${index + 1}`,
        order: index,
        kind: module.kind,
        template: module.template,
        variables: module.variables,
        sourceIds: defaultSourceIds,
      })),
      compilation: {
        compiledAt: Date.now(),
        model: { model: adapter.modelId, connectionName: adapter.connectionName },
        adopted: compiled.adopted,
        omitted: compiled.omitted,
        warnings: compiled.warnings,
        ...(this.request.brief.trim() ? { briefExcerpt: this.request.brief.trim().slice(0, 600) } : {}),
        trace: compilationTrace,
      },
    };
  }
}
