import { describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  DESIGN_SCHEME_CANONICAL_METHOD_NAMES,
  DESIGN_SCHEME_LIFECYCLE_METHOD_NAMES,
  DESIGN_SCHEME_METHOD_NAMES,
  DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  DESIGN_SCHEME_WIRE_METHODS,
  LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  confirmDesignSchemeInstallInputSchema,
  confirmDesignSchemeInstallResultSchema,
  createDesignSchemeInputSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  designSchemeDetailInputSchema,
  designSchemeEventSchema,
  designSchemeHistorySourceSelectionSchema,
  designSchemeListQuerySchema,
  designSchemePackageFormatVersionSchema,
  designSchemeRevisionDocumentSchema,
  designSchemeRunExecutionSettingsSchema,
  designSchemeRunInputSchema,
  designSchemeRunPlanSchema,
  designSchemeSummarySchema,
  designSchemeAssetSchema,
  evidencePathSchema,
  exportDesignSchemeInputSchema,
  exportDesignSchemeResultSchema,
  fidelitySchema,
  importDesignSchemeInputSchema,
  importDesignSchemeResultSchema,
  legacyExportDesignSchemeResultSchema,
  legacyImportDesignSchemeInputSchema,
  marketCandidateSchema,
  marketSearchQuerySchema,
  parameterDefinitionSchema,
  prepareDesignSchemeImportPackageInputSchema,
  prepareDesignSchemeImportPackageResultSchema,
  prepareDesignSchemeRunInputSchema,
  prepareDesignSchemeRunResultSchema,
  promoteWorkingDraftInputSchema,
  promoteWorkingDraftResultSchema,
  relativePathSchema,
  runModeSchema,
  runResultSchema,
  selectCoverInputSchema,
  schemeStatusSchema,
  sourceBindingSchema,
  sourceFileMetadataSchema,
  sourcePackageSchema,
  sourceConfirmationSchema,
  sourceSnapshotSchema,
  structuredDesignSchemeErrorSchema,
  httpsUriSchema,
  runStepSchema,
  type DesignSchemeRevisionDocument,
} from '../index';

const hash = 'a'.repeat(64);
const now = '2026-08-29T00:00:00.000Z';

const source = {
  id: 'src_repo',
  kind: 'github-skill' as const,
  role: 'normative' as const,
  uri: 'https://github.com/example/design-skill',
  ref: 'main',
  commit: hash,
  contentHash: hash,
  relativePath: 'references/rules.md',
  evidencePath: 'references/rules.md',
  license: 'MIT',
};

function validRevision(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'rev_1',
    schemeId: 'scheme_1',
    name: 'Editorial Poster',
    summary: 'A faithful editorial poster scheme.',
    fidelity: 'faithful',
    sources: [source],
    sourceSnapshotIds: ['snap_1'],
    inputs: [
      { id: 'topic', label: 'Topic', kind: 'text', required: true },
      {
        id: 'subject',
        label: 'Subject image',
        kind: 'image',
        required: false,
        imageRole: 'subject-reference',
      },
    ],
    parameters: [
      {
        id: 'sampling',
        label: 'Sampling',
        type: 'number',
        defaultValue: { max_tokens: 128, nested: ['stable', true] },
        userEditable: true,
      },
    ],
    constraints: [
      {
        id: 'layout',
        domain: 'composition',
        statement: 'Keep the subject in the lower third.',
        mode: 'required',
        sourceIds: ['src_repo'],
        evidencePath: 'references/rules.md',
        userOverridable: false,
      },
    ],
    promptProgram: [
      {
        id: 'prompt_1',
        order: 0,
        kind: 'input-template',
        template: 'Design a poster for {{topic}} with a quiet editorial grid.',
        variables: ['topic'],
        sourceIds: ['src_repo'],
      },
    ],
    assetIds: ['asset_1'],
    compilation: {
      compiledAt: now,
      compilerVersion: 'compiler-1',
      model: { model: 'text-model', connectionName: 'managed' },
      adopted: ['editorial grid'],
      omitted: ['unsupported executable workflow'],
      warnings: [],
      briefExcerpt: 'Make an editorial poster.',
      trace: [
        {
          id: 'trace_1',
          kind: 'assistant',
          title: 'Compiled source rules',
          status: 'success',
          durationMs: 12,
        },
      ],
    },
    createdBy: 'user',
    parentRevisionId: null,
    createdAt: now,
  };
}

const summary = {
  id: 'scheme_1',
  name: 'Editorial Poster',
  summary: 'A faithful editorial poster scheme.',
  status: 'draft' as const,
  sourcePresentation: 'skill' as const,
  sourceLabel: 'example/design-skill',
  currentRevisionId: 'rev_1',
  fidelity: 'faithful' as const,
  createdAt: now,
  updatedAt: now,
};

