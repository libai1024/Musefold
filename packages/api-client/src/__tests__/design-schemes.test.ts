import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  createDesignSchemeInputSchema,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudDesignSchemeUnavailableError,
  createCloudDesignSchemesGateway,
} from '../design-schemes';
import { ApiHttp } from '../http';

const NOW = '2026-09-01T00:00:00.000Z';

function document(
  overrides: Partial<DesignSchemeRevisionDocument> = {},
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'revision_1',
    schemeId: 'scheme_1',
    name: 'Editorial Poster',
    summary: 'A restrained editorial poster system.',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'prompt_1',
        order: 0,
        kind: 'input-template',
        template: '{{subject}}',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: NOW,
      model: { model: 'test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId: null,
    createdBy: 'user',
    createdAt: NOW,
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scheme_1',
    name: 'Editorial Poster',
    summary: 'A restrained editorial poster system.',
    status: 'draft',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: 'revision_1',
    workingDraftRevisionId: null,
    coverAssetId: null,
    fidelity: 'faithful',
    version: 1,
    inputLabels: ['Subject · 必需'],
    hasSuccessfulTrial: false,
    lastRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchQueue(responses: Response[]) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    const response = responses.shift();
    if (!response) throw new Error('Missing response');
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const createInput = createDesignSchemeInputSchema.parse({
  executionId: 'execution_1',
  brief: 'Build an editorial poster system.',
  sourceUris: [],
  sourceBindings: [],
  sourcePackages: [],
  sourceSnapshots: [],
  sourceAssetIds: [],
  sourceAssets: [],
  document: document(),
});

beforeEach(() => vi.restoreAllMocks());

describe('cloud Design Schemes HTTP adapter', () => {
  it('maps supported list/get/create/update/select/formalize/promote/rename/remove operations', async () => {
    const nextDocument = document({
      revisionId: 'revision_2',
      parentRevisionId: 'revision_1',
      name: 'Editorial Poster v2',
    });
    const responses = [
      jsonResponse({ items: [summary()], nextCursor: 'next' }),
      jsonResponse({ summary: summary(), document: document(), assets: [], sourceSnapshots: [] }),
      jsonResponse(
        { scheme: summary(), document: document(), revisionId: 'revision_1', trace: [] },
        201,
      ),
      jsonResponse({
        scheme: summary({ currentRevisionId: 'revision_2', version: 2 }),
        document: nextDocument,
      }),
      jsonResponse({
        scheme: summary({ coverAssetId: 'asset_1', version: 2 }),
        selectedAssetId: 'asset_1',
      }),
      jsonResponse({
        scheme: summary({
          status: 'formal',
          coverAssetId: 'asset_1',
          hasSuccessfulTrial: true,
          version: 3,
        }),
        revisionId: 'revision_1',
        formalized: true,
      }),
      jsonResponse({
        scheme: summary({
          status: 'formal',
          currentRevisionId: 'revision_2',
          coverAssetId: 'asset_1',
          hasSuccessfulTrial: true,
          version: 4,
        }),
        promotedRevisionId: 'revision_2',
        promoted: true,
      }),
      jsonResponse({ scheme: summary({ name: 'Renamed', version: 2 }) }),
      jsonResponse({ schemeId: 'scheme_1', removed: true }),
    ];
    const transport = fetchQueue(responses);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    await gateway.list({ query: 'poster', status: 'draft', limit: 10 });
    await gateway.get('scheme_1');
    await gateway.create(createInput);
    await gateway.update({
      schemeId: 'scheme_1',
      baseRevisionId: 'revision_1',
      document: nextDocument,
      expectedVersion: 1,
    });
    await gateway.selectCover({ schemeId: 'scheme_1', assetId: 'asset_1', expectedVersion: 1 });
    await gateway.formalize({
      schemeId: 'scheme_1',
      revisionId: 'revision_1',
      coverAssetId: 'asset_1',
      expectedVersion: 2,
      confirmed: true,
    });
    await gateway.promoteWorkingDraft({
      schemeId: 'scheme_1',
      workingDraftRevisionId: 'revision_2',
      expectedVersion: 3,
      confirmed: true,
    });
    await gateway.rename({ schemeId: 'scheme_1', name: 'Renamed', expectedVersion: 1 });
    await gateway.remove({ schemeId: 'scheme_1', expectedVersion: 2 });

    expect(transport.calls.map((call) => `${call.init?.method} ${call.url.pathname}`)).toEqual([
      'GET /api/v1/design-schemes',
      'GET /api/v1/design-schemes/scheme_1',
      'POST /api/v1/design-schemes',
      'POST /api/v1/design-schemes/update',
      'POST /api/v1/design-schemes/select-cover',
      'POST /api/v1/design-schemes/formalize',
      'POST /api/v1/design-schemes/promote-working-draft',
      'POST /api/v1/design-schemes/rename',
      'POST /api/v1/design-schemes/remove',
    ]);
    expect(transport.calls[0]?.url.searchParams.get('query')).toBe('poster');
    expect(transport.calls[0]?.url.searchParams.get('status')).toBe('draft');
    expect(transport.calls[1]?.url.search).toBe('');
    expect(JSON.parse(String(transport.calls[2]?.init?.body))).toEqual(createInput);
  });

  it('encodes an exact working-draft selector in the detail query', async () => {
    const workingDocument = document({
      revisionId: 'revision_2',
      parentRevisionId: 'revision_1',
    });
    const transport = fetchQueue([
      jsonResponse({
        summary: summary({ workingDraftRevisionId: 'revision_2' }),
        document: workingDocument,
        assets: [],
        sourceSnapshots: [],
      }),
    ]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    await gateway.get('scheme_1', { kind: 'working-draft', revisionId: 'revision_2' });

    expect(transport.calls[0]?.url.searchParams.get('revisionKind')).toBe('working-draft');
    expect(transport.calls[0]?.url.searchParams.get('revisionId')).toBe('revision_2');
  });

  it('maps prepare-import 501 responses to the staging operation error', async () => {
    const errorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Cloud package staging is unavailable.',
        requestId: 'request_prepare_1',
        retryable: false,
        details: {},
      },
    };
    const transport = fetchQueue([jsonResponse(errorBody, 501)]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );
    if (!gateway.prepareImportPackage) throw new Error('prepare import seam is missing');

    const error = await gateway.prepareImportPackage({}).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: 'CloudDesignSchemeUnavailableError',
      operation: 'prepareImportPackage',
      code: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
      status: 501,
      retryable: false,
    });
    expect(JSON.parse(String(transport.calls[0]?.init?.body))).toEqual({});
  });

  it('maps create 501 responses to the standardized create operation error', async () => {
    const errorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Cloud Agent compilation is not available.',
        requestId: 'request_create_1',
        retryable: false,
        details: {
          operation: 'create',
          designSchemeError: { code: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE' },
        },
      },
    };
    const transport = fetchQueue([jsonResponse(errorBody, 501)]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    const error = await gateway.create(createInput).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudDesignSchemeUnavailableError);
    expect(error).toMatchObject({
      operation: 'create',
      code: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
      status: 501,
      retryable: false,
    });
    expect(JSON.parse(String(transport.calls[0]?.init?.body))).toEqual(createInput);
  });

  it('preserves a server-provided asset staging blocker from the error details', async () => {
    const errorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Cloud asset staging is not available.',
        requestId: 'request_create_asset_1',
        retryable: false,
        details: {
          operation: 'create',
          designSchemeError: {
            code: 'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
            retryable: false,
            recoveryAction: 'none',
          },
        },
      },
    };
    const transport = fetchQueue([jsonResponse(errorBody, 501)]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    const error = await gateway.create(createInput).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      operation: 'create',
      code: 'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
      status: 501,
      retryable: false,
    });
  });
  it('maps all runtime and staging 501 responses to stable operation errors', async () => {
    const errorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Cloud operation unavailable.',
        requestId: 'request_1',
        retryable: false,
        details: {},
      },
    };
    const transport = fetchQueue([jsonResponse(errorBody, 501)]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    const error = await gateway
      .searchMarket({ query: 'poster', limit: 20 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CloudDesignSchemeUnavailableError);
    expect(error).toMatchObject({
      operation: 'searchMarket',
      code: 'DESIGN_SCHEME_CLOUD_MARKET_UNAVAILABLE',
      status: 501,
      retryable: false,
    });
    expect(() => gateway.subscribeEvents(vi.fn())).toThrowError(
      expect.objectContaining({
        operation: 'subscribeEvents',
        code: 'DESIGN_SCHEME_CLOUD_EVENTS_UNAVAILABLE',
      }),
    );
  });

  it('rejects malformed successful list and detail responses', async () => {
    const transport = fetchQueue([
      jsonResponse({ items: [{ ...summary(), unexpected: true }], nextCursor: null }),
      jsonResponse({
        summary: summary(),
        document: { ...document(), localPath: '/tmp/x' },
        assets: [],
      }),
    ]);
    const gateway = createCloudDesignSchemesGateway(
      new ApiHttp({ baseUrl: 'https://api.test', fetch: transport.fetch }),
    );

    await expect(gateway.list({ limit: 20 })).rejects.toMatchObject({ name: 'ZodError' });
    await expect(gateway.get('scheme_1')).rejects.toMatchObject({ name: 'ZodError' });
  });
});
