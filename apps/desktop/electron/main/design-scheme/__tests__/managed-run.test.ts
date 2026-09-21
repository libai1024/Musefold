import { beforeEach, expect, it, vi } from 'vitest';
import { designSchemeRunInputSchema } from '@musefold/contracts';
import { managedCommand } from '@musefold/core/services/__tests__/fixtures/managed-generation';
import type { ManagedDurableRunSpec } from '../../../system/managed-run-runtime';
import type { RunSessionDeps } from '../run-session';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  reconcile: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../../../system/managed-run-runtime', () => ({
  startManagedDurableRun: mocks.start,
  cancelManagedDurableRun: mocks.cancel,
  scheduleManagedRunReconciliation: mocks.reconcile,
}));
vi.mock('../run-session', () => ({ runDesignScheme: mocks.run }));
import { runManagedDesignScheme } from '../managed-run';
import Database from 'better-sqlite3';

function fixture() {
  const binding = { ...managedCommand().binding, model: 'gpt-image-2' };
  const input = designSchemeRunInputSchema.parse({
    executionId: 'managed-execution',
    schemeId: 'scheme',
    revisionId: 'revision',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    brief: 'A poster',
    inputValues: {},
    executionSettings: {
      providerId: 'local-cloud',
      model: binding.model,
      expectedBinding: binding,
      size: 'auto',
      quality: 'auto',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
    executionBinding: binding,
    plan: {
      id: 'plan',
      schemaVersion: 1,
      schemeRevisionId: 'revision',
      sourceSnapshotIds: [],
      inputs: [],
      steps: [
        {
          id: 'generate',
          kind: 'generate-image',
          dependsOn: [],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 30000,
          maxAttempts: 1,
        },
      ],
      provider: {
        providerId: 'local-cloud',
        providerName: 'Cloud',
        model: binding.model,
        providerVersion: null,
        capabilities: { text: false, vision: true, image: true, multiImage: true, editing: true },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'revision',
        policyVersion: 'desktop-fixed-v1',
        appliedAt: 1,
      },
      budget: { maxSteps: 1, maxOutputs: 1, maxRepairRuns: 1 },
      evaluation: { ratio: null, requiredChecks: [] },
    },
  });
  const request: Parameters<typeof runManagedDesignScheme>[2] = {
    executionId: input.executionId,
    schemeId: input.schemeId,
    revisionId: input.revisionId,
    mode: input.mode,
    brief: input.brief,
    inputValues: {},
    generation: {
      jobIds: ['job-1'],
      providerName: 'Cloud',
      ratioId: 'auto',
      requestTemplate: {
        providerId: 'local-cloud',
        model: binding.model,
        prompt: '',
        size: 'auto',
        quality: 'auto',
        n: 1,
      },
    },
  };
  const db = new Database(':memory:');
  const controller = new AbortController();
  const deps: RunSessionDeps = {
    db,
    signal: controller.signal,
    emit: vi.fn(),
    sendProgress: vi.fn(),
  };
  return { binding, input, request, deps, controller, close: () => db.close() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cancel.mockResolvedValue(undefined);
});

it('does not register an already-cancelled scheme and detaches failed registration listeners', async () => {
  const f = fixture();
  try {
    f.controller.abort();
    await expect(
      runManagedDesignScheme(f.input, f.binding, f.request, f.deps),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(mocks.start).not.toHaveBeenCalled();
    const controller = new AbortController();
    mocks.start.mockRejectedValueOnce(new Error('registration refused'));
    await expect(
      runManagedDesignScheme(f.input, f.binding, f.request, {
        ...f.deps,
        signal: controller.signal,
      }),
    ).rejects.toThrow('registration refused');
    controller.abort();
    expect(mocks.cancel).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it('routes replay to receipt-only recovery and never calls the retained driver', async () => {
  const f = fixture();
  try {
    mocks.start.mockResolvedValueOnce({ replayed: true });
    await expect(
      runManagedDesignScheme(f.input, f.binding, f.request, f.deps),
    ).rejects.toMatchObject({ code: 'DESIGN_SCHEME_EXECUTION_TERMINAL' });
    expect(mocks.reconcile).toHaveBeenCalledWith(f.input.executionId);
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it('freezes the full host plan, injects the managed executor, and propagates driver failures', async () => {
  const f = fixture();
  const generate = vi.fn();
  const onReferences = vi.fn();
  let captured: ManagedDurableRunSpec | undefined;
  mocks.start.mockImplementation(async (spec: ManagedDurableRunSpec) => {
    captured = spec;
    void spec.drive({ images: { generate, onReferences }, text: null });
    return { replayed: false };
  });
  mocks.run.mockRejectedValueOnce(new Error('controlled driver failure'));
  try {
    await expect(runManagedDesignScheme(f.input, f.binding, f.request, f.deps)).rejects.toThrow(
      'controlled driver failure',
    );
    expect(captured).toMatchObject({
      model: 'gpt-image-2',
      expectedBinding: f.binding,
      callerKey: 'desktop-scheme:managed-execution',
      consent: 'interactive',
      textBinding: null,
      input: f.input,
      frozenRun: f.request,
    });
    expect(onReferences).toHaveBeenCalledWith([]);
    expect(mocks.run).toHaveBeenCalledWith(f.request, expect.objectContaining({ generate }));
    f.controller.abort();
    expect(mocks.cancel).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
