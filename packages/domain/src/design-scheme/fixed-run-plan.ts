import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  designSchemeRevisionDocumentSchema,
  designSchemeRunInputSchema,
  prepareDesignSchemeRunInputSchema,
  providerSnapshotSchema,
  type DesignSchemeRevisionDocument,
  type DesignSchemeSummary,
  type ParsedDesignSchemeRunInput,
  type ParsedPrepareDesignSchemeRunInput,
  type PlannedInput,
  type ProviderSnapshot,
  type RunStep,
} from '@musefold/contracts';
import { CLOUD_GENERATION_MODEL, CLOUD_GENERATION_PROVIDER_ID } from '../cloud-generation-policy';

export const CLOUD_FIXED_RUN_PLAN_VERSION = 'cloud-fixed-v1' as const;

const STEP_KINDS = ['inspect-input', 'compile-prompt', 'generate-image', 'evaluate-image'] as const;
const REQUIRED_CHECKS = ['output-count', 'file-valid', 'aspect-ratio'] as const;
const TEXT_KINDS = new Set(['text', 'article', 'choice']);

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: 'DESIGN_SCHEME_PLAN_INCOMPATIBLE' as const });
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(items: readonly string[]): boolean {
  return new Set(items).size === items.length;
}

function stepTimeout(kind: RunStep['kind']): number {
  return kind === 'generate-image' ? 600_000 : 30_000;
}

function prepareInputs(
  input: ParsedPrepareDesignSchemeRunInput,
  document: DesignSchemeRevisionDocument,
  referenceAssetIds: string[],
): PlannedInput[] {
  if (!unique(document.inputs.map((slot) => slot.id))) fail('方案输入槽位不能重复');
  const textSlots = new Set(
    document.inputs.filter((slot) => TEXT_KINDS.has(slot.kind)).map((slot) => slot.id),
  );
  if (Object.keys(input.inputValues).some((id) => !textSlots.has(id))) {
    fail('文本输入包含未声明的文本槽位');
  }
  const available = new Set(referenceAssetIds);
  if (input.executionSettings.referenceAssetIds.some((id) => !available.has(id))) {
    fail('参考图已不可用，请重新添加');
  }
  const remaining = [...input.executionSettings.referenceAssetIds];
  const inputs = document.inputs.map((slot, index): PlannedInput => {
    if (slot.kind === 'image' || slot.kind === 'image-set') {
      const min = slot.required ? Math.max(1, slot.minItems ?? 1) : 0;
      const max = slot.kind === 'image' ? 1 : (slot.maxItems ?? remaining.length);
      const reserved = document.inputs.slice(index + 1).reduce((total, next) => {
        if (!next.required || (next.kind !== 'image' && next.kind !== 'image-set')) return total;
        return total + Math.max(1, next.minItems ?? 1);
      }, 0);
      const count = Math.min(max, Math.max(0, remaining.length - reserved));
      if (count < min) fail('必需图片槽位的参考图数量不足');
      return { slotId: slot.id, kind: slot.kind, valueIds: remaining.splice(0, count), text: null };
    }
    if (!TEXT_KINDS.has(slot.kind)) fail('方案包含暂不支持的输入类型');
    const text = input.inputValues[slot.id] ?? '';
    if (slot.required && !text.trim()) fail('请填写所有必需的文本输入');
    return { slotId: slot.id, kind: slot.kind, valueIds: [], text };
  });
  if (remaining.length > 0) fail('参考图数量超过方案图片槽位容量');
  return inputs;
}

