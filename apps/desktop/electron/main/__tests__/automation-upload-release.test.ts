// D02.6：长驻 Automation 上传的终态显式释放与 TTL 期限回收（桌面宿主层）。
// 真实层：better-sqlite3 + 临时目录 + 真实 owner/managed-fs + 真实生图闸门与 HTTP Provider。
// 仅对 Electron 边界（keychain/settings/core-instance/db 单例）按既有 durable 测试同样式注入。

import { createServer, type Server } from 'node:http';
// default import = node:fs 的 CJS 模块对象（可变）；慢复制用 spy + syncBuiltinESMExports 传导到生产 ESM 绑定。
import nodeFs from 'node:fs';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { closeDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { generate, cancelGeneration } from '@musefold/core/services/generation';
import { AutomationSpendRepository } from '@musefold/core/db/repositories/automation-spend';
import { stageLocalImageBytes } from '@musefold/core/providers/local-image';
import {
  createLocalUploadOwner,
  reclaimLocalAssets,
  type LocalUploadOwner,
} from '@musefold/core/services/local-upload-owner';
import { LOCAL_UPLOAD_TTL_MS } from '@musefold/core/constants';
import {
  createGenerationGate,
  type AutomationRouteContext,
  type GenerationGate,
  type GenerationHost,
} from '@musefold/automation-server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture value');
  return value;
}

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  key: 'fixture-canary-key',
  epoch: 'fixture-key-epoch',
  generate: vi.fn(),
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('../../security/keychain', () => ({
  loadApiKeySnapshot: () => ({ key: state.key, epoch: state.epoch }),
}));
vi.mock('../../settings/automation', () => ({
  getAutomationSpendRepository: () => {
    if (!state.db) throw new Error('Fixture DB unavailable');
    const repository = new AutomationSpendRepository(state.db);
    repository.initializeBudget(
      { monthlyLimitPoints: 20, usedPoints: 0, month: new Date().toISOString().slice(0, 7) },
      Date.now(),
    );
    return repository;
  },
}));
vi.mock('../core-instance', () => ({
  getMusefoldCore: () => ({
    generation: {
      generate: (...args: unknown[]) => state.generate(...args),
      cancel: (jobId: string) => state.db && cancelGeneration(jobId, state.db),
    },
  }),
}));

