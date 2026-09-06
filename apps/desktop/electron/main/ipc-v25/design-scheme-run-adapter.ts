import { rm } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import {
  designSchemeEventSchema,
  runResultSchema,
  type DesignSchemeEvent,
  type DesignSchemeRunPlan,
  type EvaluationCheck,
  type ParsedDesignSchemeRunInput,
  type ProviderSnapshot,
  type RunEvaluation,
  type RunResult,
  type RunStep,
  type StructuredDesignSchemeError,
} from '@musefold/contracts';
import type {
  WorkbenchRunContext,
  GenerateImageRequest,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import type { DesignSchemeRunResult as RetainedDesignSchemeRunResult } from '@musefold/desktop-contracts/design-scheme';
import { getDb } from '@musefold/core/db';
import { cancelGeneration } from '../generation-facade';
import { stageLocalImage } from '@musefold/core/providers/local-image';
import { resolvePromptReferences, resolveUploadedReferenceById } from './workbench-domain';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { probeImageAssetMetadata } from '../design-scheme/source-ingestion';
import { resolveManagedStoreKey } from '../design-scheme/asset-store';
import { validateDesktopFixedRunPlan } from '../design-scheme/fixed-run-plan';
import { assertDesktopPreparedRunAuthority } from '../design-scheme/fixed-run-plan-builder';
import {
  readDesktopDesignSchemeProvider,
  toDesktopProviderSnapshot,
} from '../design-scheme/provider-snapshot';
import type {
  DesignSchemeExecutionRegistry,
  DesignSchemeExecutionKind,
} from '../design-scheme/execution-registry';
import { runDesignScheme, finalizeDesignSchemeRun } from '../design-scheme/run-session';
import { BridgeError } from './envelope';

export interface DesktopDesignSchemeRunAdapterDeps {
  db: Database.Database;
  userDataDir: string;
  picturesDir: string;
  coreDb?: Database.Database;
  executionRegistry: DesignSchemeExecutionRegistry;
  emit: (senderId: number, event: DesignSchemeEvent) => void;
  stageReferenceAsset?: (path: string) => Promise<LocalImageReference>;
  /** Composer 上传暂存 id → 受管本地参考图;缺省读 workbench 上传目录,测试注入。 */
  resolveUploadedReference?: (assetId: string) => LocalImageReference | null;
}

interface SchemeAssetRow {
  id: string;
  store_key: string;
}

const FIXED_PLAN_KINDS = [
  'inspect-input',
  'compile-prompt',
  'generate-image',
  'evaluate-image',
] as const;

function scrubMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/][^\s;]*/g, '[路径已脱敏]')
    .replace(/(?:\/(?:Users|home|tmp|var|private)\/)[^\s;]*/g, '[路径已脱敏]')
    .slice(0, 500);
}

function errorFor(
  code: string,
  message: string,
  options: Partial<Pick<StructuredDesignSchemeError, 'retryable' | 'recoveryAction'>> = {},
): StructuredDesignSchemeError {
  const recoveryAction = options.recoveryAction ?? 'none';
  return {
    code: /^[A-Z][A-Z0-9_.-]{1,79}$/.test(code) ? code : 'DESIGN_SCHEME_RUN_FAILED',
    message: scrubMessage(message),
    retryable: options.retryable ?? false,
    recoveryAction,
  };
}

function errorFromUnknown(error: unknown): StructuredDesignSchemeError {
  if (error instanceof BridgeError) return errorFor(error.code, error.message);
  const candidate = error as { code?: string; message?: string };
  return errorFor(
    candidate.code ?? 'DESIGN_SCHEME_RUN_FAILED',
    candidate.message ?? '方案运行失败',
  );
}

