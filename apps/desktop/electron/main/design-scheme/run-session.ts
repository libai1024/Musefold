/**
 * v0.3.2 方案运行会话：草稿试运行 / 正式方案使用的确定性管线。
 *
 * 与创建管线不同，这里没有 Agent 参与——提示词由 compileSchemePrompt 从方案
 * 文档确定性编译（开发规范 §1.1：所有运行先得到结构化方案再执行）。
 * 流程：校验输入 → 编译提示词 → 逐张生图 → 运行记录/相册落库，全程推事件。
 */
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import {
  compileSchemePrompt,
  missingRequiredSlots,
  PRIORITY_MODE_LABEL,
} from '@musefold/desktop-contracts/design-scheme/prompt-compiler';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import type {
  DesignSchemeCreationEvent,
  DesignSchemeCreationTraceItem,
  DesignSchemeRunGeneration,
  DesignSchemeRunResult,
  SchemeRunEvaluation,
  StartDesignSchemeRunRequest,
} from '@shared/types/design-scheme';
import type {
  GenerateImageRequest,
  ImageGenerationProgress,
} from '@shared/types/providers';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { buildRepairHint, evaluateSchemeRun } from './evaluation';
import { generate as runProviderGeneration } from '../ipc/images';

export interface RunSessionDeps {
  db: Database.Database;
  emit: (event: DesignSchemeCreationEvent) => void;
  sendProgress: (progress: ImageGenerationProgress) => void;
  signal: AbortSignal;
}

interface PreparedRun {
  document: DesignSchemeRevisionDocument;
  schemeName: string;
}

