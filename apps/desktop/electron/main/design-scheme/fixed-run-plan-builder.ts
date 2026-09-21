import { readRevisionAssetIds } from '@musefold/core/db/design-scheme/revision-assets';
import type Database from 'better-sqlite3';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  designSchemeRunInputSchema,
  type ParsedDesignSchemeRunInput,
  type ParsedPrepareDesignSchemeRunInput,
  type PlannedInput,
  type RunStep,
  type ExecutionBinding,
} from '@musefold/contracts';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
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
const IMAGE_INPUT_KINDS = new Set(['image', 'image-set']);
const REQUIRED_CHECKS = ['output-count', 'file-valid', 'aspect-ratio'] as const;

/** 参考图 id 是否可被主进程解析为受管图片(方案资产或本次上传暂存);路径绝不出主进程。 */
export type ResolveReferenceAsset = (assetId: string) => boolean;

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
  /**
   * 参考图解析 seam:true = 该 id 在本机可用(当前方案版本的资产,或 Composer 上传暂存)。
   * 缺省只认方案资产;宿主域注入含上传暂存的实现。
   */
  hasReferenceAsset?: ResolveReferenceAsset;
  /** Authenticated host result, never copied from a renderer-supplied expectation. */
  cloudBinding?: ExecutionBinding;
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

  const row = readDesktopDesignSchemeProvider(deps.coreDb, input.executionSettings.providerId);
  const provider = toDesktopProviderSnapshot(row, deps.cloudBinding);
  if (
    (input.executionSettings.model !== undefined &&
      input.executionSettings.model !== provider.model) ||
    (input.executionSettings.expectedBinding &&
      (row.type !== 'musefold-cloud' ||
        automationInputHash(input.executionSettings.expectedBinding) !==
          automationInputHash(deps.cloudBinding)))
  )
    fail(
      'DESIGN_SCHEME_PROVIDER_SNAPSHOT_MISMATCH',
      '所选模型或账号身份已变化，请重新生成运行计划',
    );
  return { summary, document, sourceSnapshotIds, provider };
}

function schemeAssetExists(
  db: Database.Database,
  schemeId: string,
  revisionId: string,
  assetId: string,
): boolean {
  return readRevisionAssetIds(db, schemeId, revisionId).includes(assetId);
}

/**
 * 槽位快照:文本槽位冻结文本值;图片槽位按声明顺序消费参考图 id(承旧 assignedImages 分配语义):
 * `image` 最多 1 张、`image-set` 最多 maxItems 张;必需槽位至少 minItems(缺省 1)张,不足即 blocked;
 * 可选槽位有多少收多少(与 Composer 就绪判断一致,不因可选槽位的 minItems 阻断运行)。
 * 校验器要求全部参考图都落进某个图片槽位,多出的参考图同样 blocked,不静默丢弃。
 */
function prepareInputs(
  input: ParsedPrepareDesignSchemeRunInput,
  authority: RunAuthority,
  deps: DesktopFixedRunPlanDeps,
): PlannedInput[] {
  const slotIds = new Set(authority.document.inputs.map((slot) => slot.id));
  if (Object.keys(input.inputValues).some((slotId) => !slotIds.has(slotId))) {
    fail('DESIGN_SCHEME_INPUT_MISMATCH', '输入值包含当前方案版本未声明的槽位');
  }
  const hasReferenceAsset: ResolveReferenceAsset =
    deps.hasReferenceAsset ??
    ((assetId) =>
      schemeAssetExists(deps.designSchemeDb, input.schemeId, input.revisionId, assetId));
  for (const assetId of input.executionSettings.referenceAssetIds) {
    if (!hasReferenceAsset(assetId)) {
      fail('DESIGN_SCHEME_REFERENCE_MISSING', '参考图已不可用，请重新添加后再运行');
    }
  }
  const imageSlotCount = authority.document.inputs.filter((slot) =>
    IMAGE_INPUT_KINDS.has(slot.kind),
  ).length;
  if (imageSlotCount === 0 && input.executionSettings.referenceAssetIds.length > 0) {
    fail('DESIGN_SCHEME_INPUT_MISMATCH', '该方案没有图片输入，请移除参考图后再运行');
  }

  const remaining = [...input.executionSettings.referenceAssetIds];
  const planned = authority.document.inputs.map((slot): PlannedInput => {
    if (IMAGE_INPUT_KINDS.has(slot.kind)) {
      const min = slot.required ? Math.max(1, slot.minItems ?? 1) : 0;
      const max = slot.kind === 'image' ? 1 : (slot.maxItems ?? Number.MAX_SAFE_INTEGER);
      const take = Math.min(max, remaining.length);
      if (take < min) {
        fail(
          'DESIGN_SCHEME_INPUT_REQUIRED',
          `请先添加参考图：${slot.label}${min > 1 ? `（至少 ${min} 张）` : ''}`,
        );
      }
      return { slotId: slot.id, kind: slot.kind, valueIds: remaining.splice(0, take), text: null };
    }
    if (!TEXT_INPUT_KINDS.has(slot.kind)) {
      fail('DESIGN_SCHEME_INPUT_UNSUPPORTED', `暂不支持的输入类型：${slot.label}`);
    }
    const text = input.inputValues[slot.id] ?? '';
    if (slot.required && !text.trim()) {
      fail('DESIGN_SCHEME_INPUT_REQUIRED', `请先填写必需输入：${slot.label}`);
    }
    return { slotId: slot.id, kind: slot.kind, valueIds: [], text };
  });
  if (remaining.length > 0) {
    fail(
      'DESIGN_SCHEME_INPUT_MISMATCH',
      `参考图比方案图片槽位能接受的多 ${remaining.length} 张，请移除后再运行`,
    );
  }
  return planned;
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
  const inputs = prepareInputs(input, authority, deps);
  const createId = deps.createId ?? (() => ulid());
  const now = (deps.now ?? Date.now)();
  const inspectId = `inspect_${createId()}`;
  const compileId = `compile_${createId()}`;
  const generateId = `generate_${createId()}`;
  const evaluateId = `evaluate_${createId()}`;
  // 文本槽位一一对应冻结文本值;图片槽位的值是 valueIds,不进 inputValues(校验器按此对账)。
  const inputValues = Object.fromEntries(
    inputs
      .filter((planned) => planned.text !== null)
      .map((planned) => [planned.slotId, planned.text ?? '']),
  );
  const result = designSchemeRunInputSchema.parse({
    ...input,
    inputValues,
    ...(deps.cloudBinding ? { executionBinding: deps.cloudBinding } : {}),
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
  if (
    (deps.cloudBinding &&
      (!input.executionBinding ||
        automationInputHash(input.executionBinding) !== automationInputHash(deps.cloudBinding))) ||
    (!deps.cloudBinding && input.executionBinding)
  )
    fail('DESIGN_SCHEME_PROVIDER_SNAPSHOT_MISMATCH', '运行账号身份已变化，请重新生成运行计划');
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
