import { OpenAPIHono } from '@hono/zod-openapi';
import { DESIGN_SCHEME_DOCUMENT_VERSION } from '@musefold/contracts';
import type { MusefoldDatabase } from '@musefold/db';
import { describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { designSchemeRoutes } from '../routes.js';
import { DesignSchemeService } from '../service.js';

const OWNER_ID = 'design-scheme-unavailable-owner';

/**
 * Expected blocker codes mirror the api-client operation mapping
 * (`unavailableCodeByOperation` in packages/api-client/src/design-schemes.ts);
 * apps/api must not import the api-client package, so the codes are restated here
 * to keep the server-reported code and the client-mapped code aligned.
 */
const API_CLIENT_CODE_BY_OPERATION = {
  searchMarket: 'DESIGN_SCHEME_CLOUD_MARKET_UNAVAILABLE',
  create: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
  modify: 'DESIGN_SCHEME_CLOUD_AGENT_MODIFY_UNAVAILABLE',
  cancel: 'DESIGN_SCHEME_CLOUD_RUN_CANCEL_UNAVAILABLE',
  confirmInstall: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
  checkUpdate: 'DESIGN_SCHEME_CLOUD_CHECK_UPDATE_UNAVAILABLE',
  prepareImportPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  importPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  exportPackage: 'DESIGN_SCHEME_CLOUD_EXPORT_STAGING_UNAVAILABLE',
  run: 'DESIGN_SCHEME_CLOUD_RUN_UNAVAILABLE',
} as const;

function testApp(service: DesignSchemeService, userId: string) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('sessionId', 'unavailable-test-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, 'unavailable-test-request'), error.status as 400);
    }
    throw error;
  });
  app.route('/', designSchemeRoutes(service));
  return app;
}

async function post(app: ReturnType<typeof testApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectCloudBlocker(
  response: Response,
  operation: keyof typeof API_CLIENT_CODE_BY_OPERATION,
  expectedCode: string = API_CLIENT_CODE_BY_OPERATION[operation],
) {
  expect(response.status).toBe(501);
  const body = (await response.json()) as Record<string, unknown>;
  await expect(body).toMatchObject({
    error: {
      code: 'INTERNAL_ERROR',
      retryable: false,
      details: {
        operation,
        designSchemeError: {
          code: expectedCode,
          retryable: false,
          recoveryAction: 'none',
        },
      },
    },
  });
}

async function expectInvalid(response: Response) {
  expect(response.status).toBe(400);
  const body = (await response.json()) as Record<string, unknown>;
  await expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
}

function runStep(
  id: string,
  kind: 'inspect-input' | 'compile-prompt' | 'generate-image' | 'evaluate-image',
  dependsOn: string[],
) {
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

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'execution_unavailable',
    schemeId: 'scheme_unavailable',
    revisionId: 'revision_unavailable',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    priorityMode: 'scheme_first',
    brief: 'Trial run for the fail-closed route contract',
    inputValues: { subject: 'editorial poster' },
    executionSettings: {
      providerId: 'provider_unavailable',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [
        { promptId: 'prompt_unavailable', scope: 'full', expectedVersion: 1 },
      ],
    },
    plan: {
      id: 'plan_unavailable',
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeRevisionId: 'revision_unavailable',
      sourceSnapshotIds: [],
      inputs: [{ slotId: 'subject', kind: 'text', valueIds: [], text: 'editorial poster' }],
      steps: [
        runStep('step_inspect', 'inspect-input', []),
        runStep('step_compile', 'compile-prompt', ['step_inspect']),
        runStep('step_generate', 'generate-image', ['step_compile']),
        runStep('step_evaluate', 'evaluate-image', ['step_generate']),
      ],
      provider: {
        providerId: 'provider_unavailable',
        providerName: 'Unavailable Provider',
        model: 'unavailable-model',
        providerVersion: null,
        capabilities: { text: true, vision: true, image: true, multiImage: true, editing: true },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'revision_unavailable',
        policyVersion: 'unavailable-test-v1',
        appliedAt: 1,
      },
      budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
      evaluation: { ratio: '1:1', requiredChecks: ['output-count', 'file-valid'] },
    },
    repair: null,
    ...overrides,
  };
}