export async function runDesignScheme(
  request: StartDesignSchemeRunRequest,
  deps: RunSessionDeps,
): Promise<AppResult<DesignSchemeRunResult>> {
  const repository = new DesignSchemeRepository(deps.db);
  const trace: DesignSchemeCreationTraceItem[] = [];
  const upsertTrace = (item: DesignSchemeCreationTraceItem) => {
    const index = trace.findIndex((existing) => existing.id === item.id);
    if (index >= 0) trace[index] = item;
    else trace.push(item);
    deps.emit({ kind: 'trace', executionId: request.executionId, item: { ...item } });
  };

  const prepared = prepareRun(repository, request);
  if (!prepared.ok) {
    upsertTrace({ id: 'run-final', kind: 'system', title: '无法运行方案', detail: prepared.error.message, status: 'error' });
    return prepared;
  }
  const { document, schemeName } = prepared.data;
  const runId = `dsr_${ulid()}`;
  const modeLabel = request.mode === 'trial' ? '试运行' : '正式运行';
  // 每次运行保存当时的优先级快照（设计规范 §4.3）；缺省按「方案主导」。
  const priorityMode = request.priorityMode ?? 'scheme_first';
  repository.insertRun({
    runId,
    revisionId: request.revisionId,
    mode: request.mode,
    policy: {
      priorityMode,
      schemeRevisionId: request.revisionId,
      appliedAt: Date.now(),
      // 有限修复链（§5.5）：修复运行记录来源 runId，原始运行与输出保持不变。
      ...(request.repair ? { repairOfRunId: request.repair.ofRunId } : {}),
    },
    provider: {
      providerId: request.generation.requestTemplate.providerId,
      providerName: request.generation.providerName,
    },
  });
  if (request.repair) {
    upsertTrace({
      id: 'repair-context',
      kind: 'system',
      title: '按质量门建议修复重跑',
      detail: request.repair.hint,
      status: 'success',
    });
  }

  // 1. 必填输入校验（真实执行阻塞，规范 §4.2：缺必填输入停止并给出恢复路径）
  const imageCount = request.generation.requestTemplate.referenceImages?.length ?? 0;
  const missing = missingRequiredSlots(document, request.inputValues, imageCount);
  if (missing.length > 0) {
    const labels = missing.map((slot) => slot.label).join('、');
    repository.updateRunStatus(runId, 'blocked');
    upsertTrace({
      id: 'run-final',
      kind: 'system',
      title: `${modeLabel}已阻塞`,
      detail: `缺少必填输入：${labels}`,
      status: 'error',
    });
    return fail(appError('REQUIRED', `方案需要先提供：${labels}`, { recoveryAction: 'edit-input' }));
  }

  // 2. 确定性编译提示词
  const compileStartedAt = Date.now();
  upsertTrace({ id: 'compile-prompt', kind: 'tool', title: '编译方案提示词', detail: `「${schemeName}」`, status: 'running' });
  // 修复运行：把质量门建议作为纠偏要求并入用户简述（方案文档不变）。
  const brief = request.repair
    ? [request.brief.trim(), `修复要求：${request.repair.hint}`].filter(Boolean).join('\n')
    : request.brief;
  const compiled = compileSchemePrompt({
    document,
    inputValues: request.inputValues,
    brief,
    imageCount,
    ratioId: request.generation.ratioId,
    priorityMode,
  });
  repository.upsertRunStep(runId, 'compile-prompt', {
    status: 'completed',
    output: {
      promptLength: compiled.prompt.length,
      unresolvedVariables: compiled.unresolvedVariables,
      policySummary: compiled.policySummary,
    },
  });
  upsertTrace({
    id: 'compile-prompt',
    kind: 'tool',
    title: '编译方案提示词',
    detail: `${document.promptProgram.length} 个模块 · ${compiled.prompt.length} 字 · ${PRIORITY_MODE_LABEL[priorityMode]}`,
    status: compiled.unresolvedVariables.length > 0 ? 'warning' : 'success',
    durationMs: Date.now() - compileStartedAt,
  });
  if (compiled.unresolvedVariables.length > 0) {
    upsertTrace({
      id: 'compile-unresolved',
      kind: 'system',
      title: '部分模板变量未绑定输入',
      detail: `已按空值处理：${compiled.unresolvedVariables.join('、')}`,
      status: 'warning',
    });
  }
  if (!compiled.prompt.trim()) {
    repository.updateRunStatus(runId, 'failed');
    upsertTrace({ id: 'run-final', kind: 'system', title: `${modeLabel}失败`, detail: '方案编译出的提示词为空', status: 'error' });
    return fail(appError('INVALID_STATE', '方案编译出的提示词为空，请先修改方案', { recoveryAction: 'edit-input' }));
  }

  // 3. 逐张生图（张数、比例、Provider 由渲染进程模板固化）
  repository.updateRunStatus(runId, 'executing');
  const generationStartedAt = Date.now();
  upsertTrace({
    id: 'image-generation',
    kind: 'tool',
    title: '调用生图模型',
    detail: `${request.generation.providerName} · ${request.generation.jobIds.length} 张`,
    status: 'running',
  });
  const generations: DesignSchemeRunGeneration[] = [];
  for (const [resultIndex, jobId] of request.generation.jobIds.entries()) {
    if (deps.signal.aborted) {
      const outcome: DesignSchemeRunGeneration = {
        jobId,
        resultIndex,
        result: { historyId: jobId, status: 'cancelled', error: { code: 'CANCELLED', message: '已取消生成' } },
      };
      generations.push(outcome);
      deps.emit({ kind: 'run-generation-result', executionId: request.executionId, outcome });
      continue;
    }
    deps.emit({ kind: 'run-generation-start', executionId: request.executionId, jobId, resultIndex });
    const template = request.generation.requestTemplate;
    const generateRequest: GenerateImageRequest = {
      ...template,
      jobId,
      prompt: compiled.prompt,
      n: 1,
      workbench: template.workbench ? { ...template.workbench, resultIndex } : undefined,
    };
    const result = await runProviderGeneration(generateRequest, deps.sendProgress);
    const outcome: DesignSchemeRunGeneration = { jobId, resultIndex, result };
    if (request.mode === 'trial' && result.status === 'success' && result.imagePath) {
      // 首次成功试运行结果自动加入草稿相册（UI 规范 §5.2）；失败结果不进入相册。
      outcome.assetId = repository.insertLocalRunAsset(request.revisionId, result.imagePath);
    }
    repository.upsertRunStep(runId, `generate-${resultIndex}`, {
      status: result.status === 'success' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed',
      input: { jobId },
      output: {
        historyId: result.historyId,
        status: result.status,
        ...(outcome.assetId ? { assetId: outcome.assetId } : {}),
        ...(result.error ? { errorCode: result.error.code } : {}),
      },
    });
    generations.push(outcome);
    deps.emit({ kind: 'run-generation-result', executionId: request.executionId, outcome });
  }

  const succeeded = generations.filter((outcome) => outcome.result.status === 'success').length;
  const cancelled = generations.some((outcome) => outcome.result.status === 'cancelled');
  upsertTrace({
    id: 'image-generation',
    kind: 'tool',
    title: '调用生图模型',
    detail: `${succeeded}/${request.generation.jobIds.length} 张成功`,
    status: succeeded > 0 ? 'success' : 'error',
    durationMs: Date.now() - generationStartedAt,
  });

  // 4. 确定性质量门（开发规范 §5.5）：只对成功输出执行；结论不阻断运行，
  //    指标 + 逐张证据写入 evaluations 表，轨迹里给出可读结论。
  let evaluation: SchemeRunEvaluation | undefined;
  if (succeeded > 0) {
    repository.updateRunStatus(runId, 'evaluating');
    const outcome = evaluateSchemeRun({
      plannedCount: request.generation.jobIds.length,
      outputs: generations
        .filter((item) => item.result.status === 'success' && item.result.imagePath)
        .map((item) => ({ jobId: item.jobId, imagePath: item.result.imagePath! })),
      ratioId: request.generation.ratioId,
    });
    // 有限修复链（§12）：只有非修复运行才给修复建议，链长固定为 1。
    const repairHint = request.repair ? null : buildRepairHint(outcome.checks, request.generation.ratioId);
    const evaluationId = repository.insertEvaluation(runId, {
      passed: outcome.passed,
      metrics: { checks: outcome.checks, repairHint },
      evidence: outcome.evidence,
    });
    evaluation = {
      evaluationId,
      runId,
      passed: outcome.passed,
      checks: outcome.checks,
      repairHint,
      createdAt: Date.now(),
    };
    const warnings = outcome.checks.filter((check) => check.status !== 'pass');
    upsertTrace({
      id: 'quality-gate',
      kind: 'tool',
      title: '质量门检查',
      detail: outcome.checks.map((check) => `${check.label} ${check.detail ?? check.status}`).join(' · '),
      status: !outcome.passed ? 'error' : warnings.length > 0 ? 'warning' : 'success',
    });
  }

  repository.updateRunStatus(runId, succeeded > 0 ? 'completed' : cancelled ? 'cancelled' : 'failed');
  upsertTrace({
    id: 'run-final',
    kind: 'system',
    title: succeeded > 0
      ? (request.mode === 'trial' ? '试运行成功，结果已加入草稿相册' : '方案运行完成')
      : cancelled ? `${modeLabel}已取消` : `${modeLabel}失败`,
    status: succeeded > 0 ? 'success' : cancelled ? 'warning' : 'error',
  });

  return ok({
    runId,
    compiledPrompt: compiled.prompt,
    generations,
    trace: trace.map((item) => ({ ...item })),
    ...(evaluation ? { evaluation } : {}),
  });
}

