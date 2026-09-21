// SP-P5 层②真实边界测试（真实 SQLite + 回环 HTTP + 真实文件字节，无 mock Provider）：
// 1) 方案 n=2 第 2 图 503 → 部分成功 outcome=success、costPoints=null、单资产；
//    同键重放（同进程与重开 DB 后）都不再发送剩余图。
// 2) R/S 文本调用（真实 HTTP）之后参考图字节被改 → 图像发送边界 SPEND_REFERENCE_CHANGED，
//    只留文本 unknown call，无 /images/edits 发送。
// 3) musefold-cloud 类型行作为默认 Provider → 路由级 PAYMENT_IDENTITY_UNBOUND（0 发送、1 审计、
//    同键重放同结论）；显式 BYOK providerId + 新键则正常成功。
// 证据：tests/v25/.results/s5/sp-p5-boundary-result.json。

import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import type { AutomationRouteContext, AutomationRouteHandler } from '@musefold/automation-server';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  schemes: null as Database.Database | null,
  profile: null as AiConnectionProfile | null,
  epoch: 'fixture-image-epoch',
  textEpoch: 'fixture-text-epoch',
  directory: '',
  logs: [] as unknown[][],
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('@musefold/core/db/design-scheme', () => ({ getDesignSchemeDb: () => state.schemes }));
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
    loadKeySnapshot: () => ({ key: 'fixture-text-canary', epoch: state.textEpoch }),
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
    ok: false,
    error: { code: 'NOT_FOUND' },
  }),
}));

import { wrapDurableExternalRunRoutes } from '../automation-durable-runs';
import {
  captureAutomationTextConnection,
  createDesktopExternalSpend,
} from '../automation-run-spend';
import { createDesktopGenerationPersistence } from '../automation-spend';