import { createDesktopGenerationPersistence, releaseTerminalReferences } from '../automation-spend';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLgAAAABJRU5ErkJggg==',
  'base64',
);
let directory: string;
let databasePath: string;
let server: Server;
let baseUrl: string;
let sends: number;
let failureStatus: number | null;
let owner: LocalUploadOwner;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-upload-release-'));
  databasePath = join(directory, 'local.db');
  state.db = new Database(databasePath);
  state.db.pragma('journal_mode = WAL');
  state.db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(state.db);
  state.key = 'fixture-canary-key';
  state.epoch = 'fixture-key-epoch';
  state.generate.mockReset().mockImplementation(generate);
  sends = 0;
  failureStatus = null;
  server = createServer((request, response) => {
    let _body = '';
    request.on('data', (chunk) => {
      _body += String(chunk);
    });
    request.on('end', () => {
      sends++;
      response.writeHead(failureStatus ?? 200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          failureStatus
            ? { error: { message: 'fixture upstream failure' } }
            : { data: [{ b64_json: png.toString('base64') }] },
        ),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture listener missing');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  state.db
    .prepare(
      `INSERT INTO providers(id, name, type, base_url, model, has_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .run(
      'fixture-provider',
      'Fixture Provider',
      'openai-compatible',
      baseUrl,
      'fixture-model',
      Date.now(),
      Date.now(),
    );
  mkdirSync(join(directory, 'previews', 'uploads'), { recursive: true });
  configureCoreRuntime({
    managedFilesystem: () =>
      loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
    getPaths: () => ({
      userData: directory,
      db: databasePath,
      backups: join(directory, 'backups'),
      previews: join(directory, 'previews'),
      pictures: join(directory, 'pictures'),
      logs: join(directory, 'logs'),
    }),
    loadApiKey: () => state.key,
    estimateProviderCost: () => null,
    createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  });
  owner = createLocalUploadOwner({ db: required(state.db) });
});
afterEach(async () => {
  try {
    owner.close();
  } catch {
    /* 测试可能已验证 close 行为 */
  }
  closeDesignSchemeDb();
  await new Promise<void>((done) => server.close(() => done()));
  state.db?.close();
  state.db = null;
  rmSync(directory, { recursive: true, force: true });
});

/** 与 automation.ts createElectronGenerationHost 相同的 onTerminal 接线；stageUpload 可注入（缺省 Unused）。 */
function gateFixture(options: { stageUpload?: GenerationHost['stageUpload'] } = {}): {
  gate: GenerationGate;
  repository: AutomationSpendRepository;
} {
  const db = required(state.db);
  const authorize = (path: string) => realpathSync(path).startsWith(realpathSync(directory) + sep);
  const durable = createDesktopGenerationPersistence(authorize, {
    onTerminal: (request) => releaseTerminalReferences(owner, request),
  });
  const repository = new AutomationSpendRepository(db);
  const host: GenerationHost = {
    persistence: durable.persistence,
    run: (request, progress, spend) => {
      if (!spend) throw new Error('Expected durable execution context');
      return durable.run(request, progress, spend);
    },
    cancel: () => false,
    estimate: () => ({
      points: null,
      managedByAccount: false,
      providerId: 'fixture-provider',
      providerName: 'Fixture Provider',
      model: 'fixture-model',
      n: 1,
    }),
    budget: {
      remainingPoints: () => 0,
      settle: () => {},
    },
    requestConfirmation: async () => 'denied',
    authorizeReferencePath: authorize,
    stageUpload:
      options.stageUpload ??
      (async () => {
        throw new Error('Unused');
      }),
    resolveHistoryImage: () => null,
  };
  return { gate: createGenerationGate(host, { sink: { emit: () => {} } }), repository };
}

async function invoke(
  gate: GenerationGate,
  route: string,
  body: unknown = {},
  key?: string,
  jobId?: string,
) {
  let value: unknown;
  const returned = await gate.routes[route]({
    body,
    request: { headers: key ? { 'idempotency-key': key } : {} },
    params: { jobId },
    json: (payload: unknown) => {
      value = payload;
    },
  } as unknown as AutomationRouteContext);
  return (value ?? returned) as { jobId: string; status: string };
}

const queueRow = (path: string) =>
  required(state.db)
    .prepare('SELECT * FROM local_asset_cleanup WHERE path=?')
    .get(realpathSync(path)) as { state: string; last_error: string | null } | undefined;

async function uploadFixture() {
  const image = await stageLocalImageBytes({ bytes: png, name: 'release.png' }, owner);
  expect(existsSync(image.path)).toBe(true);
  // 写作用域收尾 drain 会把仍在持有的行 defer 为 writing（活跃写租约）。
  expect(queueRow(image.path)?.last_error).toBe('writing');
  return image;
}

async function runGeneration(gate: GenerationGate, path: string, key: string) {
  const job = await invoke(
    gate,
    'POST /v1/generations',
    { prompt: 'fixture prompt', referenceImagePaths: [path], consent: 'interactive' },
    key,
  );
  await vi.waitFor(async () =>
    expect(
      (await invoke(gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
    ).toBe('success'),
  );
  return job;
}

it('wires the terminal release hook exactly once in the control-plane host', () => {
  const source = readFileSync(resolve('apps/desktop/electron/main/automation.ts'), 'utf8');
  expect(source).toContain(
    'onTerminal: (request) => releaseTerminalReferences(uploadOwner, request)',
  );
});

it('releases the control-plane hold when a request reaches its success terminal state', async () => {
  const { gate } = gateFixture();
  const image = await uploadFixture();
  const job = await runGeneration(gate, image.path, 'fixture-success-release');
  expect(sends).toBe(1);
  // 终态释放发生在控制面 owner 仍打开时：行已降级为 referenced，文件仍在。
  await vi.waitFor(() => expect(queueRow(image.path)?.last_error).toBe('referenced'));
  expect(existsSync(image.path)).toBe(true);
  expect(readFileSync(image.path)).toEqual(png);
  // 释放幂等：owner 整体 close 不改变终局。
  owner.close();
  expect(existsSync(image.path)).toBe(true);
  expect(
    required(state.db)
      .prepare('SELECT state FROM automation_spend_requests WHERE execution_id=?')
      .get(job.jobId),
  ).toEqual({ state: 'terminal' });
});

it('releases the control-plane hold when the request fails against the Provider', async () => {
  failureStatus = 503;
  const { gate } = gateFixture();
  const image = await uploadFixture();
  const job = await invoke(
    gate,
    'POST /v1/generations',
    { prompt: 'fixture prompt', referenceImagePaths: [image.path], consent: 'interactive' },
    'fixture-failure-release',
  );
  await vi.waitFor(async () =>
    expect(
      (await invoke(gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
    ).toBe('failed'),
  );
  await vi.waitFor(() => expect(queueRow(image.path)?.last_error).toBe('referenced'));
  expect(existsSync(image.path)).toBe(true);
  expect(readFileSync(image.path)).toEqual(png);
});

it('releases the control-plane hold when the request ends cancelled', async () => {
  state.generate.mockImplementation((...args: Parameters<typeof generate>) => {
    const execution = args[2]?.execution;
    if (!execution) throw new Error('Missing durable execution');
    const onCost = execution.onCost;
    execution.onCost = (evidence: Parameters<NonNullable<typeof onCost>>[0]) => {
      onCost(evidence);
      cancelGeneration(args[0].jobId ?? '', required(state.db));
    };
    return generate(...args);
  });
  const { gate } = gateFixture();
  const image = await uploadFixture();
  const job = await invoke(
    gate,
    'POST /v1/generations',
    { prompt: 'fixture prompt', referenceImagePaths: [image.path], consent: 'interactive' },
    'fixture-cancel-release',
  );
  await vi.waitFor(async () =>
    expect(
      (await invoke(gate, 'GET /v1/generations/:jobId', {}, undefined, job.jobId)).status,
    ).toBe('cancelled'),
  );
  await vi.waitFor(() => expect(queueRow(image.path)?.last_error).toBe('referenced'));
  expect(existsSync(image.path)).toBe(true);
  expect(readFileSync(image.path)).toEqual(png);
});

it('does not affect frozen reference hashes or idempotent replay after the release', async () => {
  const { gate } = gateFixture();
  const image = await uploadFixture();
  const body = {
    prompt: 'fixture prompt',
    referenceImagePaths: [image.path],
    consent: 'interactive',
  };
  const job = await runGeneration(gate, image.path, 'fixture-replay-release');
  await vi.waitFor(() => expect(queueRow(image.path)?.last_error).toBe('referenced'));
  const frozen = required(state.db)
    .prepare('SELECT frozen_input_json FROM automation_spend_requests WHERE execution_id=?')
    .get(job.jobId) as { frozen_input_json: string };
  const input = JSON.parse(frozen.frozen_input_json) as { referenceHashes: string[] };
  expect(input.referenceHashes).toEqual([createHash('sha256').update(png).digest('hex')]);
  const replay = await invoke(gate, 'POST /v1/generations', body, 'fixture-replay-release');
  expect(replay).toMatchObject({ jobId: job.jobId, status: 'success' });
  expect(sends).toBe(1);
  expect(readFileSync(image.path)).toEqual(png);
});

it('periodically reclaims an unreferenced degraded upload while the control plane keeps running', async () => {
  gateFixture();
  const unused = await uploadFixture();
  reclaimLocalAssets(Date.now());
  expect(existsSync(unused.path)).toBe(true);
  reclaimLocalAssets(Date.now() + LOCAL_UPLOAD_TTL_MS + 1);
  expect(existsSync(unused.path)).toBe(false);
  expect(required(state.db).prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual(
    { n: 0 },
  );
});

// D02.5 残余：控制面 /v1/uploads 受管复制进行中，宿主周期回收入口（reclaimLocalAssets）介入的窗口语义。
// 与 core 就地慢复制测试同一挂钩面：只推迟真实 write 回调的投递并同步触发回收入口，不伪造字节/时间/IO。
it('keeps a slow control-plane upload alive across mid-copy host reclaims while aged siblings drain', async () => {
  const { gate } = gateFixture({
    // 与 automation.ts createElectronGenerationHost 相同的 stageUpload 接线（同一控制面 owner）。
    stageUpload: (bytes, name, mimeType) =>
      stageLocalImageBytes(
        { bytes, name, mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp' },
        owner,
      ),
  });
  const sibling = await uploadFixture();
  const agedAt = Date.now();
  // 1 MiB 载荷：PNG 魔数 + 确定性填充（16 个 64 KiB 写块）。
  const slowBytes = Buffer.alloc(1024 * 1024);
  slowBytes.set(png.subarray(0, 8), 0);
  for (let index = 8; index < slowBytes.length; index += 1)
    slowBytes[index] = (index * 31 + 11) & 0xff;
  const uploadsDirectory = join(directory, 'previews', 'uploads');
  const listUploads = () =>
    nodeFs
      .readdirSync(uploadsDirectory)
      .map((name) => join(uploadsDirectory, name))
      .filter((path) => nodeFs.statSync(path).isFile());
  interface Fire {
    atBytes: number;
    ran: boolean;
    observation?: unknown;
  }
  const freshReclaim: Fire = { atBytes: Math.floor(slowBytes.length / 4), ran: false };
  const agedReclaim: Fire = { atBytes: Math.floor((slowBytes.length * 3) / 4), ran: false };
  let stagedBytes = 0;
  const delayMs = 3;
  const realWrite = nodeFs.write;
  // fs.write 重载含返回 void 的回调形态，直转函数类型不重叠；经 unknown 中转仅用于测试内转发。
  const forwardWrite = realWrite as unknown as (...values: unknown[]) => number;
  const write = vi.spyOn(nodeFs, 'write').mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as
      | ((error: NodeJS.ErrnoException | null, written: number, buffer: Uint8Array) => void)
      | undefined;
    const buffer = args[1];
    const isStaged =
      typeof callback === 'function' &&
      buffer instanceof Uint8Array &&
      buffer.length === slowBytes.length &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50;
    if (!isStaged) return forwardWrite(...args);
    return forwardWrite(
      args[0],
      buffer,
      args[2],
      args[3],
      args[4],
      (error: NodeJS.ErrnoException | null, written: number) => {
        if (error) {
          callback(error, written, buffer);
          return;
        }
        stagedBytes += written;
        for (const [fire, run] of [
          [
            freshReclaim,
            () => {
              reclaimLocalAssets(Date.now());
              const partial = listUploads().find((path) => path !== realpathSync(sibling.path));
              return {
                uploadsAfterFreshReclaim: listUploads().length,
                partialExistsAfterFreshReclaim: partial != null && existsSync(partial),
                rowAfterFreshReclaim: partial ? queueRow(partial)?.last_error : undefined,
              };
            },
          ] as const,
          [
            agedReclaim,
            () => {
              reclaimLocalAssets(agedAt + LOCAL_UPLOAD_TTL_MS + 1);
              return {
                siblingExistsAfterAgedReclaim: existsSync(sibling.path),
                uploadsAfterAgedReclaim: listUploads().length,
              };
            },
          ] as const,
        ]) {
          if (!fire.ran && stagedBytes >= fire.atBytes) {
            fire.ran = true;
            fire.observation = run();
          }
        }
        setTimeout(() => callback(null, written, buffer), delayMs);
      },
    );
  }) as unknown as typeof nodeFs.write);
  syncBuiltinESMExports();
  try {
    let value: unknown;
    await gate.routes['POST /v1/uploads']({
      body: slowBytes,
      request: { headers: { 'content-type': 'image/png' } },
      params: {},
      json: (payload: unknown) => {
        value = payload;
      },
    } as unknown as AutomationRouteContext);
    const { image } = value as { image: { path: string } };
    expect(readFileSync(image.path)).toEqual(slowBytes);
    // 在飞窗口内：fresh 回收把在飞行 defer 为 writing；到期回收删除 sibling；两者都不碰在飞文件。
    expect(freshReclaim.ran).toBe(true);
    const fresh = freshReclaim.observation as {
      uploadsAfterFreshReclaim: number;
      partialExistsAfterFreshReclaim: boolean;
      rowAfterFreshReclaim: string | undefined;
    };
    expect(fresh.uploadsAfterFreshReclaim).toBe(2);
    expect(fresh.partialExistsAfterFreshReclaim).toBe(true);
    expect(fresh.rowAfterFreshReclaim).toBe('writing');
    expect(agedReclaim.ran).toBe(true);
    const aged = agedReclaim.observation as {
      siblingExistsAfterAgedReclaim: boolean;
      uploadsAfterAgedReclaim: number;
    };
    expect(aged.siblingExistsAfterAgedReclaim).toBe(false);
    expect(aged.uploadsAfterAgedReclaim).toBe(1);
    // 终局：队列只剩在持行（writing），账本无请求，sibling 行已清。
    expect(existsSync(sibling.path)).toBe(false);
    expect(queueRow(image.path)?.last_error).toBe('writing');
    expect(
      required(state.db).prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get(),
    ).toEqual({ n: 1 });
    expect(
      required(state.db).prepare('SELECT COUNT(*) AS n FROM automation_spend_requests').get(),
    ).toEqual({ n: 0 });
  } finally {
    write.mockRestore();
    syncBuiltinESMExports();
  }
}, 30000);
