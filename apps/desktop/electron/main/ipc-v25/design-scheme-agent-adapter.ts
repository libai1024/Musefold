// v2.5 design-scheme Agent 管线 canonical adapter(P01-10 创建/修改切片)。
//
// 保留的 v2.1 会话类(orchestrator 创建 / modify-session 修改)按旧 DTO 工作;本文件把它们
// 接到 v25 单通道桥:
// - renderer 只提交 brief / 历史来源身份 / 修改指令,主进程解析 Agent 文本连接并驾驭会话;
// - 旧事件逐条映射为 canonical creation event(state / trace / confirmation-required /
//   draft-ready / failed / cancelled),过不了 path-free 契约校验的条目降级或丢弃,不穿透;
// - 执行登记进 designSchemeExecutionRegistry(kind create/modify),取消与安装确认由注册表统一仲裁;
// - 终态结果经 createDesignSchemeResultSchema 校验后返回;失败映射稳定 BridgeError。

import type Database from 'better-sqlite3';
import {
  compilationTraceItemSchema,
  createDesignSchemeResultSchema,
  designSchemeCreationEventSchema,
  sourceConfirmationSchema,
  type CompilationTraceItem,
  type CreateDesignSchemeResult,
  type DesignSchemeEvent,
  type DesignSchemeRevisionDocument,
  type DesignSchemeSummary,
  type StructuredDesignSchemeError,
} from '@musefold/contracts';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import type {
  DesignSchemeCreationEvent as LegacyCreationEvent,
  DesignSchemeCreationResult as LegacyCreationResult,
  DesignSchemeCreationTraceItem as LegacyTraceItem,
  DesignSchemeHistorySourceItem,
  DesignSchemeSummary as LegacySummary,
} from '@musefold/desktop-contracts/design-scheme';
import type { DesignSchemeRevisionDocument as LegacyDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import type { AppError } from '@musefold/domain/app-result';
import type { ResolveAgentTextAdapter } from '../design-scheme/agent-adapter';
import type { DesignSchemeExecutionRegistry } from '../design-scheme/execution-registry';
import { DesignSchemeModifySession } from '../design-scheme/modify-session';
import { DesignSchemeCreationSession } from '../design-scheme/orchestrator';
import { BridgeError } from './envelope';

/** 无可用 Agent 文本连接:v2.5 尚无配置入口(U05),沿用 v2.1 已配置的文本连接。 */
export const DESIGN_SCHEME_AGENT_AI_UNAVAILABLE = 'DESIGN_SCHEME_AGENT_AI_UNAVAILABLE' as const;
export const DESIGN_SCHEME_AGENT_AI_UNAVAILABLE_MESSAGE =
  '设计方案 Agent 需要可用的文本模型连接(chat/completions)。当前版本暂未提供 Agent 连接配置入口,已配置的 v2.1 文本连接可直接使用。';

export interface DesktopDesignSchemeAgentAdapterDeps {
  /** 独立 design-scheme SQLite。 */
  db: Database.Database;
  userDataDir: string;
  picturesDir: string;
  executionRegistry: DesignSchemeExecutionRegistry;
  emit: (senderId: number, event: DesignSchemeEvent) => void;
  resolveAgentAdapter: ResolveAgentTextAdapter;
  /** legacy → canonical 映射由 domain 提供(单一实现,不在此复制字段丢弃规则)。 */
  toCanonicalSummary: (summary: LegacySummary) => DesignSchemeSummary;
  toCanonicalDocument: (document: LegacyDocument) => DesignSchemeRevisionDocument;
}

export interface AgentCreationRequest {
  executionId: string;
  brief: string;
  /** 已由 domain 按成功生成账本 owner-safe 解析的历史来源(主进程内部路径,不出 renderer)。 */
  history: DesignSchemeHistorySourceItem[];
}

export interface AgentModifyRequest {
  executionId: string;
  schemeId: string;
  baseRevisionId: string;
  instruction: string;
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_.-]{1,79}$/;

function scrubMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/][^\s;]*/g, '[路径已脱敏]')
    .replace(/(?:\/(?:Users|home|tmp|var|private)\/)[^\s;]*/g, '[路径已脱敏]')
    .slice(0, 500);
}

