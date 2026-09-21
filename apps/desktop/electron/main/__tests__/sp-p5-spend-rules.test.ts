// SP-P5 层①规则测试（真实 SQLite，无网络）：把五条出口钉在桌面生产适配器上。
// 覆盖：最终输入/计划冻结（计划外 jobId 拒绝）、参考字节摘要冻结、每原 jobId 单次发送资格、
// musefold-cloud 形状行的有界拒绝与同键重放、托管文本不能借图像授权、中断运行恢复不续发。
// 证据：tests/v25/.results/s5/sp-p5-rules-result.json。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  profile: null as AiConnectionProfile | null,
  epoch: 'fixture-image-epoch',
  directory: '',
  logs: [] as unknown[][],
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('../../security/keychain', () => ({
  loadApiKeySnapshot: () => ({ key: 'fixture-image-canary', epoch: state.epoch }),
}));
vi.mock('../../ai/connection-store', () => ({
  getAiConnectionStore: () => ({
    list: () => (state.profile ? [state.profile] : []),
    get: (id: string) => (state.profile?.id === id ? state.profile : null),
    loadKey: () => {
      throw new Error('Durable text execution must use its frozen snapshot');
    },
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
  getMusefoldCore: () => {
    throw new Error('Rules layer must not reach a Provider executor');
  },
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

import {
  createDesktopExternalSpend,
  captureAutomationTextConnection,
} from '../automation-run-spend';
import {
  createDesktopGenerationPersistence,
  createDesktopImageExecution,
  jsonRecord,
} from '../automation-spend';

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-sp-p5-rules-'));
  databasePath = join(directory, 'local.db');
  state.directory = directory;
  state.epoch = 'fixture-image-epoch';
  state.logs = [];
  state.db = new Database(databasePath);
  state.db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(state.db);
  state.db
    .prepare(
      `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,managed_by,created_at,updated_at)
       VALUES ('fixture-provider','Fixture','openai-compatible','http://127.0.0.1:9/v1','fixture-image',1,1,NULL,1,1)`,
    )
    .run();
  state.profile = {
    id: 'fixture-text',
    name: 'Fixture text',
    routeKind: 'gateway',
    protocol: 'openai-compatible',
    presetId: 'custom',
    baseUrl: 'http://127.0.0.1:9/v1',
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
});
afterEach(() => {
  state.db?.close();
  state.db = null;
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const allowed = () => true;

/** 同步抛错的错误码断言（vitest 的 toMatchObject 不适用于函数）。 */
function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code} to be thrown`);
}

/** 一个已授权开始、每图绑定原 jobId 的 run_scheme 请求（与 durable 路由同一冻结形状）。 */
function authorizedSchemeRun(
  spend: ReturnType<typeof createDesktopExternalSpend>,
  jobIds: string[],
) {
  const provider = spend.binding('fixture-provider');
  const request = spend.register({
    idempotencyKey: `rules-${jobIds.join('-')}`,
    action: 'run_scheme',
    caller: 'local-automation',
    input: { params: { id: 'dsch_fixture' }, body: { n: jobIds.length } },
    frozenInput: jsonRecord({
      body: { n: jobIds.length },
      params: { id: 'dsch_fixture' },
      jobIds,
      runId: 'dsr_fixture',
      source: { schemeId: 'dsch_fixture' },
    }),
    bindings: [provider.binding],
    promptText: 'fixture brief',
    executionId: `ext_${jobIds[0]}`,
    maxImageCalls: jobIds.length,
    maxTextCalls: 0,
    estimatedPoints: 0.5 * jobIds.length,
    now: Date.now(),
  });
  if (!spend.repository.beginExecution(request.id)) throw new Error('Fixture begin failed');
  return { request, provider };
}

describe('SP-P5 rules: frozen final input, reference bytes and one send per original jobId', () => {
  it('rejects an image outside the authorized job plan before any ledger row or executor', () => {
    const spend = createDesktopExternalSpend(allowed);
    const { request } = authorizedSchemeRun(spend, ['job-a', 'job-b']);
    const images = spend.imageExecutor(request, ['job-a', 'job-b']);
    expectCode(() => {
      images.generate(
        {
          jobId: 'job-not-in-plan',
          providerId: 'fixture-provider',
          model: 'fixture-image',
          prompt: 'fixture',
          size: '1024x1024',
          quality: 'auto',
          n: 1,
        },
        () => {},
        {},
      );
    }, 'SPEND_INPUT_CHANGED');
    expect(spend.repository.calls(request.id)).toEqual([]);
  });

  it('freezes reference hashes per dispatch and grants exactly one send per original jobId', () => {
    const spend = createDesktopExternalSpend(allowed);
    const { request, provider } = authorizedSchemeRun(spend, ['job-a']);
    const hashes = ['a'.repeat(64)];
    const execution = createDesktopImageExecution(request, 0, hashes, 'job-a');
    const dispatch = (referenceHashes: string[]) =>
      execution.beforeDispatch({
        referenceHashes,
        request: {
          jobId: 'job-a',
          providerId: provider.binding.providerId,
          model: provider.binding.model,
          prompt: 'fixture prompt',
          size: '1024x1024',
          quality: 'auto',
          n: 1,
        },
      });
    // 提交时冻结的摘要与发送边界实际字节摘要不一致 → 拒绝且不留 call 行。
    expectCode(() => dispatch(['b'.repeat(64)]), 'SPEND_REFERENCE_CHANGED');
    expect(spend.repository.calls(request.id)).toEqual([]);
    dispatch(hashes);
    const calls = spend.repository.calls(request.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'image',
      ordinal: 0,
      generationRunId: 'job-a',
      state: 'started',
    });
    // 同一原 jobId 的第二次发送资格不存在。
    expectCode(() => dispatch(hashes), 'SPEND_ALREADY_DISPATCHED');
    expect(spend.repository.calls(request.id)).toHaveLength(1);
    execution.onCost({ reportedPoints: 0.5, source: 'local_price_estimate', evidenceRef: null });
    expect(spend.repository.calls(request.id)[0]).toMatchObject({ reportedPoints: 0.5 });
  });
});

describe('SP-P5 rules: cloud-shaped provider rows and managed text stay bounded', () => {
  it('rejects a musefold-cloud provider row before execution and replays the same terminal', () => {
    // account-cloud-connection.ts:192-199 的行形状：type=musefold-cloud、managed_by=account、has_key=0。
    required(state.db)
      .prepare(
        `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,managed_by,created_at,updated_at)
         VALUES ('cloud-row','账号云图像','musefold-cloud','http://issuer.example/','musefold-image-pro',0,1,'account',1,1)`,
      )
      .run();
    const spend = createDesktopExternalSpend(allowed);
    const command = {
      idempotencyKey: 'rules-cloud-rs',
      action: 'run_scheme' as const,
      caller: 'local-automation',
      input: { params: { id: 'dsch_fixture' }, body: { n: 2 } },
      frozenInput: jsonRecord({ body: { n: 2 }, jobIds: ['job-a', 'job-b'] }),
      bindings: [spend.binding('cloud-row').binding],
      promptText: 'fixture brief',
      executionId: 'ext_cloud_rules',
      maxImageCalls: 2,
      maxTextCalls: 0,
      estimatedPoints: 1,
      now: Date.now(),
    };
    expectCode(() => spend.register(command), 'PAYMENT_IDENTITY_UNBOUND');
    const row = spend.repository.findByKey('rules-cloud-rs');
    expect(row).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
    });
    expect(spend.repository.calls(required(row).id)).toEqual([]);
    const audits = () =>
      (
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get() as {
          n: number;
        }
      ).n;
    expect(audits()).toBe(1);
    // 同键重放返回同一终态结论，不重复审计、不产生第二次授权。
    expectCode(() => spend.register(command), 'PAYMENT_IDENTITY_UNBOUND');
    expect(audits()).toBe(1);
    expect(spend.repository.findByKey('rules-cloud-rs')).toMatchObject({ state: 'terminal' });
  });

  it('lets an unbound managed text binding block the whole run instead of riding the image', () => {
    required(state.profile).managedBy = 'account';
    const spend = createDesktopExternalSpend(allowed);
    const text = captureAutomationTextConnection();
    expect(text?.binding).toMatchObject({ payerKind: 'unbound', policy: 'managed' });
    expectCode(() => {
      spend.register({
        idempotencyKey: 'rules-managed-text',
        action: 'run_github_skill',
        caller: 'local-automation',
        input: { params: {}, body: { url: 'https://github.com/fixture/visual' } },
        frozenInput: jsonRecord({ body: { url: 'https://github.com/fixture/visual' } }),
        bindings: [spend.binding('fixture-provider').binding, required(text).binding],
        promptText: 'fixture prompt',
        executionId: 'ext_managed_text',
        maxImageCalls: 1,
        maxTextCalls: 10,
        estimatedPoints: 0.5,
        now: Date.now(),
      });
    }, 'PAYMENT_IDENTITY_UNBOUND');
    const request = spend.repository.findByKey('rules-managed-text');
    expect(request).toMatchObject({ state: 'terminal', outcome: 'failed' });
    expect(spend.repository.calls(required(request).id)).toEqual([]);
  });
});

describe('SP-P5 rules: an interrupted run recovers as terminal without resending', () => {
  it('closes a mid-run R/S request on a fresh connection and freezes the same-key replay', () => {
    const spend = createDesktopExternalSpend(allowed);
    const command = {
      idempotencyKey: 'rules-interrupted',
      action: 'run_scheme' as const,
      caller: 'local-automation',
      input: { params: { id: 'dsch_fixture' }, body: { n: 2 } },
      frozenInput: jsonRecord({
        body: { n: 2 },
        params: { id: 'dsch_fixture' },
        jobIds: ['job-a', 'job-b'],
        runId: 'dsr_fixture',
        source: { schemeId: 'dsch_fixture' },
      }),
      bindings: [spend.binding('fixture-provider').binding],
      promptText: 'fixture brief',
      executionId: 'ext_interrupted',
      maxImageCalls: 2,
      maxTextCalls: 0,
      estimatedPoints: 1,
      now: Date.now(),
    };
    const request = spend.register(command);
    spend.repository.beginExecution(request.id);
    const execution = createDesktopImageExecution(request, 0, [], 'job-a');
    execution.beforeDispatch({
      referenceHashes: [],
      request: {
        jobId: 'job-a',
        providerId: 'fixture-provider',
        model: 'fixture-image',
        prompt: 'first image only',
        size: '1024x1024',
        quality: 'auto',
        n: 1,
      },
    });
    execution.onCost({ reportedPoints: 0.5, source: 'local_price_estimate', evidenceRef: null });

    // 进程中断：新连接上的生产启动恢复终结该请求，不重发剩余图。
    required(state.db).close();
    state.db = new Database(databasePath);
    takeoverDesktopDatabase(state.db);
    createDesktopGenerationPersistence(allowed);
    const recovered = required(
      new AutomationSpendRepository(required(state.db)).findByKey('rules-interrupted'),
    );
    expect(recovered).toMatchObject({ state: 'terminal', outcome: 'failed' });
    const calls = new AutomationSpendRepository(required(state.db)).calls(recovered.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ ordinal: 0, generationRunId: 'job-a', reportedPoints: 0.5 });
    // 终态后不允许为未发送的第 2 张图补登记。
    expectCode(() => {
      new AutomationSpendRepository(required(state.db)).prepareCall({
        requestId: recovered.id,
        ordinal: 1,
        kind: 'image',
        binding: recovered.bindings[0],
        input: {},
        generationRunId: 'job-b',
      });
    }, 'SPEND_NOT_AUTHORIZED');

    // 同键重放共享同一终态：payload 从 SQLite 取回，无新授权、无新发送。
    const replaySpend = createDesktopExternalSpend(allowed);
    const replayed = replaySpend.replay('run_scheme', command.input, 'rules-interrupted');
    expect(replayed).toMatchObject({ state: 'terminal', outcome: 'failed' });
    const payload = replaySpend.payload(required(replayed));
    expect(payload).toMatchObject({ status: 'failed', costPoints: 0.5, assets: [] });
    expect(new AutomationSpendRepository(required(state.db)).calls(recovered.id)).toHaveLength(1);
  });
});