describe('Design Scheme fail-closed future operations', () => {
  // The fail-closed paths never touch the database; a shell instance is enough for routing.
  const service = new DesignSchemeService({} as MusefoldDatabase);
  const app = testApp(service, OWNER_ID);

  it('market search validates the canonical query before failing closed', async () => {
    const blocked = await app.request('/design-schemes/market?query=editorial&limit=5');
    await expectCloudBlocker(blocked, 'searchMarket');

    for (const query of ['?limit=5', '?query=&limit=5', '?query=poster&limit=0']) {
      const invalid = await app.request(`/design-schemes/market${query}`);
      await expectInvalid(invalid);
    }
  });

  it('agent modify, cancel, and check-update validate canonical input before failing closed', async () => {
    await expectCloudBlocker(
      await post(app, '/design-schemes/modify', {
        executionId: 'execution_modify',
        schemeId: 'scheme_unavailable',
        baseRevisionId: 'revision_unavailable',
        instruction: 'Tighten the typographic scale.',
      }),
      'modify',
    );
    await expectInvalid(
      await post(app, '/design-schemes/modify', {
        executionId: 'execution_modify',
        schemeId: 'scheme_unavailable',
        baseRevisionId: 'revision_unavailable',
        instruction: '   ',
      }),
    );

    await expectCloudBlocker(
      await post(app, '/design-schemes/cancel', { executionId: 'execution_cancel' }),
      'cancel',
    );
    await expectInvalid(await post(app, '/design-schemes/cancel', {}));

    await expectCloudBlocker(
      await post(app, '/design-schemes/confirm-install', {
        executionId: 'execution_confirm',
        decision: 'install',
      }),
      'confirmInstall',
    );
    await expectInvalid(
      await post(app, '/design-schemes/confirm-install', {
        executionId: 'execution_confirm',
        decision: 'accept',
      }),
    );

    await expectCloudBlocker(
      await post(app, '/design-schemes/check-update', { schemeId: 'scheme_unavailable' }),
      'checkUpdate',
    );
    await expectInvalid(await post(app, '/design-schemes/check-update', {}));
  });

  it('run validates the canonical run input before failing closed', async () => {
    await expectCloudBlocker(await post(app, '/design-schemes/run', runInput()), 'run');
    await expectInvalid(
      await post(app, '/design-schemes/run', runInput({ schemeFidelity: 'unsupported' })),
    );
  });

  it('package staging routes validate canonical input before failing closed', async () => {
    await expectCloudBlocker(
      await post(app, '/design-schemes/prepare-import-package', {}),
      'prepareImportPackage',
    );
    await expectInvalid(
      await post(app, '/design-schemes/prepare-import-package', {
        acceptedFormatVersions: [1, 1],
      }),
    );

    await expectCloudBlocker(
      await post(app, '/design-schemes/import-package', {
        stagedPackageId: 'package_unavailable',
        packageHash: 'a'.repeat(64),
        formatVersion: 2,
      }),
      'importPackage',
    );
    await expectInvalid(await post(app, '/design-schemes/import-package', {}));

    await expectCloudBlocker(
      await post(app, '/design-schemes/export-package', {
        schemeId: 'scheme_unavailable',
        formatVersion: 2,
      }),
      'exportPackage',
    );
    await expectInvalid(
      await post(app, '/design-schemes/export-package', { schemeId: 'scheme_unavailable' }),
    );
  });

  it('reports the asset staging blocker when creation includes source assets', async () => {
    await expectCloudBlocker(
      await post(app, '/design-schemes', {
        executionId: 'execution_unavailable_asset_create',
        brief: 'Create a scheme with a staged reference image',
        sourceUris: [],
        sourceBindings: [],
        sourcePackages: [],
        sourceSnapshots: [],
        sourceAssetIds: ['asset_unavailable'],
        sourceAssets: [],
        document: {
          schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
          revisionId: 'revision_asset_create',
          schemeId: 'scheme_asset_create',
          name: 'Asset scheme',
          summary: 'Asset scheme',
          fidelity: 'faithful',
          sources: [],
          sourceSnapshotIds: [],
          inputs: [],
          parameters: [],
          constraints: [],
          promptProgram: [
            {
              id: 'prompt_asset_create',
              order: 0,
              kind: 'system-rule',
              template: 'asset',
              variables: [],
              sourceIds: [],
            },
          ],
          assetIds: [],
          compilation: {
            compiledAt: 1,
            model: { model: 'test' },
            adopted: [],
            omitted: [],
            warnings: [],
            trace: [],
          },
          parentRevisionId: null,
          createdBy: 'user',
        },
      }),
      'create',
      'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
    );
  });

  it('reports the api-client create code when cloud agent compilation is requested', async () => {
    await expectCloudBlocker(
      await post(app, '/design-schemes', {
        executionId: 'execution_unavailable_create',
        brief: 'Let the cloud agent compile a scheme',
        sourceUris: [],
        sourceBindings: [],
        sourcePackages: [],
        sourceSnapshots: [],
        sourceAssetIds: [],
        sourceAssets: [],
      }),
      'create',
    );
  });

  it('fails closed on renderer-selected history sources instead of dropping them', async () => {
    // historySources 是渲染层只交稳定身份(runId/assetId/includePrompt)的入参;
    // 云端尚无「按成功生成账本 owner 校验解析」管线,必须显式拒绝而非静默忽略。
    const response = await post(app, '/design-schemes', {
      executionId: 'execution_unavailable_history',
      brief: 'Create from selected history outputs',
      sourceUris: [],
      sourceBindings: [],
      sourcePackages: [],
      sourceSnapshots: [],
      sourceAssetIds: [],
      sourceAssets: [],
      historySources: [{ runId: 'run_1', assetId: 'asset_1', includePrompt: true }],
      document: {
        schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
        revisionId: 'revision_history_create',
        schemeId: 'scheme_history_create',
        name: 'History scheme',
        summary: 'History scheme',
        fidelity: 'faithful',
        sources: [],
        sourceSnapshotIds: [],
        inputs: [],
        parameters: [],
        constraints: [],
        promptProgram: [
          {
            id: 'prompt_history_create',
            order: 0,
            kind: 'system-rule',
            template: 'history',
            variables: [],
            sourceIds: [],
          },
        ],
        assetIds: [],
        compilation: {
          compiledAt: 1,
          model: { model: 'test' },
          adopted: [],
          omitted: [],
          warnings: [],
          trace: [],
        },
        parentRevisionId: null,
        createdBy: 'user',
      },
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as Record<string, any>;
    expect(body.error.details.designSchemeError.code).toBe(
      'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
    );
    expect(body.error.details.operation).toBe('create');
  });
});