function recoveryActionFor(
  code: string,
  legacy?: string,
): StructuredDesignSchemeError['recoveryAction'] {
  switch (legacy) {
    case 'configure-ai':
      return 'configure-ai';
    case 'edit-input':
      return 'edit-input';
    case 'select-source':
      return 'choose-source';
    case 'configure-provider':
      return 'choose-provider';
    case 'retry':
      return 'retry';
    default:
      break;
  }
  if (code === 'AI_UNAVAILABLE' || code === 'AUTH_REQUIRED' || code === 'MODEL_UNSUPPORTED') {
    return 'configure-ai';
  }
  if (code === 'REQUIRED') return 'edit-input';
  if (['TIMEOUT', 'NETWORK_ERROR', 'OUTPUT_SCHEMA_INVALID', 'UNKNOWN'].includes(code)) {
    return 'retry';
  }
  return 'none';
}

function canonicalError(
  code: string,
  message: string,
  options: { retryable?: boolean; recoveryAction?: string } = {},
): StructuredDesignSchemeError {
  const recoveryAction = recoveryActionFor(code, options.recoveryAction);
  return {
    code: ERROR_CODE_PATTERN.test(code) ? code : 'DESIGN_SCHEME_AGENT_FAILED',
    message: scrubMessage(message.trim() || 'Agent 处理失败'),
    retryable: options.retryable ?? recoveryAction === 'retry',
    recoveryAction,
  };
}

function appErrorToBridge(error: AppError, fallback: string): BridgeError {
  const canonical = canonicalError(error.code, error.message || fallback, error);
  return new BridgeError(canonical.code, canonical.message);
}