function appErrorToCanonical(error: {
  code: string;
  message: string;
  retryable?: boolean;
  recoveryAction?: string;
}): StructuredDesignSchemeError {
  const recoveryAction =
    error.recoveryAction === 'edit-input'
      ? 'edit-input'
      : error.recoveryAction === 'configure-ai'
        ? 'configure-ai'
        : error.recoveryAction === 'configure-provider'
          ? 'choose-provider'
          : error.recoveryAction === 'select-source'
            ? 'choose-source'
            : error.recoveryAction === 'retry'
              ? 'retry'
              : 'none';
  return errorFor(error.code, error.message, {
    retryable: error.retryable,
    recoveryAction,
  });
}

function resolveProvider(input: ParsedDesignSchemeRunInput, db: Database.Database) {
  const row = readDesktopDesignSchemeProvider(db, input.executionSettings.providerId);
  const actual = toDesktopProviderSnapshot(row);
  const planned = input.plan.provider;
  if (
    planned.providerId !== actual.providerId ||
    planned.providerName !== actual.providerName ||
    planned.model !== actual.model ||
    planned.providerVersion !== actual.providerVersion ||
    planned.capabilities.text !== actual.capabilities.text ||
    planned.capabilities.vision !== actual.capabilities.vision ||
    planned.capabilities.image !== actual.capabilities.image ||
    planned.capabilities.multiImage !== actual.capabilities.multiImage ||
    planned.capabilities.editing !== actual.capabilities.editing
  ) {
    throw new BridgeError(
      'DESIGN_SCHEME_PROVIDER_SNAPSHOT_MISMATCH',
      'AI 连接配置已变化，请重新生成运行计划',
    );
  }
  return row;
}

function resolveWorkbenchContext(
  sessionId: string | undefined,
  userPrompt: string,
  db: Database.Database,
): WorkbenchRunContext | undefined {
  if (!sessionId) return undefined;
  const session = db
    .prepare('SELECT id, title, deleted_at FROM workbench_sessions WHERE id = ?')
    .get(sessionId) as { id: string; title: string; deleted_at: number | null } | undefined;
  if (!session) throw new BridgeError('NOT_FOUND', '工作台会话不存在');
  if (session.deleted_at != null)
    throw new BridgeError('CONFLICT', '工作台会话已删除，不能继续生成');
  const next = db
    .prepare(
      'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next FROM generation_runs WHERE workbench_session_id = ?',
    )
    .get(session.id) as { next: number };
  return {
    sessionId: session.id,
    sessionTitle: session.title,
    turnId: ulid(),
    turnIndex: next.next,
    resultIndex: 0,
    userPrompt,
  };
}

function toCorePromptReferences(
  references: ReturnType<typeof resolvePromptReferences>,
): NonNullable<GenerateImageRequest['promptReferences']> {
  return references.map((reference) => ({
    promptId: reference.promptId ?? '',
    title: reference.title,
    text: reference.text,
    scope: reference.scope,
    sourceVersion: reference.sourceVersion,
  }));
}

