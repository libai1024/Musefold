import type Database from 'better-sqlite3';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  designSchemeRunInputSchema,
  type ParsedDesignSchemeRunInput,
  type ParsedPrepareDesignSchemeRunInput,
  type PlannedInput,
  type RunStep,
} from '@musefold/contracts';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { ulid } from 'ulid';
import { BridgeError } from '../ipc-v25/envelope';
import {
  readDesktopDesignSchemeProvider,
  sameDesktopProviderSnapshot,
  toDesktopProviderSnapshot,
} from './provider-snapshot';
import { DESKTOP_FIXED_RUN_PLAN_VERSION, validateDesktopFixedRunPlan } from './fixed-run-plan';

const TEXT_INPUT_KINDS = new Set(['text', 'article', 'choice']);
const REQUIRED_CHECKS = ['output-count', 'file-valid', 'aspect-ratio'] as const;

interface RunAuthority {
  summary: ReturnType<DesignSchemeRepository['requireSummary']>;
  document: NonNullable<ReturnType<DesignSchemeRepository['getRevisionDocument']>>;
  sourceSnapshotIds: string[];
  provider: ReturnType<typeof toDesktopProviderSnapshot>;
}

export interface DesktopFixedRunPlanDeps {
  designSchemeDb: Database.Database;
  coreDb: Database.Database;
  now?: () => number;
  createId?: () => string;
}

