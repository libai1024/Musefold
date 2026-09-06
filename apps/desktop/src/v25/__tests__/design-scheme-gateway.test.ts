import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  DESIGN_SCHEME_METHOD_NAMES,
  DESIGN_SCHEME_WIRE_METHODS,
  cancelDesignSchemeResultSchema,
  checkDesignSchemeUpdateResultSchema,
  confirmDesignSchemeInstallResultSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  designSchemePageSchema,
  designSchemeRunResultSchema,
  exportDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
  prepareDesignSchemeRunResultSchema,
  promoteWorkingDraftResultSchema,
  importDesignSchemeResultSchema,
  marketSearchResultSchema,
  modifyDesignSchemeResultSchema,
  removeDesignSchemeResultSchema,
  renameDesignSchemeResultSchema,
  selectCoverResultSchema,
  updateDesignSchemeResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import {
  createDesktopGateway,
  DesktopGatewayError,
  resolveDesktopDesignSchemeAssetUrl,
} from '../desktop-gateway';

const NOW = '2026-08-29T00:00:00.000Z';
const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

const summary = {
  id: 'scheme_1',
  name: 'Editorial Poster',
  summary: 'A faithful editorial poster scheme.',
  status: 'draft' as const,
  sourcePresentation: 'skill' as const,
  sourceLabel: 'example/design-skill',
  currentRevisionId: 'rev_1',
  version: 1,
  workingDraftRevisionId: null,
  coverAssetId: null,
  fidelity: 'faithful' as const,
  inputLabels: [],
  hasSuccessfulTrial: false,
  lastRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const document = {
  schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
  revisionId: 'rev_1',
  schemeId: 'scheme_1',
  name: 'Editorial Poster',
  summary: 'A faithful editorial poster scheme.',
  fidelity: 'faithful' as const,
  sources: [
    {
      id: 'source_1',
      kind: 'github-skill' as const,
      role: 'normative' as const,
      uri: 'https://github.com/example/design-skill',
      resolvedRef: 'main',
      commitHash: COMMIT,
      contentHash: HASH,
      relativePath: 'README.md',
      evidencePath: 'README.md',
      license: 'MIT',
    },
  ],
  sourceSnapshotIds: [],
  inputs: [],
  parameters: [],
  constraints: [],
  promptProgram: [
    {
      id: 'prompt_1',
      order: 0,
      kind: 'input-template' as const,
      template: 'Create a quiet editorial poster.',
      variables: [],
      sourceIds: ['source_1'],
    },
  ],
  assetIds: [],
  compilation: {
    compiledAt: NOW,
    model: { model: 'text-model' },
    adopted: [],
    omitted: [],
    warnings: [],
    trace: [],
  },
  createdBy: 'user' as const,
  createdAt: NOW,
};

const outputAsset = {
  id: 'asset_1',
  origin: 'local-run' as const,
  mimeType: 'image/png',
  width: 1024,
  height: 1024,
  byteSize: 10,
  contentHash: HASH,
  role: 'primary' as const,
  license: null,
  createdAt: NOW,
  runId: 'run_1',
};

const runStep = {
  id: 'step_1',
  kind: 'compile-prompt' as const,
  dependsOn: [],
  inputRefs: [],
  outputRefs: [],
  timeoutMs: 1_000,
  maxAttempts: 1,
  status: 'completed' as const,
  startedAt: NOW,
  completedAt: NOW,
  error: null,
};

const responses: Record<string, unknown> = {
  [DESIGN_SCHEME_WIRE_METHODS.list]: designSchemePageSchema.parse({
    items: [summary],
    nextCursor: null,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.get]: designSchemeDetailSchema.parse({
    summary,
    document,
    assets: [],
    sourceSnapshots: [],
  }),
  [DESIGN_SCHEME_WIRE_METHODS.searchMarket]: marketSearchResultSchema.parse({
    query: 'editorial',
    fromCache: true,
    fetchedAt: NOW,
    candidates: [],
    nextCursor: null,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.create]: createDesignSchemeResultSchema.parse({
    scheme: summary,
    document,
    trace: [],
  }),
  [DESIGN_SCHEME_WIRE_METHODS.update]: updateDesignSchemeResultSchema.parse({
    scheme: summary,
    document,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.modify]: modifyDesignSchemeResultSchema.parse({
    scheme: summary,
    document,
    trace: [],
  }),
  [DESIGN_SCHEME_WIRE_METHODS.cancel]: cancelDesignSchemeResultSchema.parse({
    executionId: 'exec_1',
    status: 'cancelled',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.confirmInstall]: confirmDesignSchemeInstallResultSchema.parse({
    executionId: 'exec_1',
    status: 'accepted',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.selectCover]: selectCoverResultSchema.parse({
    scheme: { ...summary, coverAssetId: 'asset_1' },
    selectedAssetId: 'asset_1',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.formalize]: formalizeDesignSchemeResultSchema.parse({
    scheme: {
      ...summary,
      status: 'formal',
      coverAssetId: 'asset_1',
      hasSuccessfulTrial: true,
    },
    revisionId: 'rev_1',
    formalized: true,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.promoteWorkingDraft]: promoteWorkingDraftResultSchema.parse({
    scheme: {
      ...summary,
      status: 'formal',
      currentRevisionId: 'rev_2',
      coverAssetId: 'asset_1',
      hasSuccessfulTrial: true,
    },
    promotedRevisionId: 'rev_2',
    promoted: true,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.rename]: renameDesignSchemeResultSchema.parse({
    scheme: summary,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.remove]: removeDesignSchemeResultSchema.parse({
    schemeId: 'scheme_1',
    removed: true,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.checkUpdate]: checkDesignSchemeUpdateResultSchema.parse({
    status: 'up-to-date',
    detail: 'No update is available.',
    scheme: summary,
    revisionId: 'rev_1',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.importPackage]: importDesignSchemeResultSchema.parse({
    scheme: summary,
    revisionId: 'rev_1',
    status: 'draft',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.exportPackage]: exportDesignSchemeResultSchema.parse({
    package: {
      id: 'package_1',
      format: 'musefold.design',
      formatVersion: DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
      contentHash: HASH,
      sizeBytes: 10,
      createdAt: NOW,
    },
    schemeId: 'scheme_1',
    status: 'delivered',
  }),
  [DESIGN_SCHEME_WIRE_METHODS.prepareRun]: prepareDesignSchemeRunResultSchema.parse({
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    brief: 'Run the scheme',
    inputValues: {},
    executionSettings: {
      providerId: 'provider_1',
      size: '1024x1024',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
    plan: {
      id: 'plan_1',
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeRevisionId: 'rev_1',
      sourceSnapshotIds: [],
      inputs: [],
      steps: [
        {
          id: 'step_inspect',
          kind: 'inspect-input',
          dependsOn: [],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 1_000,
          maxAttempts: 1,
        },
        {
          id: 'step_compile',
          kind: 'compile-prompt',
          dependsOn: ['step_inspect'],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 1_000,
          maxAttempts: 1,
        },
        {
          id: 'step_generate',
          kind: 'generate-image',
          dependsOn: ['step_compile'],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 1_000,
          maxAttempts: 1,
        },
        {
          id: 'step_evaluate',
          kind: 'evaluate-image',
          dependsOn: ['step_generate'],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 1_000,
          maxAttempts: 1,
        },
      ],
      provider: {
        providerId: 'provider_1',
        providerName: 'Provider',
        model: 'model-1',
        providerVersion: null,
        capabilities: { text: true, vision: true, image: true, multiImage: true, editing: true },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'rev_1',
        policyVersion: 'desktop-fixed-v1',
        appliedAt: NOW,
      },
      budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
      evaluation: {
        ratio: null,
        requiredChecks: ['output-count', 'file-valid', 'aspect-ratio'],
      },
    },
    repair: null,
  }),
  [DESIGN_SCHEME_WIRE_METHODS.run]: designSchemeRunResultSchema.parse({
    runId: 'run_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    mode: 'trial',
    status: 'completed',
    compiledPrompt: 'A quiet editorial poster.',
    outputs: [outputAsset],
    steps: [runStep],
    evaluation: null,
    repair: null,
    error: null,
    createdAt: NOW,
    completedAt: NOW,
  }),
};

const inputs: Record<string, unknown> = {
  [DESIGN_SCHEME_WIRE_METHODS.list]: { limit: 10 },
  [DESIGN_SCHEME_WIRE_METHODS.get]: { id: 'scheme_1', revision: { kind: 'current' } },
  [DESIGN_SCHEME_WIRE_METHODS.searchMarket]: { query: 'editorial', limit: 10 },
  [DESIGN_SCHEME_WIRE_METHODS.create]: {
    executionId: 'exec_1',
    brief: 'Create a scheme',
    sourceUris: [],
    sourceBindings: [],
    sourceAssetIds: [],
  },
  [DESIGN_SCHEME_WIRE_METHODS.update]: {
    schemeId: 'scheme_1',
    baseRevisionId: 'rev_1',
    document,
    expectedVersion: 1,
  },
  [DESIGN_SCHEME_WIRE_METHODS.modify]: {
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    baseRevisionId: 'rev_1',
    instruction: 'Make the layout quieter',
  },
  [DESIGN_SCHEME_WIRE_METHODS.cancel]: { executionId: 'exec_1', runId: 'run_1' },
  [DESIGN_SCHEME_WIRE_METHODS.confirmInstall]: { executionId: 'exec_1', decision: 'install' },
  [DESIGN_SCHEME_WIRE_METHODS.selectCover]: {
    schemeId: 'scheme_1',
    assetId: 'asset_1',
    expectedVersion: 1,
  },
  [DESIGN_SCHEME_WIRE_METHODS.formalize]: {
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    coverAssetId: 'asset_1',
    expectedVersion: 1,
    confirmed: true,
  },
  [DESIGN_SCHEME_WIRE_METHODS.promoteWorkingDraft]: {
    schemeId: 'scheme_1',
    workingDraftRevisionId: 'rev_2',
    expectedVersion: 2,
    confirmed: true,
  },
  [DESIGN_SCHEME_WIRE_METHODS.rename]: {
    schemeId: 'scheme_1',
    name: 'Renamed',
    expectedVersion: 1,
  },
  [DESIGN_SCHEME_WIRE_METHODS.remove]: { schemeId: 'scheme_1', expectedVersion: 1 },
  [DESIGN_SCHEME_WIRE_METHODS.checkUpdate]: { schemeId: 'scheme_1', revisionId: 'rev_1' },
  [DESIGN_SCHEME_WIRE_METHODS.importPackage]: {
    stagedPackageId: 'package_1',
    packageHash: `sha256:${HASH}`,
    formatVersion: DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  },
  [DESIGN_SCHEME_WIRE_METHODS.exportPackage]: {
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    formatVersion: DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  },
  [DESIGN_SCHEME_WIRE_METHODS.prepareRun]: {
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    mode: 'trial',
    brief: 'Run the scheme',
    inputValues: {},
    executionSettings: {
      providerId: 'provider_1',
      size: '1024x1024',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
  },
  [DESIGN_SCHEME_WIRE_METHODS.run]: {
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    brief: 'Run the scheme',
    inputValues: {},
    plan: {
      id: 'plan_1',
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeRevisionId: 'rev_1',
      sourceSnapshotIds: [],
      inputs: [],
      steps: [
        {
          id: 'step_1',
          kind: 'compile-prompt',
          dependsOn: [],
          inputRefs: [],
          outputRefs: [],
          timeoutMs: 1_000,
          maxAttempts: 1,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          error: null,
        },
      ],
      provider: {
        providerId: 'provider_1',
        providerName: 'Provider',
        model: 'model-1',
        providerVersion: null,
        capabilities: { text: true, vision: false, image: true, multiImage: false, editing: false },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'rev_1',
        policyVersion: 'policy-1',
        appliedAt: NOW,
      },
      budget: { maxSteps: 1, maxOutputs: 1, maxRepairRuns: 0 },
      evaluation: { ratio: null, requiredChecks: [] },
    },
    repair: null,
  },
};

const invokeMock = vi.fn<(method: string, payload?: unknown) => Promise<unknown>>();
const prepareImportMock = vi.fn<(payload: unknown) => Promise<unknown>>();

type DesignSchemeGateway = NonNullable<ReturnType<typeof createDesktopGateway>['designSchemes']>;

function setBridge(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      musefoldV25: {
        invoke: invokeMock,
        prepareDesignSchemeImportPackage: prepareImportMock,
        onDesignSchemeEvent: vi.fn(() => vi.fn()),
      },
    },
  });
}

async function callMethod(
  gateway: DesignSchemeGateway,
  method: string,
  input: unknown,
): Promise<unknown> {
  switch (method) {
    case DESIGN_SCHEME_WIRE_METHODS.list:
      return gateway.list(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.get:
      return gateway.get((input as { id: string }).id);
    case DESIGN_SCHEME_WIRE_METHODS.searchMarket:
      return gateway.searchMarket(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.create:
      return gateway.create(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.update:
      return gateway.update(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.modify:
      return gateway.modify(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.cancel:
      return gateway.cancel(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.confirmInstall:
      if (!gateway.confirmInstall) throw new Error('confirm install method is missing');
      return gateway.confirmInstall(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.selectCover:
      return gateway.selectCover(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.formalize:
      return gateway.formalize(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.promoteWorkingDraft:
      return gateway.promoteWorkingDraft(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.rename:
      return gateway.rename(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.remove:
      return gateway.remove(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.checkUpdate:
      return gateway.checkUpdate(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.importPackage:
      return gateway.importPackage(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.exportPackage:
      return gateway.exportPackage(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.prepareRun:
      if (!gateway.prepareRun) throw new Error('prepare run method is missing');
      return gateway.prepareRun(input as never);
    case DESIGN_SCHEME_WIRE_METHODS.run:
      return gateway.run(input as never);
  }
  throw new Error(`Unhandled design scheme method: ${method}`);
}

describe('desktop design scheme asset URL', () => {
  it('encodes only canonical opaque ids into the path-free media route', () => {
    expect(resolveDesktopDesignSchemeAssetUrl('asset_1')).toBe('media://scheme-asset/asset_1');
    expect(resolveDesktopDesignSchemeAssetUrl('../secret')).toBeNull();
    expect(resolveDesktopDesignSchemeAssetUrl('asset/1')).toBeNull();
    expect(resolveDesktopDesignSchemeAssetUrl('')).toBeNull();
    expect(resolveDesktopDesignSchemeAssetUrl('a'.repeat(65))).toBeNull();
  });
});

describe('desktop design scheme gateway transport contract', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    prepareImportMock.mockReset();
    setBridge();
    invokeMock.mockImplementation(async (method) => ({ ok: true, data: responses[method] }));
  });

  it('maps all 18 deployed methods to exact payloads and parses each response', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    for (const method of DESIGN_SCHEME_METHOD_NAMES) {
      await expect(callMethod(gateway, method, inputs[method])).resolves.toEqual(responses[method]);
    }
    expect(invokeMock.mock.calls.map(([method, payload]) => [method, payload])).toEqual(
      DESIGN_SCHEME_METHOD_NAMES.map((method) => [method, inputs[method]]),
    );
  });

  it('uses the optional package host channel outside the 16-method registry', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway?.prepareImportPackage) throw new Error('package host method is missing');
    const input = { acceptedFormatVersions: [1, 2] as Array<1 | 2> };
    prepareImportMock.mockResolvedValueOnce({ ok: true, data: { status: 'cancelled' } });

    await expect(gateway.prepareImportPackage(input)).resolves.toEqual({ status: 'cancelled' });
    expect(prepareImportMock).toHaveBeenCalledWith(input);
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining('prepareImportPackage'),
      expect.anything(),
    );
  });

  it('maps package host errors and rejects a missing optional member', async () => {
    let gateway = createDesktopGateway().designSchemes;
    if (!gateway?.prepareImportPackage) throw new Error('package host method is missing');
    prepareImportMock.mockResolvedValueOnce({
      ok: false,
      code: 'DESIGN_SCHEME_PACKAGE_INVALID',
      message: '分享包无效',
    });
    await expect(
      gateway.prepareImportPackage({ acceptedFormatVersions: [2] }),
    ).rejects.toMatchObject({ code: 'DESIGN_SCHEME_PACKAGE_INVALID', message: '分享包无效' });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { musefoldV25: { invoke: invokeMock, onDesignSchemeEvent: vi.fn() } },
    });
    gateway = createDesktopGateway().designSchemes;
    if (!gateway?.prepareImportPackage) throw new Error('package host method is missing');
    await expect(
      gateway.prepareImportPackage({ acceptedFormatVersions: [2] }),
    ).rejects.toMatchObject({ code: 'DESIGN_SCHEME_PACKAGE_HOST_UNAVAILABLE' });
  });

  it('forwards an explicit working-draft detail selector', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    await gateway.get('scheme_1', { kind: 'working-draft', revisionId: 'rev_2' });

    expect(invokeMock).toHaveBeenLastCalledWith(DESIGN_SCHEME_WIRE_METHODS.get, {
      id: 'scheme_1',
      revision: { kind: 'working-draft', revisionId: 'rev_2' },
    });
  });

  it('rejects malformed responses for every deployed method', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    for (const method of DESIGN_SCHEME_METHOD_NAMES) {
      invokeMock.mockResolvedValueOnce({ ok: true, data: { malformed: true } });
      await expect(callMethod(gateway, method, inputs[method])).rejects.toBeInstanceOf(z.ZodError);
    }
  });

  it('rejects malformed envelopes for every deployed method', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    for (const method of DESIGN_SCHEME_METHOD_NAMES) {
      invokeMock.mockResolvedValueOnce(undefined);
      await expect(callMethod(gateway, method, inputs[method])).rejects.toMatchObject({
        name: 'DesktopGatewayError',
        code: 'MALFORMED_ENVELOPE',
        message: '桌面桥返回格式无效',
      });
    }
  });

  it('maps structured unavailable errors and drops malformed event payloads', async () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');
    invokeMock.mockResolvedValueOnce({
      ok: false,
      code: 'DESIGN_SCHEME_UNAVAILABLE',
      message: '设计方案暂未接入桌面 v2.5,当前操作不可用',
    });
    await expect(gateway.list({})).rejects.toMatchObject({
      name: 'DesktopGatewayError',
      code: 'DESIGN_SCHEME_UNAVAILABLE',
    });

    const listener = vi.fn();
    const onEvent = window.musefoldV25?.onDesignSchemeEvent as ReturnType<typeof vi.fn>;
    onEvent.mockImplementationOnce((callback: (payload: unknown) => void) => {
      callback({ malformed: true });
      return vi.fn();
    });
    gateway.subscribeEvents(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards valid events and preserves the preload unsubscribe identity', () => {
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');
    const listener = vi.fn();
    const unsubscribe = vi.fn();
    const event = { kind: 'state', executionId: 'exec_1', state: 'created' } as const;
    const onEvent = window.musefoldV25?.onDesignSchemeEvent as ReturnType<typeof vi.fn>;
    onEvent.mockImplementationOnce((callback: (payload: unknown) => void) => {
      callback(event);
      return unsubscribe;
    });

    const returnedUnsubscribe = gateway.subscribeEvents(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
    expect(returnedUnsubscribe).toBe(unsubscribe);
  });

  it('fails with BRIDGE_MISSING for every canonical method when the v25 bridge is absent', async () => {
    vi.stubGlobal('window', {});
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    for (const method of DESIGN_SCHEME_METHOD_NAMES) {
      await expect(callMethod(gateway, method, inputs[method])).rejects.toMatchObject({
        name: 'DesktopGatewayError',
        code: 'BRIDGE_MISSING',
        message: 'v2.5 preload 桥未注入',
      });
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('fails with DESIGN_SCHEME_UNAVAILABLE when only the event bridge member is absent', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { musefoldV25: { invoke: invokeMock } },
    });
    const gateway = createDesktopGateway().designSchemes;
    if (!gateway) throw new Error('design scheme gateway is missing');

    expect(() => gateway.subscribeEvents(vi.fn())).toThrowError(
      new DesktopGatewayError('DESIGN_SCHEME_UNAVAILABLE', '设计方案事件暂不可用'),
    );
  });
});
