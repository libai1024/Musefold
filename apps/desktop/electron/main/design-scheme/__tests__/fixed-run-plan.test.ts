import {
  designSchemeRunInputSchema,
  type ParsedDesignSchemeRunInput,
  type RunStep,
} from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import { DESIGN_SCHEME_PLAN_INCOMPATIBLE, validateDesktopFixedRunPlan } from '../fixed-run-plan';

const NOW = '2026-09-01T00:00:00.000Z';

function step(id: string, kind: RunStep['kind'], dependsOn: string[]): RunStep {
  return {
    id,
    kind,
    dependsOn,
    inputRefs: [],
    outputRefs: [],
    timeoutMs: 30_000,
    maxAttempts: 1,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function inputFixture(): ParsedDesignSchemeRunInput {
  return designSchemeRunInputSchema.parse({
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    priorityMode: 'scheme_first',
    brief: 'Create an editorial image.',
    inputValues: { topic: 'night market' },
    executionSettings: {
      providerId: 'provider_1',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
    plan: {
      id: 'plan_1',
      schemaVersion: 1,
      schemeRevisionId: 'rev_1',
      sourceSnapshotIds: ['snapshot_1'],
      inputs: [{ slotId: 'topic', kind: 'text', valueIds: [], text: 'night market' }],
      steps: [
        step('step_inspect', 'inspect-input', []),
        step('step_compile', 'compile-prompt', ['step_inspect']),
        step('step_generate', 'generate-image', ['step_compile']),
        step('step_evaluate', 'evaluate-image', ['step_generate']),
      ],
      provider: {
        providerId: 'provider_1',
        providerName: 'Image Provider',
        model: 'image-model',
        providerVersion: null,
        capabilities: {
          text: true,
          vision: true,
          image: true,
          multiImage: false,
          editing: false,
        },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'rev_1',
        policyVersion: 'desktop-fixed-v1',
        appliedAt: NOW,
      },
      budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
      evaluation: {
        ratio: '1:1',
        requiredChecks: ['output-count', 'file-valid', 'aspect-ratio'],
      },
    },
    repair: null,
  });
}

function requireStep(input: ParsedDesignSchemeRunInput, index: number): RunStep {
  const value = input.plan.steps[index];
  if (!value) throw new Error(`Missing fixture step at ${index}`);
  return value;
}

function requirePlannedInput(
  input: ParsedDesignSchemeRunInput,
  index: number,
): ParsedDesignSchemeRunInput['plan']['inputs'][number] {
  const value = input.plan.inputs[index];
  if (!value) throw new Error(`Missing fixture input at ${index}`);
  return value;
}

function requireBudget(
  input: ParsedDesignSchemeRunInput,
): NonNullable<ParsedDesignSchemeRunInput['plan']['budget']> {
  const value = input.plan.budget ?? input.plan.budgets;
  if (!value) throw new Error('Missing fixture budget');
  return value;
}

function expectIncompatible(input: ParsedDesignSchemeRunInput, path: string): void {
  expect(validateDesktopFixedRunPlan(input)).toMatchObject({
    ok: false,
    code: DESIGN_SCHEME_PLAN_INCOMPATIBLE,
    path,
  });
}

describe('desktop fixed design-scheme run plan compatibility', () => {
  it('accepts the exact inspect -> compile -> generate -> evaluate pipeline', () => {
    expect(validateDesktopFixedRunPlan(inputFixture())).toEqual({ ok: true });
  });

  it.each([
    {
      name: 'missing fixed step',
      path: 'plan.steps',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.plan.steps.pop();
      },
    },
    {
      name: 'unknown fixed policy version',
      path: 'plan.policy.policyVersion',
      mutate(input: ParsedDesignSchemeRunInput) {
        if (!input.plan.policy) throw new Error('Missing fixture policy');
        input.plan.policy.policyVersion = 'future-runtime-v2';
      },
    },
    {
      name: 'unsupported step kind',
      path: 'plan.steps.2.kind',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 2).kind = 'batch';
      },
    },
    {
      name: 'dangling or non-linear dependency',
      path: 'plan.steps.2.dependsOn',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 2).dependsOn = ['step_missing'];
      },
    },
    {
      name: 'cyclic dependency',
      path: 'plan.steps.0.dependsOn',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 0).dependsOn = ['step_evaluate'];
      },
    },
    {
      name: 'graph references the runtime cannot interpret',
      path: 'plan.steps.1',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 1).outputRefs = ['compiled_prompt'];
      },
    },
    {
      name: 'pre-completed step state',
      path: 'plan.steps.0.status',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 0).status = 'completed';
      },
    },
    {
      name: 'step retry policy',
      path: 'plan.steps.2.retry',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 2).maxAttempts = 2;
      },
    },
    {
      name: 'duplicate step id',
      path: 'plan.steps',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireStep(input, 3).id = requireStep(input, 2).id;
      },
    },
    {
      name: 'duplicate source snapshot',
      path: 'plan.sourceSnapshotIds',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.plan.sourceSnapshotIds.push('snapshot_1');
      },
    },
    {
      name: 'duplicate planned input',
      path: 'plan.inputs',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.plan.inputs.push({ ...requirePlannedInput(input, 0) });
      },
    },
    {
      name: 'text input snapshot mismatch',
      path: 'plan.inputs.0.text',
      mutate(input: ParsedDesignSchemeRunInput) {
        requirePlannedInput(input, 0).text = 'different value';
      },
    },
    {
      name: 'unplanned text input',
      path: 'inputValues',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.inputValues.extra = 'not planned';
      },
    },
    {
      name: 'insufficient step budget',
      path: 'plan.budget.maxSteps',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireBudget(input).maxSteps = 3;
      },
    },
    {
      name: 'non-exact output budget',
      path: 'plan.budget.maxOutputs',
      mutate(input: ParsedDesignSchemeRunInput) {
        requireBudget(input).maxOutputs = 2;
      },
    },
    {
      name: 'unsupported cost ceiling',
      path: 'plan.budget.maxCostUnits',
      mutate(input: ParsedDesignSchemeRunInput) {
        const budget = requireBudget(input);
        budget.maxCostUnits = 10;
        budget.currency = 'points';
      },
    },
    {
      name: 'provider without image generation',
      path: 'plan.provider.capabilities.image',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.plan.provider.capabilities.image = false;
      },
    },
    {
      name: 'unsupported evaluation check',
      path: 'plan.evaluation.requiredChecks',
      mutate(input: ParsedDesignSchemeRunInput) {
        input.plan.evaluation.requiredChecks = ['dimensions'];
      },
    },
  ])('rejects $name', ({ mutate, path }) => {
    const input = inputFixture();
    mutate(input);
    expectIncompatible(input, path);
  });

  it('requires editing capability for a reference image plan', () => {
    const input = inputFixture();
    input.plan.inputs.push({
      slotId: 'reference',
      kind: 'image',
      valueIds: ['asset_1'],
      text: null,
    });
    input.executionSettings.referenceAssetIds = ['asset_1'];

    expectIncompatible(input, 'plan.provider.capabilities.editing');
  });

  it('requires multi-image capability for ordered multiple references', () => {
    const input = inputFixture();
    input.plan.inputs.push({
      slotId: 'reference',
      kind: 'image-set',
      valueIds: ['asset_1', 'asset_2'],
      text: null,
    });
    input.executionSettings.referenceAssetIds = ['asset_1', 'asset_2'];
    input.plan.provider.capabilities.editing = true;

    expectIncompatible(input, 'plan.provider.capabilities.multiImage');
  });

  it('requires repair budget for a repair run', () => {
    const input = inputFixture();
    input.repair = {
      repairOfRunId: 'run_1',
      repairEvaluationId: 'evaluation_1',
      depth: 1,
      hint: 'Regenerate at the requested ratio.',
    };
    requireBudget(input).maxRepairRuns = 0;

    expectIncompatible(input, 'plan.budget.maxRepairRuns');
  });
});