const step = {
  id: 'step_1',
  kind: 'compile-prompt' as const,
  dependsOn: [],
  inputRefs: ['topic'],
  outputRefs: ['prompt_1'],
  timeoutMs: 30_000,
  maxAttempts: 1,
  status: 'pending' as const,
  startedAt: null,
  completedAt: null,
  error: null,
};

function validExecutionSettings() {
  return {
    providerId: 'provider_1',
    size: '1536x1024' as const,
    aspectRatio: '3:2',
    quality: 'high' as const,
    negativePrompt: 'Avoid illegible lettering.',
    outputCount: 1,
    referenceAssetIds: ['asset_ref_1', 'asset_ref_2'],
    promptReferenceSelections: [
      { promptId: 'prompt_1', scope: 'full' as const, expectedVersion: 3 },
    ],
    workbenchSessionId: 'session_1',
  };
}

function validPlan() {
  return {
    id: 'plan_1',
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    schemeRevisionId: 'rev_1',
    sourceSnapshotIds: ['snap_1'],
    inputs: [{ slotId: 'topic', kind: 'text' as const, valueIds: [], text: 'night market' }],
    steps: [step],
    provider: {
      providerId: 'provider_1',
      providerName: 'Image Provider',
      model: 'image-model',
      providerVersion: null,
      capabilities: { text: true, vision: true, image: true, multiImage: false, editing: false },
    },
    policy: {
      priorityMode: 'scheme_first' as const,
      schemeRevisionId: 'rev_1',
      policyVersion: 'policy-1',
      appliedAt: now,
    },
    budget: { maxSteps: 10, maxOutputs: 1, maxRepairRuns: 1 },
    evaluation: { ratio: '3:2', requiredChecks: ['dimensions'] },
  };
}