/** 旧轨迹条目 → canonical:超长/不安全的 detail、output 逐级降级,标题都过不了才丢弃。 */
export function toCanonicalTraceItem(item: LegacyTraceItem): CompilationTraceItem | null {
  const base = {
    id: item.id,
    kind: item.kind,
    title: item.title.trim().slice(0, 120) || '步骤',
    status: item.status,
    ...(item.durationMs !== undefined
      ? { durationMs: Math.max(0, Math.round(item.durationMs)) }
      : {}),
  };
  const attempts: Array<Record<string, unknown>> = [
    {
      ...base,
      ...(item.detail ? { detail: item.detail.slice(0, 600) } : {}),
      ...(item.output ? { output: item.output.slice(0, 4_000) } : {}),
    },
    { ...base, ...(item.output ? { output: item.output.slice(0, 4_000) } : {}) },
    base,
  ];
  for (const candidate of attempts) {
    const parsed = compilationTraceItemSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function toCanonicalTrace(trace: readonly LegacyTraceItem[]): CompilationTraceItem[] {
  return trace
    .map(toCanonicalTraceItem)
    .filter((item): item is CompilationTraceItem => item !== null)
    .slice(0, 60);
}

function toCanonicalCreationResult(
  legacy: LegacyCreationResult,
  deps: DesktopDesignSchemeAgentAdapterDeps,
): CreateDesignSchemeResult {
  const repository = new DesignSchemeRepository(deps.db);
  const document = repository.getRevisionDocument(legacy.revisionId);
  if (!document) {
    throw new BridgeError('DESIGN_SCHEME_MAPPING_FAILED', 'Agent 产出的方案版本未能读回');
  }
  const summary = deps.toCanonicalSummary(legacy.scheme);
  const creationSummary = legacy.creationSummary.trim().slice(0, 1_200);
  const candidate = {
    scheme: summary,
    document: deps.toCanonicalDocument(document),
    revisionId: legacy.revisionId,
    ...(creationSummary ? { creationSummary } : {}),
    trace: toCanonicalTrace(legacy.trace),
  };
  let parsed = createDesignSchemeResultSchema.safeParse(candidate);
  if (!parsed.success && creationSummary) {
    // 说明文字过不了安全校验时只丢说明,不丢方案。
    parsed = createDesignSchemeResultSchema.safeParse({ ...candidate, creationSummary: undefined });
  }
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BridgeError(
      'DESIGN_SCHEME_MAPPING_FAILED',
      `Agent 产出无法映射为共享契约:${issue ? `${issue.path.join('.') || '?'}: ${issue.message}` : '未知'}`,
    );
  }
  return parsed.data;
}

interface SessionLike {
  run(): Promise<{ ok: true; data: LegacyCreationResult } | { ok: false; error: AppError }>;
  cancel(): void;
  confirmInstall?(accepted: boolean): void;
}

/**
 * 驾驭一次 Agent 会话:登记执行 → 转发事件 → 等终态 → 归档登记。
 * `draft-ready` 的 canonical 结果与返回值是同一次映射,避免事件与返回不一致。
 */
async function driveAgentSession(
  kind: 'create' | 'modify',
  executionId: string,
  senderId: number,
  deps: DesktopDesignSchemeAgentAdapterDeps,
  createSession: (emit: (event: LegacyCreationEvent) => void) => SessionLike,
): Promise<CreateDesignSchemeResult> {
  let canonicalResult: CreateDesignSchemeResult | null = null;
  let mappingFailure: BridgeError | null = null;

  const forward = (legacy: LegacyCreationEvent): void => {
    if (legacy.executionId !== executionId) return;
    let candidate: unknown = null;
    switch (legacy.kind) {
      case 'state':
        candidate = { kind: 'state', executionId, state: legacy.state };
        break;
      case 'trace': {
        const item = toCanonicalTraceItem(legacy.item);
        if (!item) return;
        candidate = { kind: 'trace', executionId, item };
        break;
      }
      case 'confirmation-required': {
        const source = sourceConfirmationSchema.safeParse({
          ...legacy.source,
          textNames: legacy.source.textNames.slice(0, 100),
        });
        if (!source.success) return;
        candidate = { kind: 'confirmation-required', executionId, source: source.data };
        break;
      }
      case 'draft-ready': {
        try {
          canonicalResult = toCanonicalCreationResult(legacy.result, deps);
        } catch (error) {
          mappingFailure =
            error instanceof BridgeError
              ? error
              : new BridgeError('DESIGN_SCHEME_MAPPING_FAILED', 'Agent 产出无法映射为共享契约');
          return;
        }
        candidate = { kind: 'draft-ready', executionId, result: canonicalResult };
        break;
      }
      case 'failed':
        candidate = {
          kind: 'failed',
          executionId,
          error: canonicalError(legacy.code, legacy.message),
        };
        break;
      case 'cancelled':
        candidate = { kind: 'cancelled', executionId };
        break;
      default:
        return;
    }
    const parsed = designSchemeCreationEventSchema.safeParse(candidate);
    if (parsed.success) deps.emit(senderId, parsed.data);
  };

  const session = createSession(forward);
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const registration = deps.executionRegistry.register({
    executionId,
    senderId,
    kind,
    cancel: () => session.cancel(),
    ...(session.confirmInstall
      ? { confirm: (accepted: boolean) => session.confirmInstall?.(accepted) }
      : {}),
    completion,
  });
  if (registration.status === 'duplicate-active') {
    resolveCompletion();
    throw new BridgeError('DESIGN_SCHEME_EXECUTION_DUPLICATE', '该执行仍在进行中,请等待其结束');
  }
  if (registration.status === 'already-terminal') {
    resolveCompletion();
    throw new BridgeError('DESIGN_SCHEME_EXECUTION_TERMINAL', '该执行已经结束');
  }

  let terminal: 'completed' | 'failed' | 'cancelled' = 'failed';
  try {
    const outcome = await session.run();
    if (!outcome.ok) {
      terminal = outcome.error.code === 'CANCELLED' ? 'cancelled' : 'failed';
      throw appErrorToBridge(
        outcome.error,
        kind === 'create' ? '创建设计方案失败' : '修改设计方案失败',
      );
    }
    if (mappingFailure) throw mappingFailure;
    // 会话未经 draft-ready 事件直接返回(理论上不会发生)时补一次映射。
    const result = canonicalResult ?? toCanonicalCreationResult(outcome.data, deps);
    terminal = 'completed';
    return result;
  } finally {
    if (terminal === 'cancelled') {
      deps.executionRegistry.cancel(senderId, executionId);
    } else {
      deps.executionRegistry.markTerminal(senderId, executionId, terminal);
    }
    resolveCompletion();
  }
}

function requireAgentAdapter(
  executionId: string,
  senderId: number,
  deps: DesktopDesignSchemeAgentAdapterDeps,
) {
  const adapter = deps.resolveAgentAdapter();
  if (adapter) return adapter;
  const error = canonicalError(
    DESIGN_SCHEME_AGENT_AI_UNAVAILABLE,
    DESIGN_SCHEME_AGENT_AI_UNAVAILABLE_MESSAGE,
    {
      recoveryAction: 'configure-ai',
    },
  );
  const event = designSchemeCreationEventSchema.safeParse({ kind: 'failed', executionId, error });
  if (event.success) deps.emit(senderId, event.data);
  throw new BridgeError(error.code, error.message);
}

/** Agent 创建(brief + 可选历史来源;GitHub 来源由 domain 在安装确认通道部署前拒绝)。 */
export async function runCanonicalDesignSchemeCreation(
  request: AgentCreationRequest,
  senderId: number,
  deps: DesktopDesignSchemeAgentAdapterDeps,
): Promise<CreateDesignSchemeResult> {
  const adapter = requireAgentAdapter(request.executionId, senderId, deps);
  return driveAgentSession(
    'create',
    request.executionId,
    senderId,
    deps,
    (emit) =>
      new DesignSchemeCreationSession(
        {
          executionId: request.executionId,
          brief: request.brief,
          ...(request.history.length > 0 ? { history: { items: request.history } } : {}),
        },
        {
          db: deps.db,
          resolveAdapter: () => adapter,
          emit,
          userDataDir: deps.userDataDir,
          picturesDir: deps.picturesDir,
        },
      ),
  );
}

/** Agent 修改:基线必须是当前版本或待验证草稿,先于会话在主进程权威状态上核对。 */
export async function runCanonicalDesignSchemeModify(
  request: AgentModifyRequest,
  senderId: number,
  deps: DesktopDesignSchemeAgentAdapterDeps,
): Promise<CreateDesignSchemeResult> {
  const repository = new DesignSchemeRepository(deps.db);
  let summary: LegacySummary;
  try {
    summary = repository.requireSummary(request.schemeId);
  } catch {
    throw new BridgeError('NOT_FOUND', '设计方案不存在或已删除');
  }
  const validBase =
    summary.status === 'draft'
      ? request.baseRevisionId === summary.currentRevisionId
      : request.baseRevisionId === summary.currentRevisionId ||
        request.baseRevisionId === summary.workingDraftRevisionId;
  if (!validBase) {
    throw new BridgeError('DESIGN_SCHEME_INVALID_STATE', '方案已有更新版本,请刷新后再修改');
  }
  const adapter = requireAgentAdapter(request.executionId, senderId, deps);
  return driveAgentSession(
    'modify',
    request.executionId,
    senderId,
    deps,
    (emit) =>
      new DesignSchemeModifySession(
        {
          executionId: request.executionId,
          schemeId: request.schemeId,
          baseRevisionId: request.baseRevisionId,
          instruction: request.instruction,
        },
        { db: deps.db, resolveAdapter: () => adapter, emit },
      ),
  );
}
