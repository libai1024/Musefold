import {
  DESIGN_SCHEME_METHOD_NAMES,
  V25_METHOD_NAMES,
  V25_METHODS_BY_DOMAIN,
} from '@musefold/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  app: { getPath: vi.fn(() => '/tmp/musefold-gateway-bridge-test') },
  ipcMain: { handle: vi.fn() },
  account: vi.fn(),
  providers: vi.fn(),
  agentConnections: vi.fn(),
  prompts: vi.fn(),
  sync: vi.fn(),
  workbench: vi.fn(),
  doubao: vi.fn(),
  accountBeforeChange: vi.fn(),
  accountChanged: vi.fn(),
  accountChangeCancelled: vi.fn(),
}));

vi.mock('electron', () => ({ app: mocks.app, ipcMain: mocks.ipcMain }));
vi.mock('@musefold/core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined) })),
  })),
}));
vi.mock('../../../security/keychain', () => ({
  saveApiKey: vi.fn(),
  loadApiKey: vi.fn(() => null),
  deleteApiKey: vi.fn(),
  hasApiKey: vi.fn(() => false),
  getKeySuffix: vi.fn(() => null),
}));
vi.mock('../account-domain', () => ({
  buildAccountDomainMethods: mocks.account,
  onBeforeAccountChange: mocks.accountBeforeChange,
  onAccountChanged: mocks.accountChanged,
  onAccountChangeCancelled: mocks.accountChangeCancelled,
}));
vi.mock('../providers-domain', () => ({ buildAiProvidersDomainMethods: mocks.providers }));
vi.mock('../agent-connections-domain', () => ({
  buildAgentConnectionsDomainMethods: mocks.agentConnections,
}));
vi.mock('../prompts-domain', () => ({ buildPromptsDomainMethods: mocks.prompts }));
vi.mock('../sync-domain', () => ({ buildSyncDomainMethods: mocks.sync }));
vi.mock('../workbench-domain', () => ({ buildWorkbenchDomainMethods: mocks.workbench }));
vi.mock('../doubao-domain', () => ({ buildDoubaoDomainMethods: mocks.doubao }));
// 真实 doubao-domain 经 importActual 参与双向比对;其冻结面依赖在此 mock,
// 避免 browser-service 的 electron 会话链进入单测进程。
vi.mock('../../../doubao-web/browser-service', () => ({
  getDoubaoWebAccountStatus: vi.fn(),
  startDoubaoWebLogin: vi.fn(),
  refreshDoubaoWebLogin: vi.fn(),
  logoutDoubaoWeb: vi.fn(),
}));

import { buildMethods, registerV25GatewayBridge } from '../gateway-bridge';
import { BridgeError, type MethodDef } from '../envelope';
import { closeApplicationAdmission, openApplicationAdmission } from '../../lifecycle-admission';

const ALL_METHODS = [...V25_METHOD_NAMES].sort();

const DESIGN_SCHEME_METHODS = [...DESIGN_SCHEME_METHOD_NAMES].sort();

