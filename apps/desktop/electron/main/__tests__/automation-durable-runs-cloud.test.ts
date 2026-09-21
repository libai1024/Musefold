// RS-MAP wiring boundary (case 5 / case 6):musefold-cloud 图像绑定的路由层语义。
// 5) 无已验证账号会话(未登录/受限/恢复中/存储不可读)→ 不进入托管运行,legacy 注册
//    即有界拒绝:PAYMENT_IDENTITY_UNBOUND、0 发送、终态行 + 1 条审计、同键重放同结论。
// 6) 已验证会话 + 云图像 + 托管(hosted)文本 → 交给托管运行的 textBinding 保持 unbound,
//    由 registerRun 在注册边界终止(ledger 层另有独立断言);BYOK 文本按 external 随行。
// 证据:tests/v25/.results/rsmap/rs-glm-result.json。

import { createServer, type Server } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { generate } from '@musefold/core/services/generation';
import { createSchemeService } from '@musefold/core/services/schemes';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import { managedRunRecordSchema } from '@musefold/desktop-contracts/managed-generation';
import type { AutomationRouteContext, AutomationRouteHandler } from '@musefold/automation-server';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  schemes: null as Database.Database | null,
  profile: null as AiConnectionProfile | null,
  directory: '',
  logs: [] as unknown[][],
  accountSession: null as {
    token: string;
    apiIssuer: string;
    principalId: string;
    authEpoch: string;
    restricted: boolean;
    pendingRecovery: boolean;
  } | null,
  startedSpecs: [] as Array<Record<string, unknown>>,
  managedRecord: null as Record<string, unknown> | null,
  terminalReplay: vi.fn(),
}));
vi.mock('@musefold/core/db/index', () => ({
  getDb: () => state.db,
  captureDatabaseAccess: () => () => {},
}));
vi.mock('@musefold/core/db/design-scheme', () => ({ getDesignSchemeDb: () => state.schemes }));
vi.mock('../../security/keychain', () => ({
  // 账号云连接没有本地密钥快照:legacy 绑定读取为 unbound 付款身份。
  loadApiKeySnapshot: () => null,
}));
vi.mock('../../ai/connection-store', () => ({
  getAiConnectionStore: () => ({
    list: () => (state.profile ? [state.profile] : []),
    get: (id: string) => (state.profile?.id === id ? state.profile : null),
    loadKeySnapshot: () => ({ key: 'fixture-text-canary', epoch: 'fixture-text-epoch' }),
  }),
}));
vi.mock('../../settings/pricing', () => ({ estimateProviderCost: () => 0.5 }));
vi.mock('../../settings/automation', () => ({
  getAutomationSpendRepository: () => {
    const repository = new AutomationSpendRepository(required(state.db));
    repository.initializeBudget(
      { monthlyLimitPoints: 20, usedPoints: 0, month: new Date().toISOString().slice(0, 7) },
      Date.now(),
    );
    return repository;
  },
}));
vi.mock('../core-instance', () => ({
  getMusefoldCore: () => ({
    generation: { generate, cancel: () => true },
    schemes: createSchemeService(() => required(state.schemes)),
  }),
}));
vi.mock('../pet', () => ({ trackPetGeneration: (run: () => unknown) => run() }));
vi.mock('../../system/paths', () => ({
  getPaths: () => ({ userData: state.directory, pictures: join(state.directory, 'pictures') }),
}));
vi.mock('../../system/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => state.logs.push(args),
    warn: (...args: unknown[]) => state.logs.push(args),
    error: (...args: unknown[]) => state.logs.push(args),
    debug: () => {},
  }),
}));
vi.mock('../skill-import/github-reader', () => ({
  readPublicGithubAgentSkillRuntimeSource: async () => ({
    ok: true,
    data: {
      scan: { name: 'Fixture skill', description: 'Fixture visual rules', files: [] },
      resolvedRef: 'fixture-ref',
      commitHash: 'f'.repeat(40),
      runtimeFiles: [
        {
          relativePath: 'SKILL.md',
          contentHash: 'fixture-declared-hash',
          bytes: Buffer.from('Use warm colors and clear shapes.'),
        },
      ],
    },
  }),
}));
// 已验证账号会话探针:默认无会话(未登录),按测试切换。
vi.mock('../ipc-v25/account-session-store', () => ({
  readSessionCredentials: async () => state.accountSession,
}));
// 托管运行时在此层只验证路由契约;真实执行语义由 managed-cloud-runtime.test.ts 覆盖。
vi.mock('../../system/managed-run-runtime', async () => {
  const { AutomationSpendRepository } = await import(
    '@musefold/core/db/repositories/automation-spend'
  );
  return {
    managedRunByCallerKey: (callerKey: string | undefined) =>
      state.managedRecord && state.managedRecord.callerKey === callerKey
        ? state.managedRecord
        : null,
    scheduleManagedRunReconciliation: () => {},
    readTerminalManagedRunReplay: state.terminalReplay,
    cancelManagedDurableRun: async () => {},
    startManagedDurableRun: async (spec: {
      runKind: 'run_scheme' | 'run_github_skill';
      executionId: string;
      originalJobIds: string[];
      callerKey?: string;
    }) => {
      state.startedSpecs.push(spec as unknown as Record<string, unknown>);
      // payload() 读取真实账本行;注册一个 0 发送的占位行使路由返回值可序列化。
      const repository = new AutomationSpendRepository(required(state.db));
      const { request } = repository.register({
        idempotencyKey: spec.callerKey ?? null,
        action: spec.runKind,
        caller: 'fixture',
        input: {},
        frozenInput: {},
        bindings: [
          {
            providerId: 'fixture-cloud',
            providerType: 'musefold-cloud',
            model: 'musefold-image-pro',
            baseUrl: 'http://issuer.example/',
            credentialEpoch: null,
            payerKind: 'unbound',
            ownerId: null,
            issuer: null,
            policy: 'managed',
          },
        ],
        promptText: null,
        executionId: spec.executionId,
        maxImageCalls: spec.originalJobIds.length,
        maxTextCalls: 0,
        estimatedPoints: null,
        now: Date.now(),
      });
      return { replayed: false, request };
    },
  };
});