async function resolveReferenceAssets(
  input: ParsedDesignSchemeRunInput,
  deps: DesktopDesignSchemeRunAdapterDeps,
): Promise<{ references: LocalImageReference[]; stagedPaths: string[] }> {
  if (input.executionSettings.referenceAssetIds.length === 0) {
    return { references: [], stagedPaths: [] };
  }
  const stage = deps.stageReferenceAsset ?? stageLocalImage;
  const resolveUploaded = deps.resolveUploadedReference ?? resolveUploadedReferenceById;
  const references: LocalImageReference[] = [];
  const stagedPaths: string[] = [];
  try {
    for (const assetId of input.executionSettings.referenceAssetIds) {
      // 先认当前方案版本的资产(相册/来源图),再认 Composer 本次上传的暂存参考图;两者都在受管根内。
      const row = deps.db
        .prepare(
          `SELECT a.id, a.store_key
             FROM design_scheme_assets a
             JOIN design_scheme_revisions r ON r.revision_id = a.revision_id
            WHERE a.id = ? AND r.scheme_id = ? AND r.revision_id = ?
            LIMIT 1`,
        )
        .get(assetId, input.schemeId, input.revisionId) as SchemeAssetRow | undefined;
      let target: string | null = null;
      if (row) {
        target = resolveManagedStoreKey(row.store_key, deps.userDataDir, deps.picturesDir);
      } else {
        target = resolveUploaded(assetId)?.path ?? null;
      }
      if (!target)
        throw new BridgeError(
          'DESIGN_SCHEME_REFERENCE_MISSING',
          '参考图已不可用，请重新添加后再运行',
        );
      const staged = await stage(target);
      references.push({ ...staged, assetId, source: 'upload' });
      stagedPaths.push(staged.path);
    }
    return { references, stagedPaths };
  } catch (error) {
    await Promise.all(stagedPaths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    throw error;
  }
}

function outputEntries(
  result: RetainedDesignSchemeRunResult,
  runId: string,
): {
  outputs: RunResult['outputs'];
  outputIdsByJob: Map<string, string[]>;
} {
  const outputs: RunResult['outputs'] = [];
  const outputIdsByJob = new Map<string, string[]>();
  for (const generation of result.generations) {
    if (generation.result.status !== 'success') continue;
    const images =
      generation.result.images?.filter((image) => Boolean(image.imagePath)) ??
      (generation.result.imagePath ? [{ imagePath: generation.result.imagePath }] : []);
    const ids: string[] = [];
    for (const [imageIndex, image] of images.entries()) {
      if (!image.imagePath) continue;
      const metadata = probeImageAssetMetadata(image.imagePath);
      if (!metadata) {
        throw new BridgeError('DESIGN_SCHEME_OUTPUT_UNMAPPABLE', '生成结果缺少可验证的图片元数据');
      }
      const id =
        imageIndex === 0 && generation.assetId
          ? generation.assetId
          : `${generation.jobId}_${imageIndex + 1}`;
      ids.push(id);
      outputs.push({
        id,
        origin: 'local-run',
        mimeType: metadata.mimeType,
        width: metadata.width,
        height: metadata.height,
        byteSize: metadata.byteSize,
        contentHash: metadata.contentHash,
        role: outputs.length === 0 ? 'primary' : 'variant',
        license: null,
        runId,
        createdAt: Date.now(),
      });
    }
    outputIdsByJob.set(generation.jobId, ids);
  }
  return { outputs, outputIdsByJob };
}

function evaluationResult(
  retained: RetainedDesignSchemeRunResult['evaluation'] | undefined,
  input: ParsedDesignSchemeRunInput,
  runId: string,
  outputIdsByJob: Map<string, string[]>,
): RunEvaluation | null {
  if (!retained) return null;
  const allOutputIds = [...outputIdsByJob.values()].flat();
  const checks: EvaluationCheck[] = retained.checks.map((check) => ({
    id: check.id,
    label: check.label,
    status: check.status,
    ...(check.detail ? { detail: check.detail } : {}),
    evidenceOutputIds: allOutputIds,
  }));
  return {
    evaluationId: retained.evaluationId,
    runId,
    passed: retained.passed,
    checks,
    repairHint: retained.repairHint,
    repair: input.repair,
    createdAt: retained.createdAt,
  };
}

function finalSteps(
  plan: DesignSchemeRunPlan,
  status: RunResult['status'],
  evaluation: RunEvaluation | null,
  error: StructuredDesignSchemeError | null,
): RunStep[] {
  const now = Date.now();
  return plan.steps.map((step, index) => {
    let nextStatus: RunStep['status'] = 'pending';
    if (index < 2) nextStatus = status === 'blocked' && index === 1 ? 'pending' : 'completed';
    if (index === 2) {
      nextStatus =
        status === 'completed'
          ? 'completed'
          : status === 'cancelled'
            ? 'cancelled'
            : status === 'failed'
              ? 'failed'
              : 'pending';
    }
    if (index === 3) nextStatus = evaluation ? 'completed' : 'pending';
    return {
      ...step,
      status: nextStatus,
      startedAt: nextStatus === 'pending' ? null : now,
      completedAt: nextStatus === 'pending' ? null : now,
      error: nextStatus === 'failed' && error ? error : null,
    };
  });
}

function finalizeExistingDesignSchemeRun(
  db: Database.Database,
  runId: string,
  status: 'completed' | 'blocked' | 'failed' | 'cancelled',
): void {
  const row = db.prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?').get(runId) as
    | { status: string }
    | undefined;
  if (!row || !['planning', 'executing', 'evaluating'].includes(row.status)) return;
  finalizeDesignSchemeRun(db, runId, status);
}

function emitChecked(
  deps: DesktopDesignSchemeRunAdapterDeps,
  senderId: number,
  event: DesignSchemeEvent,
): void {
  deps.emit(senderId, designSchemeEventSchema.parse(event));
}

function isCancellationRequested(
  deps: DesktopDesignSchemeRunAdapterDeps,
  senderId: number,
  executionId: string,
  signal: AbortSignal,
): boolean {
  if (signal.aborted) return true;
  const execution = deps.executionRegistry.get(senderId, executionId);
  return (
    execution.status === 'already-terminal' && execution.execution.terminalStatus === 'cancelled'
  );
}

function runRecord(
  input: ParsedDesignSchemeRunInput,
  provider: ProviderSnapshot,
  runId: string,
  status: 'planning' | 'completed' | 'failed' | 'cancelled' | 'blocked',
  createdAt: number,
  completedAt: number | null,
) {
  const policy = input.plan.policy ?? input.plan.prioritySnapshot;
  if (!policy) throw new BridgeError('DESIGN_SCHEME_PLAN_INCOMPATIBLE', '运行计划缺少策略快照');
  return {
    runId,
    schemeId: input.schemeId,
    revisionId: input.revisionId,
    schemeStatus: input.schemeStatus,
    schemeFidelity: input.schemeFidelity,
    mode: input.mode,
    status,
    policy,
    provider,
    createdAt,
    completedAt,
    repair: input.repair,
  } as const;
}

export async function runCanonicalDesignScheme(
  input: ParsedDesignSchemeRunInput,
  senderId: number,
  deps: DesktopDesignSchemeRunAdapterDeps,
): Promise<RunResult> {
  const compatibility = validateDesktopFixedRunPlan(input);
  if (!compatibility.ok) {
    throw new BridgeError(compatibility.code, `${compatibility.path}: ${compatibility.message}`);
  }

  const coreDb = deps.coreDb ?? getDb();
  const runId = `dsr_${ulid()}`;
  const controller = new AbortController();
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const registration = deps.executionRegistry.register({
    executionId: input.executionId,
    senderId,
    kind: 'run' satisfies DesignSchemeExecutionKind,
    abortController: controller,
    activeJobIds: Array.from({ length: input.executionSettings.outputCount }, () => ulid()),
    cancelJob: (jobId) => cancelGeneration(jobId, coreDb),
    completion,
  });
  if (registration.status === 'duplicate-active') {
    resolveCompletion();
    throw new BridgeError('DESIGN_SCHEME_EXECUTION_DUPLICATE', '该执行仍在进行中，请等待其结束');
  }
  if (registration.status === 'already-terminal') {
    resolveCompletion();
    throw new BridgeError('DESIGN_SCHEME_EXECUTION_TERMINAL', '该执行已经结束');
  }

  const createdAt = Date.now();
  const jobIds = [...registration.execution.activeJobIds];
  const activeJobIds = new Set(jobIds);
  let stagedPaths: string[] = [];
  let terminalStatus: 'completed' | 'failed' | 'cancelled' = 'failed';
  try {
    const provider = resolveProvider(input, coreDb);
    assertDesktopPreparedRunAuthority(input, {
      designSchemeDb: deps.db,
      coreDb,
    });
    const repository = new DesignSchemeRepository(deps.db);
    const document = repository.getRevisionDocument(input.revisionId);
    if (!document) throw new BridgeError('NOT_FOUND', '设计方案版本不存在');
    const promptReferences = resolvePromptReferences(
      input.executionSettings.promptReferenceSelections,
      coreDb,
    );
    const resolvedReferences = await resolveReferenceAssets(input, deps);
    stagedPaths = resolvedReferences.stagedPaths;
    const workbench = resolveWorkbenchContext(
      input.executionSettings.workbenchSessionId,
      input.brief,
      coreDb,
    );

    const policy = input.plan.policy ?? input.plan.prioritySnapshot;
    if (!policy) throw new BridgeError('DESIGN_SCHEME_PLAN_INCOMPATIBLE', '运行计划缺少策略快照');
    emitChecked(deps, senderId, {
      kind: 'run-created',
      executionId: input.executionId,
      run: runRecord(
        input,
        toDesktopProviderSnapshot(provider),
        runId,
        'planning',
        createdAt,
        null,
      ),
    });
    emitChecked(deps, senderId, {
      kind: 'run-planned',
      executionId: input.executionId,
      runId,
      plan: input.plan,
    });
    const inspectStepId = input.plan.steps[0]?.id;
    const compileStepId = input.plan.steps[1]?.id;
    const generateStepId = input.plan.steps[2]?.id;
    const evaluateStepId = input.plan.steps[3]?.id;
    if (!inspectStepId || !compileStepId || !generateStepId || !evaluateStepId) {
      throw new BridgeError('DESIGN_SCHEME_PLAN_INCOMPATIBLE', '运行计划缺少固定步骤');
    }
    emitChecked(deps, senderId, {
      kind: 'step-started',
      executionId: input.executionId,
      runId,
      stepId: inspectStepId,
    });
    emitChecked(deps, senderId, {
      kind: 'step-completed',
      executionId: input.executionId,
      runId,
      stepId: inspectStepId,
      outputIds: [],
    });
    emitChecked(deps, senderId, {
      kind: 'step-started',
      executionId: input.executionId,
      runId,
      stepId: compileStepId,
    });

    const requestTemplate: GenerateImageRequest = {
      providerId: provider.id,
      model: provider.model,
      prompt: '',
      negative: input.executionSettings.negativePrompt,
      size: input.executionSettings.size,
      aspectRatio: input.executionSettings.aspectRatio,
      quality: input.executionSettings.quality,
      n: 1,
      ...(resolvedReferences.references.length > 0
        ? { referenceImages: resolvedReferences.references }
        : {}),
      ...(promptReferences.length > 0
        ? { promptReferences: toCorePromptReferences(promptReferences) }
        : {}),
      ...(workbench ? { workbench } : {}),
    };

    const legacyRequest = {
      executionId: input.executionId,
      schemeId: input.schemeId,
      revisionId: input.revisionId,
      mode: input.mode,
      priorityMode: input.priorityMode,
      brief: input.brief,
      inputValues: input.inputValues,
      runId,
      generation: {
        requestTemplate,
        jobIds,
        providerName: provider.name,
        ratioId: input.executionSettings.aspectRatio ?? 'auto',
      },
      ...(input.repair
        ? { repair: { ofRunId: input.repair.repairOfRunId, hint: input.repair.hint } }
        : {}),
    };

    const runGenerationStarted = { value: false };
    const retained = await runDesignScheme(legacyRequest, {
      db: deps.db,
      coreDb,
      emit: (event) => {
        if (event.kind === 'run-generation-start' && !runGenerationStarted.value) {
          runGenerationStarted.value = true;
          emitChecked(deps, senderId, {
            kind: 'step-completed',
            executionId: input.executionId,
            runId,
            stepId: compileStepId,
            outputIds: [],
          });
          emitChecked(deps, senderId, {
            kind: 'step-started',
            executionId: input.executionId,
            runId,
            stepId: generateStepId,
          });
        }
        if (event.kind === 'run-generation-result') {
          activeJobIds.delete(event.outcome.jobId);
          deps.executionRegistry.setActiveJobIds(senderId, input.executionId, activeJobIds);
        }
      },
      sendProgress: () => undefined,
      deferTerminalStatus: true,
      signal: controller.signal,
    });

    if (!retained.ok) {
      const cancellationRequested = isCancellationRequested(
        deps,
        senderId,
        input.executionId,
        controller.signal,
      );
      const error = cancellationRequested
        ? errorFor('CANCELLED', '已取消', { recoveryAction: 'none' })
        : appErrorToCanonical(retained.error);
      const status: RunResult['status'] =
        cancellationRequested || retained.error.code === 'CANCELLED'
          ? 'cancelled'
          : retained.error.code === 'REQUIRED'
            ? 'blocked'
            : 'failed';
      terminalStatus = status === 'cancelled' ? 'cancelled' : 'failed';
      const canonicalResult = runResultSchema.parse({
        runId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        mode: input.mode,
        status,
        compiledPrompt: null,
        outputs: [],
        steps: finalSteps(input.plan, status, null, error),
        evaluation: null,
        repair: input.repair,
        error,
        createdAt,
        completedAt: Date.now(),
      } satisfies RunResult);
      const terminalEvent = designSchemeEventSchema.parse(
        status === 'blocked'
          ? { kind: 'blocked', executionId: input.executionId, runId, error }
          : status === 'cancelled'
            ? { kind: 'cancelled', executionId: input.executionId, runId }
            : { kind: 'failed', executionId: input.executionId, runId, error },
      );
      finalizeExistingDesignSchemeRun(deps.db, runId, status);
      deps.emit(senderId, terminalEvent);
      return canonicalResult;
    }

    const outputData = outputEntries(retained.data, runId);
    const generationCancelled = retained.data.generations.some(
      (generation) => generation.result.status === 'cancelled',
    );
    const cancellationRequested =
      generationCancelled ||
      isCancellationRequested(deps, senderId, input.executionId, controller.signal);
    const cancelWithOutputs = (): RunResult => {
      const cancelledError = errorFor('CANCELLED', '已取消', { recoveryAction: 'none' });
      const cancelledResult = runResultSchema.parse({
        runId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        mode: input.mode,
        status: 'cancelled',
        compiledPrompt: retained.data.compiledPrompt,
        outputs: outputData.outputs,
        steps: finalSteps(input.plan, 'cancelled', null, cancelledError),
        evaluation: null,
        repair: input.repair,
        error: cancelledError,
        createdAt,
        completedAt: Date.now(),
      } satisfies RunResult);
      terminalStatus = 'cancelled';
      finalizeExistingDesignSchemeRun(deps.db, runId, 'cancelled');
      emitChecked(deps, senderId, {
        kind: 'cancelled',
        executionId: input.executionId,
        runId,
      });
      return cancelledResult;
    };
    if (cancellationRequested) return cancelWithOutputs();
    const evaluation = evaluationResult(
      retained.data.evaluation,
      input,
      runId,
      outputData.outputIdsByJob,
    );
    const succeeded = retained.data.generations.some(
      (generation) => generation.result.status === 'success',
    );
    const cancelled = retained.data.generations.some(
      (generation) => generation.result.status === 'cancelled',
    );
    const status: RunResult['status'] = succeeded
      ? 'completed'
      : cancelled
        ? 'cancelled'
        : 'failed';
    terminalStatus = status === 'completed' ? 'completed' : status;
    const error =
      status === 'completed'
        ? null
        : errorFor(
            status === 'cancelled' ? 'CANCELLED' : 'DESIGN_SCHEME_RUN_FAILED',
            status === 'cancelled' ? '已取消' : '方案运行失败',
            {
              recoveryAction: status === 'cancelled' ? 'none' : 'retry',
            },
          );
    const result: RunResult = {
      runId,
      schemeId: input.schemeId,
      revisionId: input.revisionId,
      mode: input.mode,
      status,
      compiledPrompt: retained.data.compiledPrompt,
      outputs: outputData.outputs,
      steps: finalSteps(input.plan, status, evaluation, error),
      evaluation,
      repair: input.repair,
      error,
      createdAt,
      completedAt: Date.now(),
    };
    const cancellationResult = (): RunResult | null =>
      isCancellationRequested(deps, senderId, input.executionId, controller.signal)
        ? cancelWithOutputs()
        : null;
    if (runGenerationStarted.value) {
      emitChecked(deps, senderId, {
        kind: 'step-completed',
        executionId: input.executionId,
        runId,
        stepId: generateStepId,
        outputIds: outputData.outputs.map((output) => output.id),
      });
      const cancelledAfterGeneration = cancellationResult();
      if (cancelledAfterGeneration) return cancelledAfterGeneration;
    }
    if (evaluation) {
      emitChecked(deps, senderId, {
        kind: 'step-started',
        executionId: input.executionId,
        runId,
        stepId: evaluateStepId,
      });
      const cancelledAfterEvaluationStarted = cancellationResult();
      if (cancelledAfterEvaluationStarted) return cancelledAfterEvaluationStarted;
      emitChecked(deps, senderId, {
        kind: 'step-completed',
        executionId: input.executionId,
        runId,
        stepId: evaluateStepId,
        outputIds: outputData.outputs.map((output) => output.id),
      });
      const cancelledAfterEvaluationCompleted = cancellationResult();
      if (cancelledAfterEvaluationCompleted) return cancelledAfterEvaluationCompleted;
      emitChecked(deps, senderId, {
        kind: 'evaluation-completed',
        executionId: input.executionId,
        evaluation,
      });
      const cancelledAfterEvaluationEvent = cancellationResult();
      if (cancelledAfterEvaluationEvent) return cancelledAfterEvaluationEvent;
    }
    const cancelledBeforeTerminalCommit = cancellationResult();
    if (cancelledBeforeTerminalCommit) return cancelledBeforeTerminalCommit;
    if (status === 'completed') {
      const canonicalResult = runResultSchema.parse(result);
      finalizeExistingDesignSchemeRun(deps.db, runId, 'completed');
      deps.executionRegistry.markTerminal(senderId, input.executionId, 'completed');
      emitChecked(deps, senderId, {
        kind: 'completed',
        executionId: input.executionId,
        result: canonicalResult,
      });
      return canonicalResult;
    }

    const canonicalResult = runResultSchema.parse(result);
    finalizeExistingDesignSchemeRun(deps.db, runId, status);
    if (status === 'cancelled') {
      emitChecked(deps, senderId, { kind: 'cancelled', executionId: input.executionId, runId });
    } else {
      emitChecked(deps, senderId, {
        kind: 'failed',
        executionId: input.executionId,
        runId,
        error: error as StructuredDesignSchemeError,
      });
    }
    return canonicalResult;
  } catch (error) {
    terminalStatus = controller.signal.aborted ? 'cancelled' : 'failed';
    const canonicalError = errorFromUnknown(error);
    const canonicalResult = runResultSchema.parse({
      runId,
      schemeId: input.schemeId,
      revisionId: input.revisionId,
      mode: input.mode,
      status: terminalStatus,
      compiledPrompt: null,
      outputs: [],
      steps: finalSteps(input.plan, terminalStatus, null, canonicalError),
      evaluation: null,
      repair: input.repair,
      error: canonicalError,
      createdAt,
      completedAt: Date.now(),
    } satisfies RunResult);
    finalizeExistingDesignSchemeRun(deps.db, runId, terminalStatus);
    if (terminalStatus === 'cancelled') {
      emitChecked(deps, senderId, { kind: 'cancelled', executionId: input.executionId, runId });
    } else {
      emitChecked(deps, senderId, {
        kind: 'failed',
        executionId: input.executionId,
        runId,
        error: canonicalError,
      });
    }
    return canonicalResult;
  } finally {
    await Promise.all(stagedPaths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    deps.executionRegistry.setActiveJobIds(senderId, input.executionId, []);
    if (terminalStatus === 'cancelled') {
      deps.executionRegistry.cancel(senderId, input.executionId);
    } else {
      deps.executionRegistry.markTerminal(senderId, input.executionId, terminalStatus);
    }
    resolveCompletion();
  }
}

export function fixedPlanKinds(): readonly string[] {
  return FIXED_PLAN_KINDS;
}