const DESIGN_SCHEME_INPUTS: Record<string, unknown> = {
  'designSchemes.list': {},
  'designSchemes.get': { id: 'scheme_1' },
  'designSchemes.searchMarket': { query: 'editorial' },
  'designSchemes.create': {
    executionId: 'exec_1',
    brief: 'Create a scheme',
    sourceUris: [],
    sourceBindings: [],
    sourceAssetIds: [],
  },
  'designSchemes.update': {
    schemeId: 'scheme_1',
    baseRevisionId: 'rev_1',
    document: {
      schemaVersion: 1,
      revisionId: 'rev_1',
      schemeId: 'scheme_1',
      name: 'Scheme',
      summary: 'Summary',
      fidelity: 'faithful',
      sources: [],
      inputs: [],
      parameters: [],
      constraints: [],
      promptProgram: [
        {
          id: 'prompt_1',
          order: 0,
          kind: 'system-rule',
          template: 'Keep it clear.',
          variables: [],
          sourceIds: [],
        },
      ],
      compilation: {
        compiledAt: '2026-08-29T00:00:00.000Z',
        model: { model: 'model-1' },
        adopted: [],
        omitted: [],
        warnings: [],
        trace: [],
      },
    },
    expectedVersion: 1,
  },
  'designSchemes.modify': {
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    baseRevisionId: 'rev_1',
    instruction: 'Make the layout quieter',
  },
  'designSchemes.cancel': { executionId: 'exec_1' },
  'designSchemes.confirmInstall': { executionId: 'exec_1', decision: 'install' },
  'designSchemes.selectCover': { schemeId: 'scheme_1', assetId: 'asset_1' },
  'designSchemes.formalize': {
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    coverAssetId: 'asset_1',
    expectedVersion: 1,
    confirmed: true,
  },
  'designSchemes.promoteWorkingDraft': {
    schemeId: 'scheme_1',
    workingDraftRevisionId: 'rev_2',
    expectedVersion: 2,
    confirmed: true,
  },
  'designSchemes.rename': { schemeId: 'scheme_1', name: 'Renamed', expectedVersion: 1 },
  'designSchemes.remove': { schemeId: 'scheme_1', expectedVersion: 1 },
  'designSchemes.checkUpdate': { schemeId: 'scheme_1' },
  'designSchemes.importPackage': {
    packageId: 'package_1',
    packageHash: `sha256:${'a'.repeat(64)}`,
    formatVersion: 1,
  },
  'designSchemes.exportPackage': {
    schemeId: 'scheme_1',
    formatVersion: 1,
  },
  'designSchemes.prepareRun': {
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
  'designSchemes.run': {
    executionId: 'exec_1',
    schemeId: 'scheme_1',
    revisionId: 'rev_1',
    schemeStatus: 'draft',
    schemeFidelity: 'faithful',
    mode: 'trial',
    brief: 'Run the scheme',
    plan: {
      id: 'plan_1',
      schemaVersion: 1,
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
          timeoutMs: 1000,
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
        appliedAt: '2026-08-29T00:00:00.000Z',
      },
      budget: { maxSteps: 1, maxOutputs: 1, maxRepairRuns: 0 },
      evaluation: { ratio: null, requiredChecks: [] },
    },
  },
};

type TestMethod = MethodDef & { handle: ReturnType<typeof vi.fn> };

function makeMethods(prefix: string, names: string[]): Record<string, TestMethod> {
  return Object.fromEntries(
    names.map((name) => [
      `${prefix}.${name}`,
      { input: z.object({ value: z.string() }), handle: vi.fn(async (input) => input) },
    ]),
  ) as Record<string, TestMethod>;
}

let accountMethods: Record<string, TestMethod>;

function configureDomainMocksCorrectly(): void {
  accountMethods = makeMethods('account', ['getStatus', 'login', 'register', 'logout', 'redeem']);
  mocks.account.mockReturnValue(accountMethods);
  mocks.providers.mockReturnValue(
    makeMethods('aiProviders', ['list', 'create', 'update', 'remove', 'setActive', 'test']),
  );
  mocks.agentConnections.mockReturnValue(
    makeMethods('agentConnections', ['list', 'create', 'update', 'remove', 'setActive', 'test']),
  );
  mocks.prompts.mockReturnValue(
    makeMethods('prompts', [
      'list',
      'get',
      'create',
      'update',
      'remove',
      'restore',
      'purge',
      'use',
      'listFolders',
      'createFolder',
      'updateFolder',
      'removeFolder',
      'listTags',
      'createTag',
      'updateTag',
      'removeTag',
    ]),
  );
  mocks.sync.mockReturnValue(
    makeMethods('sync', [
      'getStatus',
      'setConsent',
      'listConflicts',
      'resolveConflict',
      'setEnabled',
      'syncNow',
    ]),
  );
  mocks.doubao.mockReturnValue(
    makeMethods('doubao', ['getStatus', 'startLogin', 'refreshLogin', 'logout']),
  );
  const workbench = makeMethods('workbench', [
    'listSessions',
    'createSession',
    'getSession',
    'updateSession',
    'removeSession',
    'restoreSession',
  ]);
  const generation = makeMethods('generation', [
    'create',
    'list',
    'get',
    'cancel',
    'retry',
    'remove',
    'restore',
    'purge',
    'listProviders',
    'uploadReferenceImage',
    'saveAsset',
  ]);
  mocks.workbench.mockReturnValue({ ...workbench, ...generation });
}