import { wrapDurableExternalRunRoutes } from '../automation-durable-runs';
import { createDesktopGenerationPersistence } from '../automation-spend';

let server: Server;
let baseUrl: string;
let sends: Array<{ path: string; body: string }>;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGgAAAABJRU5ErkJggg==',
  'base64',
);
const document: DesignSchemeRevisionDocument = {
  schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
  revisionId: 'dsrv_fixture',
  schemeId: 'dsch_fixture',
  name: 'Fixture scheme',
  summary: 'Local fixture',
  fidelity: 'adapted',
  sources: [{ id: 'src_fixture', kind: 'user-brief', role: 'context' }],
  inputs: [{ id: 'topic', label: 'Topic', kind: 'text', required: true }],
  parameters: [],
  constraints: [],
  promptProgram: [
    {
      id: 'pm_fixture',
      order: 0,
      kind: 'input-template',
      template: 'Draw {{topic}} with warm colors',
      variables: ['topic'],
      sourceIds: ['src_fixture'],
    },
  ],
  compilation: {
    compiledAt: 1,
    model: { model: 'fixture', connectionName: 'Fixture' },
    adopted: [],
    omitted: [],
    warnings: [],
    trace: [],
  },
};

beforeEach(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'musefold-durable-cloud-'));
  state.db = new Database(join(state.directory, 'local.db'));
  state.db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(state.db);
  state.schemes = new Database(':memory:');
  runDesignSchemeDbMigrations(state.schemes);
  new DesignSchemeRepository(state.schemes).insertSchemeDraft({
    document,
    sourceLabel: 'Fixture',
    sourcePresentation: 'musefold-created',
    createdBy: 'agent',
    bindings: [],
  });
  state.schemes.prepare("UPDATE design_schemes SET status = 'formal'").run();
  state.logs = [];
  state.accountSession = null;
  state.startedSpecs = [];
  state.managedRecord = null;
  state.terminalReplay.mockReset();
  sends = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      sends.push({ path: request.url ?? '', body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  state.db
    .prepare(
      `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,managed_by,created_at,updated_at)
       VALUES ('fixture-cloud','账号云图像','musefold-cloud','http://issuer.example/','musefold-image-pro',0,1,'account',1,1)`,
    )
    .run();
  state.profile = {
    id: 'fixture-text',
    name: 'Fixture text',
    routeKind: 'gateway',
    protocol: 'openai-compatible',
    presetId: 'custom',
    baseUrl,
    model: 'fixture-text',
    hasKey: true,
    keySuffix: 'nary',
    isActive: true,
    managedBy: null,
    createdAt: 1,
    updatedAt: 1,
    capabilities: {
      modelDiscovery: 'manual',
      supportedStructuredOutputModes: [],
      preferredStructuredOutputMode: 'json-text',
      cancellation: true,
      streaming: false,
      lastValidatedAt: null,
    },
  };
  configureCoreRuntime({
    managedFilesystem: () =>
      loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
    getPaths: () => ({
      userData: state.directory,
      db: join(state.directory, 'local.db'),
      backups: join(state.directory, 'backups'),
      previews: join(state.directory, 'previews'),
      pictures: join(state.directory, 'pictures'),
      logs: join(state.directory, 'logs'),
    }),
    loadApiKey: () => 'fixture-image-canary',
    estimateProviderCost: () => 0.5,
    createLogger: () => ({
      debug: () => {},
      info: (...args) => state.logs.push(args),
      warn: (...args) => state.logs.push(args),
      error: (...args) => state.logs.push(args),
    }),
  });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  state.db?.close();
  state.schemes?.close();
  state.db = null;
  state.schemes = null;
  rmSync(state.directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const allowed = (path: string) =>
  realpathSync(path).startsWith(realpathSync(state.directory) + sep);
function routes() {
  createDesktopGenerationPersistence(allowed);
  return wrapDurableExternalRunRoutes(
    {},
    { sink: { emit: () => {} } },
    async () => {
      throw new Error('cloud runs use the managed confirmation');
    },
    allowed,
  );
}
async function invoke(
  handlers: Record<string, AutomationRouteHandler>,
  method: string,
  body: unknown = {},
  key?: string,
  id = 'dsch_fixture',
) {
  let result: unknown;
  const returned = await handlers[method]({
    body,
    params: { id },
    request: { headers: key ? { 'idempotency-key': key } : {} },
    json: (value: unknown) => {
      result = value;
    },
  } as unknown as AutomationRouteContext);
  return (result ?? returned) as { jobId: string; status: string };
}

describe('RS-MAP wiring: musefold-cloud image binding routing at the durable run boundary', () => {
  it.each(['scheme', 'skill'] as const)(
    'revalidates the current account for a cached terminal %s replay',
    async (kind) => {
      state.accountSession = {
        token: 'fixture-token',
        apiIssuer: 'http://issuer.example/',
        principalId: 'fixture-principal',
        authEpoch: '11111111-1111-4111-8111-111111111111',
        restricted: false,
        pendingRecovery: false,
      };
      const handler = routes();
      const method = kind === 'scheme' ? 'POST /v1/schemes/:id/runs' : 'POST /v1/skills/github/run';
      const body =
        kind === 'scheme'
          ? { n: 1, inputs: { topic: 'fixture' } }
          : { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape' };
      const key = `cached-terminal-${kind}`;
      const initial = await invoke(handler, method, body, key);
      const repository = new AutomationSpendRepository(required(state.db));
      const request = required(repository.findByKey(key));
      expect(request.state).toBe('terminal');
      state.managedRecord = { callerKey: key, requestId: request.id };
      state.terminalReplay.mockResolvedValueOnce(request);
      expect(await invoke(handler, method, body, key)).toEqual(initial);
      expect(state.terminalReplay).toHaveBeenCalledWith(
        request.id,
        kind === 'scheme' ? 'run_scheme' : 'run_github_skill',
        { params: { id: 'dsch_fixture' }, body },
      );
      state.terminalReplay.mockRejectedValueOnce(
        new ManagedExecutionError('MANAGED_IDENTITY_CHANGED'),
      );
      await expect(invoke(handler, method, body, key)).rejects.toMatchObject({
        code: 'MANAGED_IDENTITY_CHANGED',
        status: 409,
      });
      expect(state.terminalReplay).toHaveBeenCalledTimes(2);
      expect(state.startedSpecs).toHaveLength(1);
      expect(sends).toEqual([]);
    },
  );

  it.each([
    ['logged out', null],
    [
      'restricted',
      {
        token: 'fixture-token',
        apiIssuer: 'http://issuer.example/',
        principalId: 'fixture-principal',
        authEpoch: '11111111-1111-4111-8111-111111111111',
        restricted: true,
        pendingRecovery: false,
      },
    ],
  ])(
    'bounded-rejects a cloud run without a verified account session (%s) with zero sends',
    async (_label, session) => {
      state.accountSession = session as typeof state.accountSession;
      const handler = routes();
      const body = { n: 1, inputs: { topic: 'fixture' } };
      await expect(
        invoke(handler, 'POST /v1/schemes/:id/runs', body, 'cloud-unverified'),
      ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
      expect(sends).toEqual([]);
      const repository = new AutomationSpendRepository(required(state.db));
      const rejected = required(repository.findByKey('cloud-unverified'));
      expect(rejected).toMatchObject({
        state: 'terminal',
        outcome: 'failed',
        errorCode: 'PAYMENT_IDENTITY_UNBOUND',
      });
      expect(repository.calls(rejected.id)).toEqual([]);
      expect(
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get(),
      ).toEqual({ n: 1 });
      // 同键重放:同一拒绝结论,不重复审计,也从未进入托管运行。
      await expect(
        invoke(routes(), 'POST /v1/schemes/:id/runs', body, 'cloud-unverified'),
      ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
      expect(
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get(),
      ).toEqual({ n: 1 });
      expect(sends).toEqual([]);
      expect(state.startedSpecs).toEqual([]);
    },
  );

  it('routes a verified cloud skill run to the managed runtime with the hosted text binding unbound', async () => {
    required(state.profile).managedBy = 'account';
    state.accountSession = {
      token: 'fixture-token',
      apiIssuer: 'http://issuer.example/',
      principalId: 'fixture-principal',
      authEpoch: '11111111-1111-4111-8111-111111111111',
      restricted: false,
      pendingRecovery: false,
    };
    const handler = routes();
    const result = await invoke(
      handler,
      'POST /v1/skills/github/run',
      { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape', n: 2 },
      'cloud-hosted-text',
    );
    expect(state.startedSpecs).toHaveLength(1);
    const spec = state.startedSpecs[0] as {
      runKind: string;
      providerId: string;
      callerKey: string;
      executionId: string;
      originalJobIds: string[];
      textBinding: { payerKind: string; policy: string; providerId: string };
      frozenRun: { jobIds: string[] };
    };
    expect(spec).toMatchObject({
      runKind: 'run_github_skill',
      providerId: 'fixture-cloud',
      callerKey: 'cloud-hosted-text',
    });
    // The hosted text payer rides along unbound: registerRun terminates the run at
    // registration (PAYMENT_IDENTITY_UNBOUND, zero sends) per the frozen constraint.
    expect(spec.textBinding).toMatchObject({
      payerKind: 'unbound',
      policy: 'managed',
      providerId: 'fixture-text',
    });
    expect(spec.originalJobIds).toHaveLength(2);
    expect(spec.frozenRun.jobIds).toEqual(spec.originalJobIds);
    expect(result.jobId).toBe(spec.executionId);
    expect(sends).toEqual([]);
  });

  it('routes a verified cloud skill run with BYOK text as an external rider', async () => {
    state.accountSession = {
      token: 'fixture-token',
      apiIssuer: 'http://issuer.example/',
      principalId: 'fixture-principal',
      authEpoch: '11111111-1111-4111-8111-111111111111',
      restricted: false,
      pendingRecovery: false,
    };
    const handler = routes();
    await invoke(
      handler,
      'POST /v1/skills/github/run',
      { url: 'https://github.com/fixture/visual', prompt: 'Fixture landscape' },
      'cloud-byok-text',
    );
    expect(state.startedSpecs).toHaveLength(1);
    const spec = state.startedSpecs[0] as { textBinding: { payerKind: string; policy: string } };
    expect(spec.textBinding).toMatchObject({ payerKind: 'external', policy: 'external' });
    expect(spec).toMatchObject({
      localProjection: {
        skillRuntimeSource: {
          label: expect.any(String),
          repositoryUrl: 'https://github.com/fixture/visual',
        },
      },
    });
    expect(sends).toEqual([]);
  });

  it('routes a managed run replay through the frozen plan instead of minting fresh ids', async () => {
    state.accountSession = {
      token: 'fixture-token',
      apiIssuer: 'http://issuer.example/',
      principalId: 'fixture-principal',
      authEpoch: '11111111-1111-4111-8111-111111111111',
      restricted: false,
      pendingRecovery: false,
    };
    // 托管行重放:legacy 哈希门(不同冻结形状)不得裁决,托管账本按 caller key 认领,
    // 原图计划逐字段复用 —— fresh ulid 会破坏 registerRun 的 inputHash 幂等。
    state.managedRecord = managedRunRecordSchema.parse({
      requestId: 'mrr-fixture-replay',
      callerKey: 'cloud-managed-replay',
      namespace: '22222222-2222-4222-8222-222222222222',
      binding: {
        apiIssuer: 'http://issuer.example/',
        principalId: 'fixture-principal',
        payer: { issuer: 'http://issuer.example/', ownerId: 'fixture-principal' },
        credential: { ref: 'cred-fixture', version: 1 },
        providerId: 'cloud-default',
        model: 'musefold-image-pro',
        capabilities: { image: true, text: false },
      },
      authEpoch: '33333333-3333-4333-8333-333333333333',
      runtimeEpoch: '44444444-4444-4444-8444-444444444444',
      run: {
        runKind: 'run_scheme',
        originalJobIds: ['job-frozen-a', 'job-frozen-b'],
        input: { params: { id: 'dsch_fixture' } },
        frozenRun: { runId: 'dsr_frozen_replay' },
        textBinding: null,
      },
      children: [
        {
          ordinal: 0,
          originalJobId: 'job-frozen-a',
          remoteKey: 'desktop-rs-v1:frozen-a',
          callId: null,
          localGenerationId: null,
          submissionState: 'unclaimed',
          receipt: null,
          cancelAcknowledgedAt: null,
        },
        {
          ordinal: 1,
          originalJobId: 'job-frozen-b',
          remoteKey: 'desktop-rs-v1:frozen-b',
          callId: null,
          localGenerationId: null,
          submissionState: 'unclaimed',
          receipt: null,
          cancelAcknowledgedAt: null,
        },
      ],
      inputHash: 'a'.repeat(64),
      cancelRequestedAt: null,
      createdAt: 1,
      updatedAt: 1,
    }) as unknown as Record<string, unknown>;
    const handler = routes();
    const result = await invoke(
      handler,
      'POST /v1/schemes/:id/runs',
      { n: 2, inputs: { topic: 'fixture' } },
      'cloud-managed-replay',
    );
    expect(state.startedSpecs).toHaveLength(1);
    const spec = state.startedSpecs[0] as {
      originalJobIds: string[];
      frozenRun: { jobIds?: string[]; runId?: string };
    };
    expect(spec.originalJobIds).toEqual(['job-frozen-a', 'job-frozen-b']);
    expect(spec.frozenRun.jobIds).toEqual(['job-frozen-a', 'job-frozen-b']);
    expect(spec.frozenRun.runId).toBe('dsr_frozen_replay');
    expect(typeof result.jobId).toBe('string');
    expect(sends).toEqual([]);
  });
});