/** Freeze a host-verified revision, source bindings and reference availability without IO. */
export function prepareCloudFixedRunPlan(
  input: ParsedPrepareDesignSchemeRunInput,
  authority: {
    summary: Pick<
      DesignSchemeSummary,
      'id' | 'status' | 'currentRevisionId' | 'workingDraftRevisionId'
    >;
    document: DesignSchemeRevisionDocument;
    sourceSnapshotIds: string[];
    provider: ProviderSnapshot;
    referenceAssetIds: string[];
  },
  identity: { planId: string; stepIds: [string, string, string, string]; now: string },
): ParsedDesignSchemeRunInput {
  const request = prepareDesignSchemeRunInputSchema.safeParse(input);
  const revision = designSchemeRevisionDocumentSchema.safeParse(authority.document);
  const provider = providerSnapshotSchema.safeParse(authority.provider);
  if (!request.success || !revision.success || !provider.success) fail('运行输入或权威快照无效');
  const parsed = request.data;
  const document = revision.data;
  const summary = authority.summary;
  if (
    summary.id !== parsed.schemeId ||
    document.schemeId !== parsed.schemeId ||
    document.revisionId !== parsed.revisionId
  ) {
    fail('方案或版本与权威快照不一致');
  }
  if (document.fidelity === 'unsupported') fail('该方案暂不支持执行');
  if (parsed.mode === 'formal') {
    if (summary.status !== 'formal' || parsed.revisionId !== summary.currentRevisionId) {
      fail('正式运行必须使用当前正式版本');
    }
  } else if (
    parsed.revisionId !== summary.currentRevisionId &&
    parsed.revisionId !== summary.workingDraftRevisionId
  ) {
    fail('试运行必须使用当前版本或当前工作草稿');
  }
  const declaredSources = document.sourceSnapshotIds;
  if (
    !unique(authority.sourceSnapshotIds) ||
    !unique(declaredSources) ||
    !sameItems([...declaredSources].sort(), [...authority.sourceSnapshotIds].sort()) ||
    document.sources.some(
      (source) => source.snapshotId && !declaredSources.includes(source.snapshotId),
    )
  ) {
    fail('版本声明的来源快照与权威绑定不一致');
  }
  const inputs = prepareInputs(parsed, document, authority.referenceAssetIds);
  const result = designSchemeRunInputSchema.safeParse({
    ...parsed,
    inputValues: Object.fromEntries(
      inputs.filter((item) => item.text !== null).map((item) => [item.slotId, item.text]),
    ),
    schemeStatus: summary.status,
    schemeFidelity: document.fidelity,
    repair: null,
    plan: {
      id: identity.planId,
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeRevisionId: document.revisionId,
      sourceSnapshotIds: declaredSources,
      inputs,
      steps: STEP_KINDS.map(
        (kind, index): RunStep => ({
          id: identity.stepIds[index],
          kind,
          dependsOn: index === 0 ? [] : [identity.stepIds[index - 1]],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: stepTimeout(kind),
          maxAttempts: 1,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          error: null,
        }),
      ),
      provider: provider.data,
      policy: {
        priorityMode: parsed.priorityMode,
        schemeRevisionId: document.revisionId,
        policyVersion: CLOUD_FIXED_RUN_PLAN_VERSION,
        appliedAt: identity.now,
      },
      budget: { maxSteps: 4, maxOutputs: parsed.executionSettings.outputCount, maxRepairRuns: 0 },
      evaluation: {
        ratio: parsed.executionSettings.aspectRatio ?? null,
        requiredChecks: [...REQUIRED_CHECKS],
      },
    },
  });
  if (!result.success) fail('无法构建符合契约的固定运行计划');
  assertCloudFixedRunPlan(result.data);
  return result.data;
}