function registeredHandler(): (
  _event: { sender: { id: number } },
  method: unknown,
  payload: unknown,
) => Promise<unknown> {
  return mocks.ipcMain.handle.mock.calls[0]?.[1] as (
    _event: { sender: { id: number } },
    method: unknown,
    payload: unknown,
  ) => Promise<unknown>;
}

function event(senderId = 73): { sender: { id: number } } {
  return { sender: { id: senderId } };
}

describe('v25 gateway bridge transport contract', () => {
  beforeEach(() => {
    openApplicationAdmission();
    vi.clearAllMocks();
    configureDomainMocksCorrectly();
  });

  it('buildMethods registers every public MusefoldGateway method with exact domain sets', () => {
    const methods = buildMethods();
    expect(Object.keys(methods).sort()).toEqual(ALL_METHODS);
    for (const [domain, expectedMethods] of Object.entries(V25_METHODS_BY_DOMAIN)) {
      const actualMethods = Object.keys(methods)
        .filter((method) => method.startsWith(`${domain}.`))
        .sort();
      expect(actualMethods, domain).toEqual([...expectedMethods].sort());
    }
    expect(mocks.account).toHaveBeenCalledOnce();
    expect(mocks.providers).toHaveBeenCalledOnce();
    expect(mocks.agentConnections).toHaveBeenCalledOnce();
    expect(mocks.prompts).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.workbench).toHaveBeenCalledOnce();
    expect(mocks.doubao).toHaveBeenCalledOnce();
  });

  it('matches real domain builders in both directions', async () => {
    const [account, providers, agentConnections, prompts, sync, workbench, doubao] =
      await Promise.all([
        vi.importActual<typeof import('../account-domain')>('../account-domain'),
        vi.importActual<typeof import('../providers-domain')>('../providers-domain'),
        vi.importActual<typeof import('../agent-connections-domain')>(
          '../agent-connections-domain',
        ),
        vi.importActual<typeof import('../prompts-domain')>('../prompts-domain'),
        vi.importActual<typeof import('../sync-domain')>('../sync-domain'),
        vi.importActual<typeof import('../workbench-domain')>('../workbench-domain'),
        vi.importActual<typeof import('../doubao-domain')>('../doubao-domain'),
      ]);
    const realMethods = {
      account: account.buildAccountDomainMethods(),
      aiProviders: providers.buildAiProvidersDomainMethods(),
      agentConnections: agentConnections.buildAgentConnectionsDomainMethods(),
      prompts: prompts.buildPromptsDomainMethods(),
      sync: sync.buildSyncDomainMethods(),
      workbench: workbench.buildWorkbenchDomainMethods(),
      doubao: doubao.buildDoubaoDomainMethods(),
    };

    for (const [domain, methods] of Object.entries(realMethods)) {
      const expected = [
        ...V25_METHODS_BY_DOMAIN[domain as keyof typeof V25_METHODS_BY_DOMAIN],
      ].sort();
      const actual = Object.keys(methods)
        .filter((method) => method.startsWith(`${domain}.`))
        .sort();
      expect(actual, `${domain} real builder keys`).toEqual(expected);
      for (const name of expected) expect(Object.hasOwn(methods, name), name).toBe(true);
      for (const name of actual) expect(expected, name).toContain(name);
    }
  });

  it('locks all 18 design scheme names to the canonical set and validates strictly', async () => {
    const methods = buildMethods();
    expect(Object.keys(DESIGN_SCHEME_INPUTS).sort()).toEqual(DESIGN_SCHEME_METHODS);
    expect(
      Object.keys(methods)
        .filter((method) => method.startsWith('designSchemes.'))
        .sort(),
    ).toEqual(DESIGN_SCHEME_METHODS);
    expect(Object.keys(methods).some((method) => method.startsWith('designScheme:'))).toBe(false);
    expect(Object.hasOwn(methods, 'designSchemes.prepareImportPackage')).toBe(false);

    registerV25GatewayBridge();
    const handler = registeredHandler();
    for (const method of DESIGN_SCHEME_METHODS) {
      const input = DESIGN_SCHEME_INPUTS[method];
      await expect(
        handler(event(), method, { ...(input as Record<string, unknown>), unexpected: true }),
      ).resolves.toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
  });

  it('registers the single musefold:invoke handler and rejects invalid input', async () => {
    registerV25GatewayBridge();
    expect(mocks.ipcMain.handle).toHaveBeenCalledOnce();
    expect(mocks.ipcMain.handle.mock.calls[0]?.[0]).toBe('musefold:invoke');

    const handler = registeredHandler();
    await expect(handler(event(), 'account.login', { value: 123 })).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(accountMethods['account.login']?.handle).not.toHaveBeenCalled();
  });

  it('passes the invoking sender id only through the method context', async () => {
    registerV25GatewayBridge();
    const handler = registeredHandler();

    await expect(handler(event(91), 'account.login', { value: 'ok' })).resolves.toEqual({
      ok: true,
      data: { value: 'ok' },
    });
    expect(accountMethods['account.login']?.handle).toHaveBeenCalledWith(
      { value: 'ok' },
      { senderId: 91 },
    );
  });

  it('redacts every unexpected exception to the generic renderer-safe message', async () => {
    const methods = buildMethods();
    const unexpectedErrors = [
      ['/Users/creator/.config/musefold/provider-secret.db', 'designSchemes.list', {}],
      ["SQLITE_ERROR: near 'provider_keys'", 'account.login', { value: 'ok' }],
      [
        'provider API key leaked from https://provider.example/v1',
        'aiProviders.list',
        { value: 'ok' },
      ],
    ] as const;
    registerV25GatewayBridge(methods);
    const handler = registeredHandler();

    for (const [message, method, input] of unexpectedErrors) {
      const methodDef = methods[method];
      if (!methodDef) throw new Error(`Missing test method: ${method}`);
      methodDef.handle = vi.fn(async () => {
        throw new Error(message);
      });
      const result = await handler(event(), method, input);
      expect(result).toEqual({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: '主进程处理失败',
      });
      expect(JSON.stringify(result)).not.toContain(message);
    }
  });

  it('returns METHOD_NOT_FOUND for an unknown, non-string, or inherited method name', async () => {
    registerV25GatewayBridge();
    const handler = registeredHandler();

    for (const method of ['missing.method', 'constructor', 'toString', '__proto__']) {
      await expect(handler(event(), method, undefined)).resolves.toEqual({
        ok: false,
        code: 'METHOD_NOT_FOUND',
        message: `未知方法:${method}`,
      });
    }
    await expect(handler(event(), 42, undefined)).resolves.toEqual({
      ok: false,
      code: 'METHOD_NOT_FOUND',
      message: '未知方法:42',
    });
  });

  it('rejects new invocations after application admission closes', async () => {
    registerV25GatewayBridge();
    const handler = registeredHandler();
    closeApplicationAdmission();

    await expect(handler(event(), 'account.login', { value: 'blocked' })).resolves.toEqual({
      ok: false,
      code: 'APP_SHUTTING_DOWN',
      message: 'Musefold 正在退出，请稍后重试',
    });
    expect(accountMethods['account.login']?.handle).not.toHaveBeenCalled();
  });

  it('wraps BridgeError and unknown exceptions in error envelopes', async () => {
    accountMethods['account.login']?.handle.mockRejectedValueOnce(
      new BridgeError('AUTH_REQUIRED', '请先登录'),
    );
    registerV25GatewayBridge();
    const handler = registeredHandler();

    await expect(handler(event(), 'account.login', { value: 'ok' })).resolves.toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '请先登录',
    });

    accountMethods['account.login']?.handle.mockRejectedValueOnce(new Error('database exploded'));
    await expect(handler(event(), 'account.login', { value: 'ok' })).resolves.toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '主进程处理失败',
    });
  });
});