function fail(code: string, message: string): never {
  throw new BridgeError(code, message);
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameItemSet(left: readonly string[], right: readonly string[]): boolean {
  return sameItems([...left].sort(), [...right].sort());
}

function resolveAuthority(
  input: Pick<
    ParsedPrepareDesignSchemeRunInput,
    'schemeId' | 'revisionId' | 'mode' | 'executionSettings'
  >,
  deps: DesktopFixedRunPlanDeps,
): RunAuthority {
  const repository = new DesignSchemeRepository(deps.designSchemeDb);
  let summary: ReturnType<DesignSchemeRepository['requireSummary']>;
  try {
    summary = repository.requireSummary(input.schemeId);
  } catch {
    fail('NOT_FOUND', '设计方案不存在或已删除');
  }
  let document: ReturnType<DesignSchemeRepository['getRevisionDocument']>;
  try {
    document = repository.getRevisionDocument(input.revisionId);
  } catch {
    fail('DESIGN_SCHEME_DOCUMENT_UNMAPPABLE', '设计方案版本无法读取');
  }
  if (!document || document.schemeId !== input.schemeId) {
    fail('NOT_FOUND', '设计方案版本不存在或不属于当前方案');
  }
  if (document.fidelity === 'unsupported') {
    fail('DESIGN_SCHEME_RUN_UNSUPPORTED', '该方案标记为暂不支持执行');
  }
  if (input.mode === 'formal') {
    if (summary.status !== 'formal') {
      fail('DESIGN_SCHEME_FORMAL_REQUIRED', '草稿方案不能直接正式运行');
    }
    if (summary.currentRevisionId !== input.revisionId) {
      fail('DESIGN_SCHEME_REVISION_MISMATCH', '正式运行必须使用当前正式版本');
    }
  }

  const boundSnapshotIds = repository
    .listSourceSnapshotMetadata(input.schemeId, input.revisionId)
    .map((snapshot) => snapshot.snapshotId);
  if (new Set(boundSnapshotIds).size !== boundSnapshotIds.length) {
    fail('DESIGN_SCHEME_SOURCE_SNAPSHOT_INVALID', '方案版本的本地来源快照绑定重复');
  }
  const declaredSnapshotIds = document.sourceSnapshotIds;
  if (
    declaredSnapshotIds !== undefined &&
    (new Set(declaredSnapshotIds).size !== declaredSnapshotIds.length ||
      !sameItemSet(boundSnapshotIds, declaredSnapshotIds))
  ) {
    fail('DESIGN_SCHEME_SOURCE_SNAPSHOT_INVALID', '方案版本声明的来源快照与本地权威绑定不一致');
  }
  const sourceSnapshotIds = declaredSnapshotIds ?? [...boundSnapshotIds].sort();

  const provider = toDesktopProviderSnapshot(
    readDesktopDesignSchemeProvider(deps.coreDb, input.executionSettings.providerId),
  );
  return { summary, document, sourceSnapshotIds, provider };
}

function prepareTextInputs(
  input: ParsedPrepareDesignSchemeRunInput,
  authority: RunAuthority,
): PlannedInput[] {
  if (input.executionSettings.referenceAssetIds.length > 0) {
    fail('DESIGN_SCHEME_TEXT_ONLY_UNSUPPORTED', '当前运行计划仅支持文本输入，参考图运行尚未接入');
  }
  const slotIds = new Set(authority.document.inputs.map((slot) => slot.id));
  if (Object.keys(input.inputValues).some((slotId) => !slotIds.has(slotId))) {
    fail('DESIGN_SCHEME_INPUT_MISMATCH', '输入值包含当前方案版本未声明的槽位');
  }
  return authority.document.inputs.map((slot) => {
    if (!TEXT_INPUT_KINDS.has(slot.kind)) {
      fail(
        'DESIGN_SCHEME_TEXT_ONLY_UNSUPPORTED',
        '当前运行计划仅支持纯文本方案，图片输入槽位尚未接入',
      );
    }
    const text = input.inputValues[slot.id] ?? '';
    if (slot.required && !text.trim()) {
      fail('DESIGN_SCHEME_INPUT_REQUIRED', `请先填写必需输入：${slot.label}`);
    }
    return { slotId: slot.id, kind: slot.kind, valueIds: [], text };
  });
}

function step(id: string, kind: RunStep['kind'], dependsOn: string[]): RunStep {
  return {
    id,
    kind,
    dependsOn,
    inputRefs: [],
    outputRefs: [],
    timeoutMs: kind === 'generate-image' ? 600_000 : 30_000,
    maxAttempts: 1,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

export function prepareDesktopDesignSchemeRun(
  input: ParsedPrepareDesignSchemeRunInput,
  deps: DesktopFixedRunPlanDeps,
): ParsedDesignSchemeRunInput {
  const authority = resolveAuthority(input, deps);
  const inputs = prepareTextInputs(input, authority);
  const createId = deps.createId ?? (() => ulid());
  const now = (deps.now ?? Date.now)();
  const inspectId = `inspect_${createId()}`;
  const compileId = `compile_${createId()}`;
  const generateId = `generate_${createId()}`;
  const evaluateId = `evaluate_${createId()}`;
  const inputValues = Object.fromEntries(
    inputs.map((planned) => [planned.slotId, planned.text ?? '']),
  );
  const result = designSchemeRunInputSchema.parse({
    ...input,
    inputValues,
    schemeStatus: authority.summary.status,
    schemeFidelity: authority.document.fidelity,
    plan: {
      id: `plan_${createId()}`,
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeRevisionId: authority.document.revisionId,
      sourceSnapshotIds: authority.sourceSnapshotIds,
      inputs,
      steps: [
        step(inspectId, 'inspect-input', []),
        step(compileId, 'compile-prompt', [inspectId]),
        step(generateId, 'generate-image', [compileId]),
        step(evaluateId, 'evaluate-image', [generateId]),
      ],
      provider: authority.provider,
      policy: {
        priorityMode: input.priorityMode,
        schemeRevisionId: authority.document.revisionId,
        policyVersion: DESKTOP_FIXED_RUN_PLAN_VERSION,
        appliedAt: now,
      },
      budget: {
        maxSteps: 4,
        maxOutputs: input.executionSettings.outputCount,
        maxRepairRuns: 1,
      },
      evaluation: {
        ratio: input.executionSettings.aspectRatio ?? null,
        requiredChecks: [...REQUIRED_CHECKS],
      },
    },
    repair: null,
  });
  const compatibility = validateDesktopFixedRunPlan(result);
  if (!compatibility.ok) {
    fail(compatibility.code, `${compatibility.path}: ${compatibility.message}`);
  }
  return result;
}

export function assertDesktopPreparedRunAuthority(
  input: ParsedDesignSchemeRunInput,
  deps: DesktopFixedRunPlanDeps,
): void {
  const authority = resolveAuthority(input, deps);
  const inputShapeMatches =
    input.plan.inputs.length === authority.document.inputs.length &&
    input.plan.inputs.every((planned, index) => {
      const slot = authority.document.inputs[index];
      return slot?.id === planned.slotId && slot.kind === planned.kind;
    });
  if (
    input.schemeStatus !== authority.summary.status ||
    input.schemeFidelity !== authority.document.fidelity ||
    input.plan.schemaVersion !== authority.document.schemaVersion ||
    !sameItems(input.plan.sourceSnapshotIds, authority.sourceSnapshotIds) ||
    !inputShapeMatches ||
    !sameDesktopProviderSnapshot(input.plan.provider, authority.provider)
  ) {
    fail(
      'DESIGN_SCHEME_RUN_SNAPSHOT_MISMATCH',
      '方案版本、来源或 AI 连接已变化，请重新生成运行计划',
    );
  }
}
