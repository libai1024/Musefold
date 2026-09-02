import type { ParsedDesignSchemeRunInput, RunStep } from '@musefold/contracts';

const FIXED_STEP_KINDS = [
  'inspect-input',
  'compile-prompt',
  'generate-image',
  'evaluate-image',
] as const;

const SUPPORTED_EVALUATION_CHECKS = ['output-count', 'file-valid', 'aspect-ratio'] as const;

export const DESKTOP_FIXED_RUN_PLAN_VERSION = 'desktop-fixed-v1' as const;
export const DESIGN_SCHEME_PLAN_INCOMPATIBLE = 'DESIGN_SCHEME_PLAN_INCOMPATIBLE' as const;

export type DesktopRunPlanCompatibilityResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DESIGN_SCHEME_PLAN_INCOMPATIBLE;
      path: string;
      message: string;
    };

function incompatible(path: string, message: string): DesktopRunPlanCompatibilityResult {
  return { ok: false, code: DESIGN_SCHEME_PLAN_INCOMPATIBLE, path, message };
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateStep(
  step: RunStep,
  index: number,
  previousStepId: string | null,
): DesktopRunPlanCompatibilityResult {
  const expectedKind = FIXED_STEP_KINDS[index];
  if (step.kind !== expectedKind) {
    return incompatible(
      `plan.steps.${index}.kind`,
      `桌面运行时只支持 ${FIXED_STEP_KINDS.join(' -> ')} 固定管线`,
    );
  }
  const expectedDependencies = previousStepId ? [previousStepId] : [];
  if (!sameItems(step.dependsOn, expectedDependencies)) {
    return incompatible(
      `plan.steps.${index}.dependsOn`,
      '桌面固定管线要求每个步骤仅依赖紧邻的前一步',
    );
  }
  if (step.inputRefs.length > 0 || step.outputRefs.length > 0) {
    return incompatible(
      `plan.steps.${index}`,
      '桌面固定管线尚不能解释步骤 inputRefs/outputRefs，拒绝忽略图语义',
    );
  }
  if (
    step.status !== 'pending' ||
    step.startedAt !== null ||
    step.completedAt !== null ||
    step.error !== null
  ) {
    return incompatible(`plan.steps.${index}.status`, '新运行计划的步骤必须处于未开始状态');
  }
  const maxAttempts = step.retry?.maxAttempts ?? step.maxAttempts;
  if (maxAttempts !== 1 || (step.retry?.backoffMs ?? 0) !== 0) {
    return incompatible(
      `plan.steps.${index}.retry`,
      '桌面固定管线不支持步骤级自动重试，maxAttempts 必须为 1',
    );
  }
  return { ok: true };
}

function validatePlannedInputs(
  input: ParsedDesignSchemeRunInput,
): DesktopRunPlanCompatibilityResult {
  const slotIds = input.plan.inputs.map((item) => item.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    return incompatible('plan.inputs', '运行计划中的输入槽位不能重复');
  }

  const textSlotIds: string[] = [];
  const imageValueIds: string[] = [];
  for (const [index, planned] of input.plan.inputs.entries()) {
    if (planned.kind === 'image' || planned.kind === 'image-set') {
      if (planned.text !== null) {
        return incompatible(`plan.inputs.${index}.text`, '图片输入不能携带文本值');
      }
      imageValueIds.push(...planned.valueIds);
      continue;
    }
    if (planned.valueIds.length > 0 || planned.text === null) {
      return incompatible(`plan.inputs.${index}`, '文本输入必须只携带冻结的文本值');
    }
    textSlotIds.push(planned.slotId);
    if (input.inputValues[planned.slotId] !== planned.text) {
      return incompatible(`plan.inputs.${index}.text`, '运行计划文本必须与本次输入值快照完全一致');
    }
  }

  const inputValueIds = Object.keys(input.inputValues).sort();
  if (!sameItems([...textSlotIds].sort(), inputValueIds)) {
    return incompatible('inputValues', '本次文本输入必须与运行计划槽位一一对应');
  }
  if (!sameItems(imageValueIds, input.executionSettings.referenceAssetIds)) {
    return incompatible(
      'executionSettings.referenceAssetIds',
      '参考资产顺序必须与运行计划图片输入快照一致',
    );
  }
  return { ok: true };
}

export function validateDesktopFixedRunPlan(
  input: ParsedDesignSchemeRunInput,
): DesktopRunPlanCompatibilityResult {
  const plan = input.plan;
  const planPolicy = plan.policy ?? plan.prioritySnapshot;
  if (planPolicy?.policyVersion !== DESKTOP_FIXED_RUN_PLAN_VERSION) {
    return incompatible(
      'plan.policy.policyVersion',
      `桌面固定管线只支持策略版本 ${DESKTOP_FIXED_RUN_PLAN_VERSION}`,
    );
  }
  if (new Set(plan.sourceSnapshotIds).size !== plan.sourceSnapshotIds.length) {
    return incompatible('plan.sourceSnapshotIds', '来源快照不能重复');
  }
  if (plan.steps.length !== FIXED_STEP_KINDS.length) {
    return incompatible('plan.steps', `桌面运行计划必须包含 ${FIXED_STEP_KINDS.length} 个固定步骤`);
  }
  const stepIds = plan.steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    return incompatible('plan.steps', '运行计划步骤 id 不能重复');
  }
  for (const [index, step] of plan.steps.entries()) {
    const result = validateStep(
      step,
      index,
      index > 0 ? (plan.steps[index - 1]?.id ?? null) : null,
    );
    if (!result.ok) return result;
  }

  const plannedInputs = validatePlannedInputs(input);
  if (!plannedInputs.ok) return plannedInputs;

  const budget = plan.budget ?? plan.budgets;
  if (!budget) return incompatible('plan.budget', '运行计划缺少预算快照');
  if (budget.maxSteps < FIXED_STEP_KINDS.length) {
    return incompatible('plan.budget.maxSteps', '步骤预算小于桌面固定管线所需步骤数');
  }
  if (budget.maxOutputs !== input.executionSettings.outputCount) {
    return incompatible('plan.budget.maxOutputs', '输出预算必须与本次实际输出数一致');
  }
  if (budget.maxCostUnits !== undefined || budget.currency !== undefined) {
    return incompatible('plan.budget.maxCostUnits', '桌面固定管线尚不能执行成本上限');
  }
  if (input.repair && budget.maxRepairRuns < 1) {
    return incompatible('plan.budget.maxRepairRuns', '修复运行需要至少一次修复预算');
  }

  if (!plan.provider.capabilities.image) {
    return incompatible('plan.provider.capabilities.image', '所选 Provider 不具备生图能力');
  }
  const referenceCount = input.executionSettings.referenceAssetIds.length;
  if (referenceCount > 0 && !plan.provider.capabilities.editing) {
    return incompatible('plan.provider.capabilities.editing', '参考图运行需要图片编辑能力');
  }
  if (referenceCount > 1 && !plan.provider.capabilities.multiImage) {
    return incompatible('plan.provider.capabilities.multiImage', '多参考图运行需要多图能力');
  }

  if (!sameItems(plan.evaluation.requiredChecks, SUPPORTED_EVALUATION_CHECKS)) {
    return incompatible(
      'plan.evaluation.requiredChecks',
      `桌面质量门只支持 ${SUPPORTED_EVALUATION_CHECKS.join(', ')}`,
    );
  }
  if ((plan.evaluation.ratio ?? null) !== (input.executionSettings.aspectRatio ?? null)) {
    return incompatible(
      'plan.evaluation.ratio',
      '质量门比例必须与本次执行比例完全一致（自动比例均为 null）',
    );
  }

  return { ok: true };
}