function prepareRun(
  repository: DesignSchemeRepository,
  request: StartDesignSchemeRunRequest,
): AppResult<PreparedRun> {
  let document: DesignSchemeRevisionDocument | null;
  try {
    document = repository.getRevisionDocument(request.revisionId);
  } catch (error) {
    return fail(appError('UNKNOWN', error instanceof Error ? error.message : '读取方案版本失败', { retryable: true }));
  }
  if (!document || document.schemeId !== request.schemeId) {
    return fail(appError('MISSING_REFERENCE', '方案版本不存在或已被删除', { recoveryAction: 'retry' }));
  }
  let summary;
  try {
    summary = repository.requireSummary(request.schemeId);
  } catch {
    return fail(appError('MISSING_REFERENCE', '设计方案不存在', { recoveryAction: 'retry' }));
  }
  if (request.mode === 'formal') {
    // 草稿不能在普通 Composer 引用（规范 §2.2）；正式运行只允许当前正式版本。
    if (summary.status !== 'formal') {
      return fail(appError('INVALID_STATE', '草稿方案不能直接使用，请先完成试运行并设为正式', { recoveryAction: 'retry' }));
    }
    if (summary.currentRevisionId !== request.revisionId) {
      return fail(appError('INVALID_STATE', '该版本不是方案的当前正式版本', { recoveryAction: 'retry' }));
    }
  } else if (document.fidelity === 'unsupported') {
    // unsupported 方案可以保存和分享，但运行按钮必须禁用（规范 §2.3）。
    return fail(appError('INVALID_STATE', '该方案标记为暂不支持执行，只能查看来源与说明', { recoveryAction: 'retry' }));
  }
  return ok({ document, schemeName: summary.name });
}