let server: Server;
let baseUrl: string;
let databasePath: string;
let sends: Array<{ path: string; body: string; auth?: string }>;
let imageStatus: number;
let onSend: ((path: string) => void) | undefined;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQAAAABJRU5ErkJggg==',
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
  state.directory = mkdtempSync(join(tmpdir(), 'musefold-sp-p5-boundary-'));
  databasePath = join(state.directory, 'local.db');
  state.db = new Database(databasePath);
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
  state.epoch = 'fixture-image-epoch';
  state.textEpoch = 'fixture-text-epoch';
  state.logs = [];
  sends = [];
  imageStatus = 200;
  onSend = undefined;
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const path = request.url ?? '';
      sends.push({ path, body, auth: request.headers.authorization });
      onSend?.(path);
      if (path.endsWith('/chat/completions')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = {
          id: 'fixture-completion',
          created: 1,
          model: 'fixture-text',
          object: 'chat.completion.chunk',
        };
        response.end(
          `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Draw a warm geometric landscape.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      response.writeHead(imageStatus, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          imageStatus === 200
            ? { data: [{ b64_json: png.toString('base64') }] }
            : { error: { message: 'Fixture image failure' } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  state.db
    .prepare(
      `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at) VALUES ('fixture-provider','Fixture','openai-compatible',?,'fixture-image',1,1,1,1)`,
    )
    .run(baseUrl);
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
  mkdirSync(join(state.directory, 'previews', 'uploads'), { recursive: true });
  configureCoreRuntime({
    managedFilesystem: () =>
      loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
    getPaths: () => ({
      userData: state.directory,
      db: databasePath,
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
  createDesktopGenerationPersistence(allowed); // Production startup recovery order.
  return wrapDurableExternalRunRoutes(
    {},
    { sink: { emit: () => {} } },
    async () => {
      throw new Error('BYOK must not use managed confirmation');
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
  return (result ?? returned) as {
    jobId: string;
    status: string;
    costPoints: number | null;
    assets: unknown[];
    error?: { code: string };
  };
}
async function completed(
  handlers: Record<string, AutomationRouteHandler>,
  kind: 'scheme' | 'skill',
  id: string,
) {
  let result: Awaited<ReturnType<typeof invoke>> | undefined;
  await vi.waitFor(async () => {
    result = await invoke(handlers, `GET /v1/${kind}-runs/:id`, {}, undefined, id);
    expect(result.status).not.toBe('running');
  });
  return required(result);
}

describe('SP-P5 boundary: partial success never resumes the remaining images', () => {
  it('keeps a 1-of-2 scheme success terminal with unknown cost and replays it without new sends', async () => {
    const handler = routes();
    const body = { n: 2, inputs: { topic: 'fixture flowers' } };
    let imageSends = 0;
    onSend = (path) => {
      if (!path.endsWith('/images/generations')) return;
      imageSends++;
      if (imageSends === 2) imageStatus = 503; // 第 2 张图在响应写回前变为失败。
    };
    const job = await invoke(handler, 'POST /v1/schemes/:id/runs', body, 'sp-p5-partial');
    const result = await completed(handler, 'scheme', job.jobId);
    // 部分成功：outcome=success,但任一 call unknown → costPoints=null,单资产。
    expect(result).toMatchObject({ status: 'success', costPoints: null });
    expect(result.assets).toHaveLength(1);
    expect(sends.filter((send) => send.path.endsWith('/images/generations'))).toHaveLength(2);
    const repository = new AutomationSpendRepository(required(state.db));
    const request = required(repository.findByKey('sp-p5-partial'));
    expect(repository.calls(request.id).map((call) => [call.kind, call.costSource])).toEqual([
      ['image', 'local_price_estimate'],
      ['image', 'unknown'],
    ]);

    // 同进程同键重放：终态 payload 原样返回,不再补发第 2 张图。
    const replayed = await invoke(handler, 'POST /v1/schemes/:id/runs', body, 'sp-p5-partial');
    expect(replayed).toMatchObject({ status: 'success', costPoints: null });
    expect(replayed.assets).toHaveLength(1);
    expect(sends.filter((send) => send.path.endsWith('/images/generations'))).toHaveLength(2);

    // 重开 DB 后(新连接上的生产启动恢复顺序)再重放:依旧只读不发送。
    state.db?.close();
    state.db = new Database(databasePath);
    takeoverDesktopDatabase(state.db);
    const restored = await invoke(routes(), 'POST /v1/schemes/:id/runs', body, 'sp-p5-partial');
    expect(restored).toMatchObject({ status: 'success', costPoints: null });
    expect(restored.assets).toHaveLength(1);
    expect(sends.filter((send) => send.path.endsWith('/images/generations'))).toHaveLength(2);
    expect(new AutomationSpendRepository(required(state.db)).calls(request.id)).toHaveLength(2);
  });
});

describe('SP-P5 boundary: reference bytes stay frozen across the real Skill text call', () => {
  it('rejects the image dispatch with SPEND_REFERENCE_CHANGED and keeps only the unknown text call', async () => {
    routes();
    const referencePath = join(state.directory, 'previews', 'uploads', 'sp-p5-skill-ref.png');
    writeFileSync(referencePath, png);
    const spend = createDesktopExternalSpend(allowed);
    const image = spend.binding('fixture-provider');
    const text = required(captureAutomationTextConnection());
    const jobIds = ['sp-p5-skill-image'];
    const request = spend.register({
      idempotencyKey: 'sp-p5-skill-ref-change',
      action: 'run_github_skill',
      caller: 'local-automation',
      input: {
        params: {},
        body: { url: 'https://github.com/fixture/visual', prompt: 'Fixture', n: 1 },
      },
      frozenInput: { body: { url: 'https://github.com/fixture/visual' } },
      bindings: [image.binding, text.binding],
      promptText: 'Fixture prompt',
      executionId: 'ext_sp_p5_skill_ref',
      maxImageCalls: 1,
      maxTextCalls: 1,
      estimatedPoints: 0.5,
      now: Date.now(),
    });
    spend.repository.beginExecution(request.id);
    // 真实文本 HTTP 发送(SSE):完成后文本 call 落账为 unknown。
    const executor = spend.textExecutor(request, text.binding);
    await executor.fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-text-canary', 'content-type': 'application/json' },
      body: JSON.stringify({ model: text.binding.model, max_tokens: 4000, messages: [] }),
    });
    // 文本调用之后登记参考图(冻结字节摘要),再改写真实文件字节。
    const images = spend.imageExecutor(request, jobIds);
    images.onReferences([{ path: referencePath, source: 'upload' }]);
    writeFileSync(referencePath, Buffer.concat([png, Buffer.from('sp-p5 mutated bytes')]));
    const dispatch: GenerateImageRequest = {
      jobId: jobIds[0],
      providerId: 'fixture-provider',
      model: 'fixture-image',
      prompt: 'Fixture prompt',
      size: '1024x1024',
      quality: 'auto',
      n: 1,
      referenceImages: [{ path: referencePath, source: 'upload' }],
    };
    const failed = await images.generate(dispatch, () => {}, {});
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'SPEND_REFERENCE_CHANGED' } });
    // 只有文本发送发生;图像(/images/edits)从未发送,也没有图像 call 行。
    expect(sends.map((send) => send.path)).toEqual(['/v1/chat/completions']);
    const calls = spend.repository.calls(request.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'text', costSource: 'unknown' });
  });
});

describe('SP-P5 boundary: a musefold-cloud row is a bounded rejection at the route level', () => {
  it('rejects the default cloud row without sends and accepts an explicit BYOK providerId', async () => {
    required(state.db)
      .prepare(
        `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,managed_by,created_at,updated_at)
         VALUES ('sp-p5-cloud','账号云图像','musefold-cloud','http://issuer.example/','musefold-image-pro',0,1,'account',1,1)`,
      )
      .run();
    required(state.db)
      .prepare("UPDATE providers SET is_active = 0 WHERE id = 'fixture-provider'")
      .run();
    const handler = routes();
    const body = { inputs: { topic: 'fixture' } };
    await expect(
      invoke(handler, 'POST /v1/schemes/:id/runs', body, 'sp-p5-cloud-default'),
    ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
    expect(sends).toEqual([]);
    const repository = new AutomationSpendRepository(required(state.db));
    const rejected = required(repository.findByKey('sp-p5-cloud-default'));
    expect(rejected).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
    });
    expect(repository.calls(rejected.id)).toEqual([]);
    expect(
      (
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    // 同键同体重放:同一拒绝结论,不重复审计。
    await expect(
      invoke(handler, 'POST /v1/schemes/:id/runs', body, 'sp-p5-cloud-default'),
    ).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_UNBOUND' });
    expect(
      (
        required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_audit').get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(sends).toEqual([]);

    // 显式 BYOK providerId + 新键:普通外部路径正常完成。
    required(state.db)
      .prepare("UPDATE providers SET is_active = 1 WHERE id = 'fixture-provider'")
      .run();
    const byok = await invoke(
      routes(),
      'POST /v1/schemes/:id/runs',
      { n: 1, inputs: { topic: 'fixture' }, providerId: 'fixture-provider' },
      'sp-p5-byok-explicit',
    );
    expect(await completed(routes(), 'scheme', byok.jobId)).toMatchObject({
      status: 'success',
      costPoints: 0.5,
    });
    expect(sends.filter((send) => send.path.endsWith('/images/generations'))).toHaveLength(1);
  });
});