function assertInputs(input: ParsedDesignSchemeRunInput): void {
  const planned = input.plan.inputs;
  if (!unique(planned.map((item) => item.slotId))) fail('计划输入槽位不能重复');
  const textSlotIds: string[] = [];
  const referenceIds: string[] = [];
  for (const item of planned) {
    if (item.kind === 'image' || item.kind === 'image-set') {
      if (item.text !== null || (item.kind === 'image' && item.valueIds.length > 1)) {
        fail('图片槽位的值或数量无效');
      }
      referenceIds.push(...item.valueIds);
    } else {
      if (
        !TEXT_KINDS.has(item.kind) ||
        item.valueIds.length > 0 ||
        item.text === null ||
        item.text !== input.inputValues[item.slotId]
      ) {
        fail('计划文本与本次输入值快照不一致');
      }
      textSlotIds.push(item.slotId);
    }
  }
  if (!sameItems(textSlotIds.sort(), Object.keys(input.inputValues).sort())) {
    fail('文本输入必须与计划槽位一一对应');
  }
  if (!sameItems(referenceIds, input.executionSettings.referenceAssetIds)) {
    fail('参考图顺序与计划图片输入不一致');
  }
}

/** Structural compatibility only; the host must also compare the persisted prepared snapshot. */
export function assertCloudFixedRunPlan(input: ParsedDesignSchemeRunInput): void {
  const result = designSchemeRunInputSchema.safeParse(input);
  if (!result.success) fail('运行计划或执行输入不符合契约');
  const parsed = result.data;
  const plan = parsed.plan;
  const policy = plan.policy ?? plan.prioritySnapshot;
  if (policy?.policyVersion !== CLOUD_FIXED_RUN_PLAN_VERSION) fail('不支持的云端运行策略版本');
  if (!unique(plan.sourceSnapshotIds)) fail('计划来源快照不能重复');
  if (parsed.repair !== null) fail('云端固定管线暂不支持修复运行');
  if (plan.steps.length !== 4 || !unique(plan.steps.map((step) => step.id))) {
    fail('云端运行计划必须包含四个独立步骤');
  }
  for (const [index, step] of plan.steps.entries()) {
    if (
      step.kind !== STEP_KINDS[index] ||
      !sameItems(step.dependsOn, index === 0 ? [] : [plan.steps[index - 1].id]) ||
      step.inputRefs.length !== 0 ||
      step.outputRefs.length !== 0 ||
      step.timeoutMs !== stepTimeout(step.kind)
    ) {
      fail('云端运行计划必须使用固定四步管线及超时设置');
    }
    if (
      step.status !== 'pending' ||
      step.startedAt !== null ||
      step.completedAt !== null ||
      step.error !== null
    ) {
      fail('新运行计划的步骤必须处于未开始状态');
    }
    if ((step.retry?.maxAttempts ?? step.maxAttempts) !== 1 || (step.retry?.backoffMs ?? 0) !== 0) {
      fail('云端固定管线不支持步骤自动重试');
    }
  }
  assertInputs(parsed);
  const budget = plan.budget ?? plan.budgets;
  if (
    budget?.maxSteps !== 4 ||
    budget.maxOutputs !== parsed.executionSettings.outputCount ||
    budget.maxRepairRuns !== 0 ||
    budget.maxCostUnits !== undefined ||
    budget.currency !== undefined
  ) {
    fail('云端固定预算必须为四步、实际输出数、零修复，且不设置成本上限');
  }
  if (
    parsed.executionSettings.providerId !== CLOUD_GENERATION_PROVIDER_ID ||
    plan.provider.providerId !== CLOUD_GENERATION_PROVIDER_ID ||
    plan.provider.model !== (parsed.executionSettings.model ?? CLOUD_GENERATION_MODEL)
  ) {
    fail('云端固定管线只支持当前云端生图 Provider 与模型');
  }
  const capabilities = plan.provider.capabilities;
  const references = parsed.executionSettings.referenceAssetIds.length;
  if (!capabilities.image || (references > 0 && !capabilities.editing)) {
    fail('当前 Provider 不支持本次图片生成或编辑');
  }
  if (references > 1 && !capabilities.multiImage) fail('当前 Provider 不支持多参考图');
  if (
    !sameItems(plan.evaluation.requiredChecks, REQUIRED_CHECKS) ||
    plan.evaluation.ratio !== (parsed.executionSettings.aspectRatio ?? null)
  ) {
    fail('评估规则必须使用固定检查项与本次执行比例');
  }
}