describe('shared design-scheme contracts', () => {
  it('round-trips path-free entities through the barrel export', () => {
    const revision = designSchemeRevisionDocumentSchema.parse(validRevision());
    const parsedSummary = designSchemeSummarySchema.parse(summary);
    const asset = designSchemeAssetSchema.parse({
      id: 'asset_1',
      origin: 'repository',
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
      byteSize: 2048,
      contentHash: hash,
      role: 'example',
      license: 'MIT',
      createdAt: now,
    });
    const detail = designSchemeDetailSchema.parse({
      summary: parsedSummary,
      document: revision,
      assets: [asset],
      sourceSnapshots: [],
    });

    expect(revision).toMatchObject({
      schemaVersion: 1,
      sourceSnapshotIds: ['snap_1'],
      assetIds: ['asset_1'],
    });
    expect(detail.assets[0]).toEqual(asset);
    expect(detail.document.sources[0]?.uri).toBe(source.uri);
  });

  it('provides bounded defaults and explicit nullable values', () => {
    expect(designSchemeListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(marketSearchQuerySchema.parse({ query: 'editorial' })).toMatchObject({ limit: 20 });
    expect(
      designSchemeRevisionDocumentSchema.parse({
        ...validRevision(),
        sourceSnapshotIds: undefined,
      }),
    ).toMatchObject({ sourceSnapshotIds: [], assetIds: ['asset_1'] });
    expect(designSchemeSummarySchema.parse(summary)).toMatchObject({
      workingDraftRevisionId: null,
      coverAssetId: null,
      inputLabels: [],
      hasSuccessfulTrial: false,
      lastRunAt: null,
    });
    expect(
      designSchemeSummarySchema.safeParse({
        ...summary,
        status: 'formal',
      }).success,
    ).toBe(false);
    expect(
      sourcePackageSchema.parse({
        id: 'pkg_1',
        kind: 'github',
        repositoryUrl: source.uri,
        license: null,
        createdAt: now,
      }).license,
    ).toBeNull();
    expect(
      sourcePackageSchema.safeParse({
        id: 'pkg_1',
        kind: 'github',
        uri: null,
        repositoryUrl: source.uri,
        license: null,
        createdAt: now,
      }).success,
    ).toBe(false);
    expect(
      sourceConfirmationSchema.parse({
        repositoryUrl: source.uri,
        name: 'Design Skill',
        description: 'A source package.',
        resolvedRef: 'main',
        commitHash: hash,
        textFileCount: 1,
        textNames: ['README.md'],
        imageFileCount: 0,
        license: 'MIT',
      }),
    ).toMatchObject({ textNames: ['README.md'] });
  });

  it('keeps legacy source semantics while replacing local DTO locations', () => {
    const legacySemanticMapping = sourceBindingSchema.parse({
      id: 'src_legacy',
      kind: 'github-readme',
      role: 'reference',
      uri: 'https://github.com/example/repo',
      ref: 'resolved-branch',
      commit: hash,
      contentHash: hash,
      relativePath: 'README.md',
      evidencePath: 'docs/evidence.md',
      license: null,
    });
    expect(legacySemanticMapping).toMatchObject({ ref: 'resolved-branch', commit: hash });
    expect(
      sourceBindingSchema.safeParse({
        ...source,
        resolvedRef: 'main',
        ref: 'other-ref',
      }).success,
    ).toBe(false);
    expect(
      sourceBindingSchema.safeParse({
        ...source,
        commitHash: hash,
        commit: 'b'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      sourceFileMetadataSchema.parse({
        relativePath: 'README.md',
        kind: 'text',
        mimeType: 'text/markdown',
        sizeBytes: 10,
        contentHash: hash,
        evidencePath: 'docs/evidence.md',
        textExcerpt: 'A source excerpt',
      }),
    ).toHaveProperty('relativePath', 'README.md');
    expect(sourceBindingSchema.safeParse({ ...source, filePath: 'README.md' }).success).toBe(false);
    expect(
      sourceFileMetadataSchema.safeParse({
        relativePath: 'README.md',
        kind: 'text',
        mimeType: null,
        sizeBytes: 0,
        contentHash: hash,
        evidencePath: null,
        textExcerpt: null,
        storeKey: 'managed/asset',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown, owner, and workspace fields at every contract boundary', () => {
    for (const field of ['unexpected', 'ownerId', 'workspaceId']) {
      expect(
        designSchemeRevisionDocumentSchema.safeParse({ ...validRevision(), [field]: 'x' }).success,
      ).toBe(false);
      expect(
        createDesignSchemeInputSchema.safeParse({
          executionId: 'exec_1',
          brief: 'create',
          sourceUris: [source.uri],
          sourceBindings: [source],
          sourceAssetIds: [],
          [field]: 'x',
        }).success,
      ).toBe(false);
    }
    expect(
      designSchemeDetailSchema.safeParse({
        summary,
        document: validRevision(),
        assets: [],
        sourceSnapshots: [
          {
            id: 'snap_1',
            packageId: 'pkg_1',
            kind: 'github',
            repositoryUrl: source.uri,
            ref: 'main',
            commit: hash,
            contentHash: hash,
            totalBytes: 0,
            files: [],
            createdAt: now,
            ownerId: 'owner_1',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects all local path forms and allows safe relative evidence paths', () => {
    for (const value of [
      '/Users/creator/image.png',
      'C:\\Users\\creator\\image.png',
      '\\\\server\\share\\image.png',
      'file:///Users/creator/image.png',
      'media://managed/image.png',
      '//host/share/image.png',
      'C:creator/image.png',
      '\\creator\\image.png',
      '~/.config/musefold',
      'docs/../secret.txt',
      'docs\\..\\secret.txt',
      'docs/secret\0.txt',
    ]) {
      expect(relativePathSchema.safeParse(value).success, value).toBe(false);
      expect(evidencePathSchema.safeParse(value).success, value).toBe(false);
      expect(sourceBindingSchema.safeParse({ ...source, evidencePath: value }).success, value).toBe(
        false,
      );
    }
    expect(evidencePathSchema.parse('references/visual/example.png')).toBe(
      'references/visual/example.png',
    );
    expect(relativePathSchema.safeParse('docs/./rules.md').success).toBe(false);
    expect(relativePathSchema.safeParse('docs%2Fsecret.md').success).toBe(true);
    expect(relativePathSchema.safeParse('https://example.com/file').success).toBe(false);
    expect(relativePathSchema.safeParse('docs\\rules.md').success).toBe(false);
  });

  it('requires HTTPS for source URLs and keeps credentials out of URLs', () => {
    expect(httpsUriSchema.parse('https://github.com/example/repo')).toBe(
      'https://github.com/example/repo',
    );
    for (const value of [
      'http://github.com/example/repo',
      'file:///tmp/repo',
      'media://repo',
      'https://user:password@example.com/repo',
      'https://example.com/repo?apiKey=leaked',
      'https://example.com/repo#token=leaked',
      'https://example.com/repo?signature=leaked',
      'https://example.com/repo?X-Goog-Signature=leaked',
      'https://example.com/repo?accessKey=leaked',
      '//example.com/repo',
    ]) {
      expect(httpsUriSchema.safeParse(value).success, value).toBe(false);
    }
    expect(
      sourceBindingSchema.safeParse({ ...source, uri: 'http://github.com/example/repo' }).success,
    ).toBe(false);
  });

  it('recursively rejects sensitive default fields but permits prompt token prose and max_tokens', () => {
    expect(
      parameterDefinitionSchema.safeParse({
        id: 'params_1',
        label: 'Generation parameters',
        type: 'number',
        defaultValue: { max_tokens: 128, prompt: 'Use a token motif' },
        userEditable: true,
      }).success,
    ).toBe(true);
    for (const key of [
      'apiKey',
      'authorization',
      'bearer',
      'oauthToken',
      'password',
      'privateKey',
      'secret',
      'ownerId',
      'workspaceId',
      'access-token',
      'storeKey',
      'imagePath',
      'accessKey',
      'openaiKey',
    ]) {
      expect(
        parameterDefinitionSchema.safeParse({
          id: 'params_1',
          label: 'Unsafe',
          type: 'text',
          defaultValue: { nested: [{ [key]: 'private' }] },
          userEditable: true,
        }).success,
        key,
      ).toBe(false);
    }
    expect(
      designSchemeRevisionDocumentSchema.safeParse({
        ...validRevision(),
        promptProgram: [
          { ...validRevision().promptProgram[0], template: 'Include a token in the prompt.' },
        ],
      }).success,
    ).toBe(true);
  });

  it('enforces status, fidelity, mode, and version boundaries', () => {
    for (const value of ['draft', 'formal'])
      expect(schemeStatusSchema.safeParse(value).success).toBe(true);
    for (const value of ['verified', 'faithful', 'adapted', 'unsupported'])
      expect(fidelitySchema.safeParse(value).success).toBe(true);
    for (const value of ['trial', 'formal'])
      expect(runModeSchema.safeParse(value).success).toBe(true);
    expect(
      designSchemeRevisionDocumentSchema.safeParse({ ...validRevision(), schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      designSchemeRevisionDocumentSchema.safeParse({ ...validRevision(), schemaVersion: 0 })
        .success,
    ).toBe(false);
    expect(designSchemeListQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(designSchemeListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(designSchemeListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      sourceSnapshotSchema.safeParse({
        id: 'snap_1',
        packageId: 'pkg_1',
        kind: 'github',
        repositoryUrl: source.uri,
        totalBytes: 0,
        files: [],
        createdAt: now,
      }).success,
    ).toBe(false);
    expect(runStepSchema.safeParse({ ...step, maxAttempts: undefined }).success).toBe(false);
  });

  it('separates scheme status from run mode and blocks unsupported runs', () => {
    const plan = validPlan();
    const run = {
      executionId: 'exec_1',
      schemeId: 'scheme_1',
      revisionId: 'rev_1',
      schemeStatus: 'draft' as const,
      schemeFidelity: 'faithful' as const,
      mode: 'trial' as const,
      brief: 'run this scheme',
      inputValues: { topic: 'night market' },
      executionSettings: validExecutionSettings(),
      plan,
    };
    expect(designSchemeRunInputSchema.parse(run)).toMatchObject({
      priorityMode: 'scheme_first',
      repair: null,
    });
    expect(
      designSchemeRunInputSchema.safeParse({ ...run, schemeFidelity: 'unsupported' }).success,
    ).toBe(false);
    expect(
      designSchemeRunInputSchema.safeParse({ ...run, mode: 'formal', schemeStatus: 'draft' })
        .success,
    ).toBe(false);
    expect(designSchemeRunInputSchema.safeParse({ ...run, ownerId: 'owner_1' }).success).toBe(
      false,
    );
  });

  it('separates host-authored run preparation from the complete frozen run input', () => {
    const preparation = prepareDesignSchemeRunInputSchema.parse({
      executionId: 'exec_prepare',
      schemeId: 'scheme_1',
      revisionId: 'rev_1',
      mode: 'trial',
      brief: 'run this scheme',
      inputValues: { topic: 'night market' },
      executionSettings: validExecutionSettings(),
    });
    expect(preparation).toMatchObject({ priorityMode: 'scheme_first' });
    expect(preparation).not.toHaveProperty('schemeStatus');
    expect(preparation).not.toHaveProperty('plan');
    expect(
      prepareDesignSchemeRunInputSchema.safeParse({
        ...preparation,
        plan: validPlan(),
      }).success,
    ).toBe(false);
    expect(
      prepareDesignSchemeRunInputSchema.safeParse({
        ...preparation,
        inputValues: { topic: '/Users/creator/private.txt' },
      }).success,
    ).toBe(false);

    const preparedResult = prepareDesignSchemeRunResultSchema.parse({
      ...preparation,
      schemeStatus: 'draft',
      schemeFidelity: 'faithful',
      plan: validPlan(),
      repair: null,
    });
    expect(preparedResult.plan.provider.providerName).toBe('Image Provider');
  });

  it('keeps run plans path-free and rejects local request templates', () => {
    const plan = validPlan();
    expect(designSchemeRunPlanSchema.parse(plan)).toEqual(plan);
    const canonicalPlan = {
      ...plan,
      id: undefined,
      runId: 'run_1',
      policy: undefined,
      prioritySnapshot: plan.policy,
      budget: undefined,
      budgets: plan.budget,
    };
    expect(designSchemeRunPlanSchema.parse(canonicalPlan)).toMatchObject({
      runId: 'run_1',
      prioritySnapshot: plan.policy,
      budgets: plan.budget,
    });
    expect(
      designSchemeRunPlanSchema.safeParse({ ...plan, id: 'plan_1', runId: 'run_2' }).success,
    ).toBe(false);
    expect(
      designSchemeRunPlanSchema.safeParse({
        ...plan,
        prioritySnapshot: { ...plan.policy, policyVersion: 'policy-2' },
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunPlanSchema.safeParse({ ...plan, requestTemplate: { prompt: 'local' } })
        .success,
    ).toBe(false);
    expect(
      designSchemeRunPlanSchema.safeParse({
        ...plan,
        policy: { ...plan.policy, workspaceId: 'workspace_1' },
      }).success,
    ).toBe(false);
  });

  it('rejects deep or cyclic parameter defaults without throwing', () => {
    const deeplyNested: unknown[] = [];
    let cursor: unknown[] = deeplyNested;
    for (let depth = 0; depth < 5_000; depth += 1) {
      const next: unknown[] = [];
      cursor.push(next);
      cursor = next;
    }
    expect(() =>
      parameterDefinitionSchema.safeParse({
        id: 'params_deep',
        label: 'Deep',
        type: 'text',
        defaultValue: deeplyNested,
        userEditable: true,
      }),
    ).not.toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      parameterDefinitionSchema.safeParse({
        id: 'params_cycle',
        label: 'Cycle',
        type: 'text',
        defaultValue: cyclic,
        userEditable: true,
      }),
    ).not.toThrow();
    expect(
      parameterDefinitionSchema.safeParse({
        id: 'params_cycle',
        label: 'Cycle',
        type: 'text',
        defaultValue: cyclic,
        userEditable: true,
      }).success,
    ).toBe(false);
  });

  it('accepts Git commit ids in market candidates without admitting signed URLs', () => {
    const candidate = {
      candidateId: 'candidate_1',
      repositoryUrl: 'https://github.com/example/repo',
      fullName: 'example/repo',
      description: null,
      license: 'MIT',
      ref: 'main',
      commit: 'b'.repeat(40),
      updatedAt: now,
      stars: 3,
      topics: [],
      matchReason: '名称命中搜索词',
      riskSummary: null,
    };
    expect(marketCandidateSchema.parse(candidate).commit).toBe(candidate.commit);
    expect(marketCandidateSchema.safeParse({ ...candidate, commit: 'not-a-commit' }).success).toBe(
      false,
    );
  });

  it('keeps result revision aliases consistent and run prompts path-free', () => {
    const result = {
      scheme: summary,
      document: validRevision(),
      revisionId: 'rev_1',
      trace: [],
    };
    expect(createDesignSchemeResultSchema.parse(result).revisionId).toBe('rev_1');
    expect(
      createDesignSchemeResultSchema.safeParse({ ...result, revisionId: 'rev_2' }).success,
    ).toBe(false);
    const run = {
      runId: 'run_1',
      schemeId: 'scheme_1',
      revisionId: 'rev_1',
      mode: 'trial' as const,
      status: 'completed' as const,
      compiledPrompt: '/Users/creator/private.png',
      outputs: [],
      steps: [],
      evaluation: null,
      repair: null,
      error: null,
      createdAt: now,
      completedAt: now,
    };
    expect(runResultSchema.safeParse(run).success).toBe(false);
    expect(runResultSchema.safeParse({ ...run, compiledPrompt: 'A safe prompt' }).success).toBe(
      true,
    );
  });

  it('keeps working-draft promotion explicit and version guarded', () => {
    expect(
      promoteWorkingDraftInputSchema.parse({
        schemeId: 'scheme_1',
        workingDraftRevisionId: 'rev_2',
        expectedVersion: 2,
        confirmed: true,
      }),
    ).toMatchObject({ workingDraftRevisionId: 'rev_2', expectedVersion: 2 });
    expect(
      promoteWorkingDraftInputSchema.safeParse({
        schemeId: 'scheme_1',
        workingDraftRevisionId: 'rev_2',
        expectedVersion: 2,
        confirmed: false,
      }).success,
    ).toBe(false);

    const promotedScheme = {
      ...summary,
      status: 'formal' as const,
      currentRevisionId: 'rev_2',
      workingDraftRevisionId: null,
      coverAssetId: 'asset_1',
      hasSuccessfulTrial: true,
    };
    expect(
      promoteWorkingDraftResultSchema.parse({
        scheme: promotedScheme,
        promotedRevisionId: 'rev_2',
        promoted: true,
      }).promoted,
    ).toBe(true);
    expect(
      promoteWorkingDraftResultSchema.safeParse({
        scheme: promotedScheme,
        promotedRevisionId: 'rev_1',
        promoted: true,
      }).success,
    ).toBe(false);
  });

  it('models explicit install confirmation without host locations or credentials', () => {
    expect(
      confirmDesignSchemeInstallInputSchema.parse({
        executionId: 'exec_1',
        decision: 'install',
      }),
    ).toEqual({ executionId: 'exec_1', decision: 'install' });
    expect(
      confirmDesignSchemeInstallResultSchema.parse({
        executionId: 'exec_1',
        status: 'accepted',
      }),
    ).toEqual({ executionId: 'exec_1', status: 'accepted' });

    for (const unsafe of [
      { path: '/Users/creator/repo' },
      { storeKey: 'managed/repo' },
      { apiKey: 'sk-secret' },
      { bearer: 'secret' },
      { sessionPartition: 'persist:account-1' },
    ]) {
      expect(
        confirmDesignSchemeInstallInputSchema.safeParse({
          executionId: 'exec_1',
          decision: 'install',
          ...unsafe,
        }).success,
      ).toBe(false);
    }
    expect(
      confirmDesignSchemeInstallInputSchema.safeParse({
        executionId: 'exec_1',
        decision: 'accept',
      }).success,
    ).toBe(false);
    expect(DESIGN_SCHEME_METHOD_NAMES).toHaveLength(17);
    expect(DESIGN_SCHEME_LIFECYCLE_METHOD_NAMES).toEqual([
      'designSchemes.confirmInstall',
      'designSchemes.prepareImportPackage',
    ]);
    expect(DESIGN_SCHEME_CANONICAL_METHOD_NAMES).toHaveLength(19);
    expect(DESIGN_SCHEME_WIRE_METHODS.prepareRun).toBe('designSchemes.prepareRun');
    expect(DESIGN_SCHEME_WIRE_METHODS.confirmInstall).toBe('designSchemes.confirmInstall');
  });

  it('selects current or an exact working-draft revision without desktop paths', () => {
    expect(designSchemeDetailInputSchema.parse({ id: 'scheme_1' })).toEqual({
      id: 'scheme_1',
      revision: { kind: 'current' },
    });
    expect(
      designSchemeDetailInputSchema.parse({
        id: 'scheme_1',
        revision: { kind: 'working-draft', revisionId: 'rev_2' },
      }),
    ).toMatchObject({ revision: { kind: 'working-draft', revisionId: 'rev_2' } });
    expect(
      designSchemeDetailInputSchema.safeParse({
        id: 'scheme_1',
        revision: { kind: 'current', revisionId: 'rev_2' },
      }).success,
    ).toBe(false);
    expect(
      designSchemeDetailInputSchema.safeParse({
        id: 'scheme_1',
        revision: { kind: 'working-draft', revisionId: '/tmp/rev.json' },
      }).success,
    ).toBe(false);
  });

  it('accepts history source identity only and rejects renderer content', () => {
    const selection = { runId: 'run_1', assetId: 'asset_1', includePrompt: true };
    expect(designSchemeHistorySourceSelectionSchema.parse(selection)).toEqual(selection);
    for (const unsafe of [
      { assetUrl: 'media://history/asset_1' },
      { prompt: 'renderer supplied prompt' },
      { promptText: 'renderer supplied prompt' },
      { imagePath: '/Users/creator/history.png' },
      { storeKey: 'history/asset_1.png' },
    ]) {
      expect(
        designSchemeHistorySourceSelectionSchema.safeParse({ ...selection, ...unsafe }).success,
      ).toBe(false);
    }
    expect(
      createDesignSchemeInputSchema.safeParse({
        executionId: 'exec_1',
        brief: 'Extract this visual language.',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: [],
        historySources: [selection],
      }).success,
    ).toBe(true);
  });

  it('stages import packages opaquely and keeps format version independent', () => {
    expect(DESIGN_SCHEME_DOCUMENT_VERSION).toBe(1);
    expect(LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION).toBe(1);
    expect(DESIGN_SCHEME_PACKAGE_FORMAT_VERSION).toBe(2);
    expect(designSchemePackageFormatVersionSchema.safeParse(1).success).toBe(true);
    expect(designSchemePackageFormatVersionSchema.safeParse(2).success).toBe(true);
    expect(designSchemePackageFormatVersionSchema.safeParse(3).success).toBe(false);

    expect(prepareDesignSchemeImportPackageInputSchema.parse({})).toEqual({
      acceptedFormatVersions: [1, 2],
    });
    expect(
      prepareDesignSchemeImportPackageResultSchema.parse({
        status: 'staged',
        stagedPackageId: 'staged_pkg_1',
        packageHash: hash,
        sizeBytes: 4096,
        formatVersion: 2,
      }),
    ).toMatchObject({ status: 'staged', stagedPackageId: 'staged_pkg_1' });
    expect(prepareDesignSchemeImportPackageResultSchema.parse({ status: 'cancelled' })).toEqual({
      status: 'cancelled',
    });
    expect(
      importDesignSchemeInputSchema.parse({
        stagedPackageId: 'staged_pkg_1',
        packageHash: hash,
        formatVersion: 2,
      }),
    ).toMatchObject({ stagedPackageId: 'staged_pkg_1', formatVersion: 2 });
    expect(
      legacyImportDesignSchemeInputSchema.parse({
        packageId: 'legacy_pkg_1',
        packageHash: hash,
        formatVersion: 1,
      }),
    ).toMatchObject({ packageId: 'legacy_pkg_1', formatVersion: 1 });

    for (const malformed of [
      {
        status: 'staged',
        stagedPackageId: '/tmp/pkg',
        packageHash: hash,
        sizeBytes: 1,
        formatVersion: 2,
      },
      {
        status: 'staged',
        stagedPackageId: 'pkg_1',
        packageHash: 'bad',
        sizeBytes: 1,
        formatVersion: 2,
      },
      {
        status: 'staged',
        stagedPackageId: 'pkg_1',
        packageHash: hash,
        sizeBytes: 0,
        formatVersion: 2,
      },
      {
        status: 'staged',
        stagedPackageId: 'pkg_1',
        packageHash: hash,
        sizeBytes: 1,
        formatVersion: 3,
      },
      {
        status: 'staged',
        stagedPackageId: 'pkg_1',
        packageHash: hash,
        sizeBytes: 1,
        formatVersion: 2,
        path: '/tmp/pkg',
      },
    ]) {
      expect(prepareDesignSchemeImportPackageResultSchema.safeParse(malformed).success).toBe(false);
    }
    expect(
      importDesignSchemeInputSchema.parse({
        stagedPackageId: 'staged_pkg_legacy',
        packageHash: hash,
        formatVersion: 1,
      }),
    ).toMatchObject({ stagedPackageId: 'staged_pkg_legacy', formatVersion: 1 });
    expect(
      prepareDesignSchemeImportPackageResultSchema.safeParse({
        status: 'staged',
        stagedPackageId: 'pkg_1',
        packageHash: hash,
        sizeBytes: 256 * 1024 * 1024 + 1,
        formatVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      importDesignSchemeInputSchema.safeParse({
        packageId: 'unstaged_pkg_1',
        packageHash: hash,
        formatVersion: 2,
      }).success,
    ).toBe(false);
    expect(DESIGN_SCHEME_WIRE_METHODS.prepareImportPackage).toBe(
      'designSchemes.prepareImportPackage',
    );
  });

  it('distinguishes export delivery from cancellation with path-free metadata', () => {
    const packageMetadata = {
      id: 'share_1',
      format: 'musefold.design' as const,
      formatVersion: 2 as const,
      contentHash: hash,
      sizeBytes: 4096,
      createdAt: now,
    };
    expect(
      exportDesignSchemeInputSchema.parse({
        schemeId: 'scheme_1',
        revisionId: 'rev_1',
        formatVersion: 2,
      }),
    ).toMatchObject({ formatVersion: 2 });
    expect(
      exportDesignSchemeResultSchema.parse({
        package: packageMetadata,
        schemeId: 'scheme_1',
        status: 'delivered',
      }),
    ).toMatchObject({ status: 'delivered' });
    expect(
      exportDesignSchemeResultSchema.parse({ schemeId: 'scheme_1', status: 'cancelled' }),
    ).toEqual({ schemeId: 'scheme_1', status: 'cancelled' });
    expect(
      legacyExportDesignSchemeResultSchema.parse({
        package: { ...packageMetadata, formatVersion: 1 },
        schemeId: 'scheme_1',
        status: 'exported',
      }).status,
    ).toBe('delivered');
    expect(
      exportDesignSchemeResultSchema.safeParse({
        package: { ...packageMetadata, formatVersion: 1 },
        schemeId: 'scheme_1',
        status: 'delivered',
      }).success,
    ).toBe(false);
    expect(
      exportDesignSchemeResultSchema.safeParse({
        package: packageMetadata,
        schemeId: 'scheme_1',
        status: 'delivered',
        path: '/Users/creator/export.musefold.design',
      }).success,
    ).toBe(false);
    expect(
      exportDesignSchemeInputSchema.safeParse({ schemeId: 'scheme_1', formatVersion: 1 }).success,
    ).toBe(false);
  });

  it('supports the host-neutral configure-ai recovery action', () => {
    expect(
      structuredDesignSchemeErrorSchema.parse({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No configured image provider is available.',
        recoveryAction: 'configure-ai',
      }),
    ).toMatchObject({ recoveryAction: 'configure-ai' });
  });

  it('validates host-neutral run execution settings and rejects local request fields', () => {
    expect(designSchemeRunExecutionSettingsSchema.parse(validExecutionSettings())).toEqual(
      validExecutionSettings(),
    );
    for (const unsafe of [
      { prompt: 'renderer compiled prompt' },
      { assetUrl: 'media://asset/ref' },
      { referenceImages: [{ path: '/tmp/reference.png' }] },
      { requestTemplate: { apiKey: 'sk-secret' } },
      { apiKey: 'sk-secret' },
      { bearerToken: 'secret' },
      { sessionPartition: 'persist:account-1' },
      { outputPath: '/tmp/output.png' },
    ]) {
      expect(
        designSchemeRunExecutionSettingsSchema.safeParse({
          ...validExecutionSettings(),
          ...unsafe,
        }).success,
      ).toBe(false);
    }
    expect(
      designSchemeRunExecutionSettingsSchema.safeParse({
        ...validExecutionSettings(),
        negativePrompt: '/Users/creator/private-negative.txt',
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunExecutionSettingsSchema.safeParse({
        ...validExecutionSettings(),
        promptReferenceSelections: [
          { promptId: '/tmp/prompt.txt', scope: 'full', expectedVersion: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunExecutionSettingsSchema.safeParse({
        ...validExecutionSettings(),
        referenceAssetIds: ['asset_ref_1', 'asset_ref_1'],
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunExecutionSettingsSchema.safeParse({
        ...validExecutionSettings(),
        size: '1536x1024',
        aspectRatio: '1:1',
      }).success,
    ).toBe(false);
  });

  it('cross-checks canonical run settings against the frozen plan', () => {
    const plan = validPlan();
    const run = {
      executionId: 'exec_1',
      schemeId: 'scheme_1',
      revisionId: 'rev_1',
      schemeStatus: 'draft' as const,
      schemeFidelity: 'faithful' as const,
      mode: 'trial' as const,
      brief: 'run this scheme',
      inputValues: { topic: 'night market' },
      executionSettings: validExecutionSettings(),
      plan,
    };
    expect(designSchemeRunInputSchema.safeParse(run).success).toBe(true);
    expect(
      designSchemeRunInputSchema.safeParse({
        ...run,
        executionSettings: { ...validExecutionSettings(), providerId: 'provider_2' },
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunInputSchema.safeParse({
        ...run,
        executionSettings: { ...validExecutionSettings(), outputCount: 2 },
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunInputSchema.safeParse({
        ...run,
        executionSettings: {
          ...validExecutionSettings(),
          size: '1024x1024',
          aspectRatio: '1:1',
        },
      }).success,
    ).toBe(false);
  });

  it('requires optimistic concurrency for cover selection', () => {
    expect(
      selectCoverInputSchema.parse({
        schemeId: 'scheme_1',
        assetId: 'asset_1',
        expectedVersion: 4,
      }),
    ).toMatchObject({ expectedVersion: 4 });
    expect(
      selectCoverInputSchema.safeParse({ schemeId: 'scheme_1', assetId: 'asset_1' }).success,
    ).toBe(false);
  });

  it('uses an explicit failed terminal run event', () => {
    const failedResult = {
      runId: 'run_1',
      schemeId: 'scheme_1',
      revisionId: 'rev_1',
      mode: 'trial' as const,
      status: 'failed' as const,
      compiledPrompt: null,
      outputs: [],
      steps: [],
      evaluation: null,
      repair: null,
      error: { code: 'PROVIDER_FAILED', message: 'Provider failed' },
      createdAt: now,
      completedAt: now,
    };
    expect(
      designSchemeEventSchema.safeParse({
        kind: 'completed',
        executionId: 'exec_1',
        result: failedResult,
      }).success,
    ).toBe(false);
    expect(
      designSchemeEventSchema.parse({
        kind: 'failed',
        executionId: 'exec_1',
        runId: 'run_1',
        error: { code: 'PROVIDER_FAILED', message: 'Provider failed' },
      }),
    ).toMatchObject({ kind: 'failed', runId: 'run_1' });
  });

  it('models import as a new draft and keeps lifecycle events structured', () => {
    const importedSummary = { ...summary, id: 'scheme_imported', status: 'draft' as const };
    const imported = importDesignSchemeResultSchema.parse({
      scheme: importedSummary,
      revisionId: 'rev_imported',
      status: 'draft',
    });
    expect(imported.status).toBe('draft');
    expect(
      importDesignSchemeResultSchema.safeParse({
        scheme: {
          ...importedSummary,
          status: 'formal',
          coverAssetId: 'asset_1',
          hasSuccessfulTrial: true,
        },
        revisionId: 'rev_imported',
        status: 'draft',
      }).success,
    ).toBe(false);
    expect(
      designSchemeEventSchema.parse({
        kind: 'failed',
        executionId: 'exec_1',
        error: { code: 'SOURCE_UNAVAILABLE', message: 'Source is unavailable' },
      }),
    ).toMatchObject({ error: { code: 'SOURCE_UNAVAILABLE', retryable: false } });
    expect(
      designSchemeEventSchema.safeParse({
        kind: 'failed',
        executionId: 'exec_1',
        code: 'SOURCE_UNAVAILABLE',
        message: 'bare legacy error',
      }).success,
    ).toBe(false);
  });
});
