/**
 * 修改方案会话（UI 规范 §8.3）：Agent 按用户要求更新既有方案。
 *
 * - 草稿：新 revision 直接替换当前版本（同一份草稿被更新）。
 * - 正式：当前正式 revision 不动，新内容写入 working_draft_revision_id；
 *   完成本机试运行并由用户确认后才替换（规范 §2.2）。
 *
 * 状态机复用创建事件（created → compiling_scheme → draft_ready / failed / cancelled），
 * 对话轮渲染直接复用创建轨迹组件。
 */
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import type { CompilerOutput } from '@musefold/desktop-contracts/design-scheme/agents';
import type {
  CompilationTraceItem,
  DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type {
  DesignSchemeCreationEvent,
  DesignSchemeCreationResult,
  DesignSchemeCreationTraceItem,
  StartDesignSchemeModifyRequest,
} from '@musefold/desktop-contracts/design-scheme';
import { classifyAiError } from '../../ai/openai-compatible-assistant';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { buildInputSlots } from './orchestrator';
import { runSchemeReviser } from './roles/reviser';
import type { OpenAiCompatibleTextAdapter } from './text-adapter';

export interface ModifySessionDeps {
  db: Database.Database;
  resolveAdapter: () => OpenAiCompatibleTextAdapter | null;
  emit: (event: DesignSchemeCreationEvent) => void;
}

/** 修订后的约束/模板沿用基线的来源归属（修订不引入新来源）。 */
export function baseDefaultSourceIds(base: DesignSchemeRevisionDocument): string[] {
  const repo = base.sources.find((binding) => binding.kind.startsWith('github'));
  if (repo) return [repo.id];
  const history = base.sources.filter((binding) => binding.kind === 'history-image');
  if (history.length > 0) return history.map((binding) => binding.id);
  const brief = base.sources.find((binding) => binding.kind === 'user-brief');
  return brief ? [brief.id] : [];
}

export class DesignSchemeModifySession {
  private readonly abortController = new AbortController();
  private readonly trace: DesignSchemeCreationTraceItem[] = [];
  private stepStartedAt = 0;

  constructor(
    private readonly request: StartDesignSchemeModifyRequest,
    private readonly deps: ModifySessionDeps,
  ) {}

  get executionId(): string {
    return this.request.executionId;
  }

  cancel(): void {
    this.abortController.abort();
  }

  private emitState(state: 'created' | 'compiling_scheme' | 'draft_ready' | 'blocked' | 'failed' | 'cancelled'): void {
    this.deps.emit({ kind: 'state', executionId: this.executionId, state });
  }

  private upsertTrace(item: DesignSchemeCreationTraceItem): void {
    const index = this.trace.findIndex((existing) => existing.id === item.id);
    if (index >= 0) this.trace[index] = item;
    else this.trace.push(item);
    this.deps.emit({ kind: 'trace', executionId: this.executionId, item });
  }

  async run(): Promise<AppResult<DesignSchemeCreationResult>> {
    try {
      return await this.execute();
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.upsertTrace({ id: 'modify-final', kind: 'system', title: '修改已取消', status: 'warning' });
        this.emitState('cancelled');
        this.deps.emit({ kind: 'cancelled', executionId: this.executionId });
        return fail(appError('CANCELLED', '修改方案已取消', { retryable: false }));
      }
      const classified = classifyAiError(error, this.abortController.signal);
      this.upsertTrace({
        id: 'modify-final',
        kind: 'system',
        title: '修改失败',
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
      const message = '修改设计方案需要 Agent 参与。请先在「设置 → AI 连接」配置可用的文本模型。';
      this.upsertTrace({ id: 'modify-final', kind: 'system', title: '无法修改', detail: message, status: 'error' });
      this.emitState('blocked');
      this.deps.emit({ kind: 'failed', executionId: this.executionId, code: 'AI_UNAVAILABLE', message });
      return fail(appError('AUTH_REQUIRED', message, { recoveryAction: 'configure-ai' }));
    }

    const repository = new DesignSchemeRepository(this.deps.db);
    const summary = repository.requireSummary(this.request.schemeId);
    const base = repository.getRevisionDocument(this.request.baseRevisionId);
    if (!base) {
      return fail(appError('MISSING_REFERENCE', '方案版本不存在', { recoveryAction: 'retry' }));
    }

    this.emitState('compiling_scheme');
    this.stepStartedAt = Date.now();
    this.upsertTrace({
      id: 'reviser',
      kind: 'tool',
      title: 'Scheme Reviser 更新方案',
      detail: `模型 ${adapter.modelId}`,
      status: 'running',
    });
    // 展示名（可能被重命名过）作为修订基线的名称，Agent 未被要求改名时保持它。
    const { output, retried } = await runSchemeReviser(adapter, {
      instruction: this.request.instruction,
      document: { ...base, name: summary.name },
    }, this.abortController.signal);
    if (this.abortController.signal.aborted) {
      throw Object.assign(new Error('修改已取消'), { name: 'AbortError' });
    }
    this.upsertTrace({
      id: 'reviser',
      kind: 'tool',
      title: 'Scheme Reviser 更新方案',
      detail: `「${output.name}」 · ${output.inputs.length} 个输入 · ${output.constraints.length} 条约束${retried ? ' · 结构校验重试 1 次' : ''}`,
      status: retried ? 'warning' : 'success',
      durationMs: Math.max(0, Date.now() - this.stepStartedAt),
    });

    const document = this.buildDocument(adapter, base, output);
    const saved = repository.applyAgentRevision(this.request.schemeId, this.request.baseRevisionId, document);

    this.upsertTrace({
      id: 'save-revision',
      kind: 'tool',
      title: '保存新版本',
      detail: summary.status === 'formal'
        ? '正式版本保持可用；新版本作为待验证草稿保存'
        : '草稿已更新为新版本',
      status: 'success',
    });
    this.upsertTrace({
      id: 'modify-summary',
      kind: 'assistant',
      title: 'Agent',
      output: output.creationSummary,
      status: 'success',
    });

    this.emitState('draft_ready');
    const result: DesignSchemeCreationResult = {
      scheme: saved.summary,
      revisionId: saved.document.revisionId,
      creationSummary: output.creationSummary,
      trace: [...this.trace],
    };
    this.deps.emit({ kind: 'draft-ready', executionId: this.executionId, result });
    return ok(result);
  }

  private buildDocument(
    adapter: OpenAiCompatibleTextAdapter,
    base: DesignSchemeRevisionDocument,
    output: CompilerOutput,
  ): DesignSchemeRevisionDocument {
    const defaultSourceIds = baseDefaultSourceIds(base);
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
      schemaVersion: base.schemaVersion,
      revisionId: `dsrv_${randomUUID()}`,
      schemeId: base.schemeId,
      name: output.name,
      summary: output.summary,
      fidelity: output.fidelity,
      sources: base.sources.map((binding) => ({ ...binding })),
      inputs: buildInputSlots(output),
      parameters: base.parameters.map((parameter) => ({ ...parameter })),
      constraints: output.constraints.map((constraint, index) => ({
        id: `con_${index + 1}`,
        domain: constraint.domain,
        statement: constraint.statement,
        mode: constraint.mode,
        userOverridable: constraint.userOverridable,
        sourceIds: defaultSourceIds,
      })),
      promptProgram: output.promptProgram.map((module, index) => ({
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
        adopted: output.adopted,
        omitted: output.omitted,
        warnings: output.warnings,
        briefExcerpt: this.request.instruction.trim().slice(0, 600),
        trace: compilationTrace,
      },
    };
  }
}
