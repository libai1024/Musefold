import {
  designSchemeRevisionDocumentSchema,
  prepareDesignSchemeRunInputSchema,
  type ParsedDesignSchemeRunInput,
} from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import {
  CLOUD_GENERATION_MODEL,
  CLOUD_GENERATION_PROVIDER_ID,
  cloudGenerationProviderSnapshot,
} from '../../cloud-generation-policy';
import {
  assertCloudFixedRunPlan,
  CLOUD_FIXED_RUN_PLAN_VERSION,
  prepareCloudFixedRunPlan,
} from '../fixed-run-plan';

function fixture() {
  const input = prepareDesignSchemeRunInputSchema.parse({
    executionId: 'execution_1',
    schemeId: 'scheme_1',
    revisionId: 'revision_1',
    mode: 'trial',
    brief: 'Quiet city poster',
    inputValues: { topic: 'Night market' },
    executionSettings: {
      providerId: CLOUD_GENERATION_PROVIDER_ID,
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
  });
  const authority: Parameters<typeof prepareCloudFixedRunPlan>[1] = {
    summary: {
      id: 'scheme_1',
      status: 'draft',
      currentRevisionId: 'revision_1',
      workingDraftRevisionId: null,
    },
    document: designSchemeRevisionDocumentSchema.parse({
      schemaVersion: 1,
      revisionId: 'revision_1',
      schemeId: 'scheme_1',
      name: 'City poster',
      summary: 'A quiet layout',
      fidelity: 'faithful',
      sources: [
        { id: 'source_1', kind: 'github-skill', role: 'normative', snapshotId: 'snapshot_1' },
      ],
      sourceSnapshotIds: ['snapshot_1', 'snapshot_2'],
      inputs: [
        { id: 'topic', label: 'Topic', kind: 'text', required: true },
        { id: 'mood', label: 'Mood', kind: 'choice', required: false },
      ],
      parameters: [],
      constraints: [],
      promptProgram: [
        {
          id: 'module_1',
          order: 0,
          kind: 'input-template',
          template: '{{topic}}',
          variables: ['topic'],
          sourceIds: ['source_1'],
        },
      ],
      compilation: {
        compiledAt: '2026-09-07T00:00:00.000Z',
        model: { model: 'fixture-compiler' },
        adopted: [],
        omitted: [],
        warnings: [],
        trace: [],
      },
    }),
    sourceSnapshotIds: ['snapshot_2', 'snapshot_1'],
    provider: structuredClone(cloudGenerationProviderSnapshot),
    referenceAssetIds: [],
  };
  const identity: Parameters<typeof prepareCloudFixedRunPlan>[2] = {
    planId: 'plan_1',
    stepIds: ['inspect_1', 'compile_1', 'generate_1', 'evaluate_1'],
    now: '2026-09-07T01:00:00.000Z',
  };
  return { input, authority, identity };
}

type Fixture = ReturnType<typeof fixture>;

function build(data = fixture()) {
  return prepareCloudFixedRunPlan(data.input, data.authority, data.identity);
}

function withImages(data: Fixture, references = ['asset_b', 'asset_a', 'asset_c']) {
  data.authority.document.inputs.push(
    { id: 'subject', label: 'Subject', kind: 'image', required: true },
    { id: 'references', label: 'References', kind: 'image-set', required: false, maxItems: 2 },
  );
  data.input.executionSettings.referenceAssetIds = references;
  data.authority.referenceAssetIds = ['asset_a', 'asset_b', 'asset_c', 'asset_d'];
  return data;
}

function expectIncompatible(action: () => unknown) {
  expect(action).toThrow(expect.objectContaining({ code: 'DESIGN_SCHEME_PLAN_INCOMPATIBLE' }));
}

describe('prepareCloudFixedRunPlan', () => {
  it.each(['gpt-image-2', 'musefold-image'])(
    'freezes the host-verified selected model %s and rejects a plan-only model override',
    (model) => {
      const data = fixture();
      data.input.executionSettings.model = model;
      expectIncompatible(() => build(data));
      data.authority.provider.model = model;
      const prepared = build(data);
      expect(prepared.plan.provider.model).toBe(model);
      expect(prepared.executionSettings.model).toBe(model);
      expect(() => assertCloudFixedRunPlan(prepared)).not.toThrow();
      const legacyOverride = structuredClone(prepared);
      delete legacyOverride.executionSettings.model;
      expectIncompatible(() => assertCloudFixedRunPlan(legacyOverride));
      prepared.plan.provider.model = CLOUD_GENERATION_MODEL;
      expectIncompatible(() => assertCloudFixedRunPlan(prepared));
    },
  );
  it('freezes canonical revision/source/provider/input snapshots without mutating its authority', () => {
    const data = fixture();
    const before = structuredClone(data);
    const result = build(data);
    expect(data).toEqual(before);
    expect(result).toMatchObject({
      executionId: 'execution_1',
      schemeId: 'scheme_1',
      revisionId: 'revision_1',
      schemeStatus: 'draft',
      schemeFidelity: 'faithful',
      mode: 'trial',
      repair: null,
      inputValues: { topic: 'Night market', mood: '' },
      plan: {
        id: 'plan_1',
        sourceSnapshotIds: ['snapshot_1', 'snapshot_2'],
        provider: { providerId: CLOUD_GENERATION_PROVIDER_ID, model: CLOUD_GENERATION_MODEL },
        policy: { policyVersion: CLOUD_FIXED_RUN_PLAN_VERSION, appliedAt: data.identity.now },
        budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 0 },
      },
    });
    expect(() => assertCloudFixedRunPlan(result)).not.toThrow();
    result.plan.provider.model = 'changed';
    result.plan.sourceSnapshotIds.reverse();
    expect(data).toEqual(before);
  });

  it.each([1, 4, 32])(
    'supports the contract output count %i without a desktop-only cap',
    (count) => {
      const data = fixture();
      data.input.executionSettings.outputCount = count;
      expect(build(data).plan.budget?.maxOutputs).toBe(count);
    },
  );

  it('allows formal current revision and trial working draft, but never formal working draft', () => {
    const data = fixture();
    data.authority.summary.status = 'formal';
    data.input.mode = 'formal';
    expect(build(data).mode).toBe('formal');
    data.authority.summary.currentRevisionId = 'revision_old';
    data.authority.summary.workingDraftRevisionId = data.input.revisionId;
    expectIncompatible(() => build(data));
    data.input.mode = 'trial';
    expect(build(data).revisionId).toBe(data.authority.summary.workingDraftRevisionId);
  });

  it.each<[string, (data: Fixture) => void]>([
    [
      'formal draft',
      (data) => {
        data.input.mode = 'formal';
      },
    ],
    [
      'stale trial',
      (data) => {
        data.authority.summary.currentRevisionId = 'revision_new';
      },
    ],
    [
      'stale formal',
      (data) => {
        data.input.mode = 'formal';
        data.authority.summary.status = 'formal';
        data.authority.summary.currentRevisionId = 'revision_new';
      },
    ],
    [
      'cross-scheme summary',
      (data) => {
        data.authority.summary.id = 'scheme_other';
      },
    ],
    [
      'cross-scheme revision',
      (data) => {
        data.authority.document.schemeId = 'scheme_other';
      },
    ],
    [
      'wrong revision',
      (data) => {
        data.authority.document.revisionId = 'revision_other';
      },
    ],
    [
      'unsupported fidelity',
      (data) => {
        data.authority.document.fidelity = 'unsupported';
      },
    ],
    [
      'missing bound source',
      (data) => {
        data.authority.sourceSnapshotIds.pop();
      },
    ],
    [
      'duplicate bound source',
      (data) => {
        data.authority.sourceSnapshotIds.push('snapshot_1');
      },
    ],
    [
      'duplicate declared source',
      (data) => {
        data.authority.document.sourceSnapshotIds.push('snapshot_1');
      },
    ],
    [
      'undeclared source binding',
      (data) => {
        data.authority.document.sources[0].snapshotId = 'snapshot_missing';
      },
    ],
    [
      'duplicate input slot',
      (data) => {
        data.authority.document.inputs.push(data.authority.document.inputs[0]);
      },
    ],
    [
      'missing required text',
      (data) => {
        data.input.inputValues.topic = '   ';
      },
    ],
    [
      'unknown text slot',
      (data) => {
        data.input.inputValues.unknown = 'ignored?';
      },
    ],
    [
      'duplicate step identity',
      (data) => {
        data.identity.stepIds[1] = data.identity.stepIds[0];
      },
    ],
  ])('rejects %s before freezing a plan', (_name, mutate) => {
    const data = fixture();
    mutate(data);
    expectIncompatible(() => build(data));
  });

  it('allocates image slots in declaration order and preserves the user reference order', () => {
    const result = build(withImages(fixture()));
    expect(result.plan.inputs.slice(2)).toEqual([
      { slotId: 'subject', kind: 'image', valueIds: ['asset_b'], text: null },
      { slotId: 'references', kind: 'image-set', valueIds: ['asset_a', 'asset_c'], text: null },
    ]);
    expect(result.inputValues).toEqual({ topic: 'Night market', mood: '' });
  });

  it.each(['image', 'image-set'] as const)(
    'reserves required %s inputs after an optional unbounded image-set',
    (kind) => {
      const data = fixture();
      data.input.executionSettings.referenceAssetIds = ['asset_b', 'asset_a', 'asset_c'];
      data.authority.referenceAssetIds = ['asset_a', 'asset_b', 'asset_c'];
      data.authority.document.inputs.push(
        { id: 'optional_images', label: 'Optional', kind: 'image-set', required: false },
        {
          id: 'required_images',
          label: 'Required',
          kind,
          required: true,
          minItems: kind === 'image' ? 1 : 2,
        },
      );
      const result = build(data);
      const reserved = kind === 'image' ? 1 : 2;
      expect(result.plan.inputs[2].valueIds).toEqual(
        data.input.executionSettings.referenceAssetIds.slice(0, -reserved),
      );
      expect(result.plan.inputs[3].valueIds).toEqual(
        data.input.executionSettings.referenceAssetIds.slice(-reserved),
      );
      expect(result.plan.inputs.flatMap((slot) => slot.valueIds)).toEqual(
        data.input.executionSettings.referenceAssetIds,
      );
    },
  );

  it('permits an empty optional image-set even with minItems while enforcing required minItems', () => {
    const data = withImages(fixture(), ['asset_b']);
    data.authority.document.inputs[3].minItems = 2;
    expect(build(data).plan.inputs[3].valueIds).toEqual([]);
    data.authority.document.inputs[3].required = true;
    expectIncompatible(() => build(data));
  });

  it.each<[string, (data: Fixture) => void]>([
    [
      'missing required image',
      (data) => {
        data.input.executionSettings.referenceAssetIds = [];
      },
    ],
    [
      'unknown reference',
      (data) => {
        data.input.executionSettings.referenceAssetIds = ['asset_missing'];
      },
    ],
    [
      'duplicate reference',
      (data) => {
        data.input.executionSettings.referenceAssetIds = ['asset_a', 'asset_a'];
      },
    ],
    [
      'excess references',
      (data) => {
        data.input.executionSettings.referenceAssetIds.push('asset_d');
      },
    ],
    [
      'image slot text',
      (data) => {
        data.input.inputValues.subject = 'must not be ignored';
      },
    ],
    [
      'no image slots',
      (data) => {
        data.authority.document.inputs.splice(2);
      },
    ],
    [
      'wrong provider',
      (data) => {
        data.authority.provider.providerId = 'desktop-provider';
        data.input.executionSettings.providerId = 'desktop-provider';
      },
    ],
    [
      'wrong model',
      (data) => {
        data.authority.provider.model = 'unapproved-model';
      },
    ],
    [
      'no image capability',
      (data) => {
        data.authority.provider.capabilities.image = false;
      },
    ],
    [
      'no editing capability',
      (data) => {
        data.authority.provider.capabilities.editing = false;
      },
    ],
    [
      'no multi-image capability',
      (data) => {
        data.authority.provider.capabilities.multiImage = false;
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const data = withImages(fixture());
    mutate(data);
    expectIncompatible(() => build(data));
  });

  it('does not require editing or multi-image capability for a text-only run', () => {
    const data = fixture();
    data.authority.provider.capabilities.editing = false;
    data.authority.provider.capabilities.multiImage = false;
    expect(() => build(data)).not.toThrow();
  });
});

describe('assertCloudFixedRunPlan', () => {
  it.each<[string, (input: ParsedDesignSchemeRunInput) => void]>([
    [
      'custom workflow',
      (input) => {
        input.plan.steps[0].kind = 'batch';
      },
    ],
    [
      'missing step',
      (input) => {
        input.plan.steps.pop();
      },
    ],
    [
      'duplicate step',
      (input) => {
        input.plan.steps[1].id = input.plan.steps[0].id;
      },
    ],
    [
      'custom dependency',
      (input) => {
        input.plan.steps[2].dependsOn = [input.plan.steps[0].id];
      },
    ],
    [
      'custom input refs',
      (input) => {
        input.plan.steps[0].inputRefs = ['asset_b'];
      },
    ],
    [
      'custom output refs',
      (input) => {
        input.plan.steps[0].outputRefs = ['output_1'];
      },
    ],
    [
      'custom timeout',
      (input) => {
        input.plan.steps[2].timeoutMs = 1;
      },
    ],
    [
      'started status',
      (input) => {
        input.plan.steps[0].status = 'running';
      },
    ],
    [
      'started timestamp',
      (input) => {
        input.plan.steps[0].startedAt = 1;
      },
    ],
    [
      'completed timestamp',
      (input) => {
        input.plan.steps[0].completedAt = 1;
      },
    ],
    [
      'existing error',
      (input) => {
        input.plan.steps[0].error = {
          code: 'TEST_ERROR',
          message: 'error',
          retryable: false,
          recoveryAction: 'none',
        };
      },
    ],
    [
      'automatic retries',
      (input) => {
        input.plan.steps[2].maxAttempts = 2;
      },
    ],
    [
      'retry alias mismatch',
      (input) => {
        input.plan.steps[2].retry = { maxAttempts: 2, backoffMs: 0 };
      },
    ],
    [
      'retry delay',
      (input) => {
        input.plan.steps[2].retry = { maxAttempts: 1, backoffMs: 100 };
      },
    ],
    [
      'step budget inflation',
      (input) => {
        if (input.plan.budget) input.plan.budget.maxSteps = 5;
      },
    ],
    [
      'step budget reduction',
      (input) => {
        if (input.plan.budget) input.plan.budget.maxSteps = 3;
      },
    ],
    [
      'output budget change',
      (input) => {
        if (input.plan.budget) input.plan.budget.maxOutputs = 2;
      },
    ],
    [
      'repair budget',
      (input) => {
        if (input.plan.budget) input.plan.budget.maxRepairRuns = 1;
      },
    ],
    [
      'cost ceiling',
      (input) => {
        if (input.plan.budget)
          Object.assign(input.plan.budget, { maxCostUnits: 0, currency: 'points' });
      },
    ],
    [
      'repair lineage',
      (input) => {
        input.repair = {
          repairOfRunId: 'run_old',
          repairEvaluationId: 'evaluation_old',
          depth: 1,
          hint: 'try again',
        };
      },
    ],
    [
      'policy version',
      (input) => {
        if (input.plan.policy) input.plan.policy.policyVersion = 'desktop-fixed-v1';
      },
    ],
    [
      'priority mismatch',
      (input) => {
        input.priorityMode = 'user_first';
      },
    ],
    [
      'revision mismatch',
      (input) => {
        input.plan.schemeRevisionId = 'revision_other';
      },
    ],
    [
      'provider mismatch',
      (input) => {
        input.executionSettings.providerId = 'other';
      },
    ],
    [
      'model substitution',
      (input) => {
        input.plan.provider.model = 'other';
      },
    ],
    [
      'source duplicates',
      (input) => {
        input.plan.sourceSnapshotIds.push('snapshot_1');
      },
    ],
    [
      'changed text',
      (input) => {
        input.plan.inputs[0].text = 'changed';
      },
    ],
    [
      'extra input',
      (input) => {
        input.inputValues.unknown = 'extra';
      },
    ],
    [
      'duplicate slot',
      (input) => {
        input.plan.inputs.push(input.plan.inputs[0]);
      },
    ],
    [
      'reference reordering',
      (input) => {
        input.executionSettings.referenceAssetIds.reverse();
      },
    ],
    [
      'image text',
      (input) => {
        input.plan.inputs[2].text = 'not image data';
      },
    ],
    [
      'too many single images',
      (input) => {
        input.plan.inputs[2].valueIds.push(input.plan.inputs[3].valueIds.shift() ?? 'asset_a');
      },
    ],
    [
      'custom checks',
      (input) => {
        input.plan.evaluation.requiredChecks.pop();
      },
    ],
    [
      'ratio mismatch',
      (input) => {
        input.plan.evaluation.ratio = '2:3';
      },
    ],
    [
      'contradictory budget aliases',
      (input) => {
        input.plan.budgets = { maxSteps: 4, maxOutputs: 2, maxRepairRuns: 0 };
      },
    ],
  ])('rejects %s tampering', (_name, mutate) => {
    const input = build(withImages(fixture()));
    mutate(input);
    expectIncompatible(() => assertCloudFixedRunPlan(input));
  });
});
