/**
 * v2.5 design-scheme 域 adapter 单测(P01-4 成功切片 + P01-2 详情元数据)。
 *
 * 用真实内存 SQLite 仓库驱动全部 19 个 deployed canonical 方法;网络 seam(市场搜索、
 * 上游更新检查)注入假实现。重点:
 * - 方法表与 canonical 方法集逐名一致(不落回 fail-closed);
 * - canonical ↔ legacy 文档映射的有损字段按声明收敛;
 * - get 返回 canonical 详情:legacy 资产经真实探测懒回填,缺失资产省略;
 * - 无法映射的操作返回结构化 blocker(BridgeError),绝不伪造成功;
 * - 本地路径/凭据不进入任何返回值或错误消息。
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkDesignSchemeUpdateResultSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  DESIGN_SCHEME_METHOD_NAMES,
  DESIGN_SCHEME_WIRE_METHODS,
  formalizeDesignSchemeResultSchema,
  marketSearchResultSchema,
  promoteWorkingDraftResultSchema,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { runMigrations } from '@musefold/core/db/run-migrations';
import { GenerationRunRepository } from '@musefold/core/db/repositories/workbench';
import { appError, fail, ok } from '@musefold/domain/app-result';
import type {
  DesignSchemeRevisionDocument as LegacyDocument,
  SourceBinding as LegacySourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';

// 域文件经 update-check/source-ingestion 间接引用 electron(system/paths);按
// share.test.ts 的做法给最小 app mock,阻断真实 electron 解析。
// webContents.fromId 是 Agent 事件出口:各用例按 senderId 注入替身捕获 canonical 事件。
const { webContentsFromId } = vi.hoisted(() => ({ webContentsFromId: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/musefold-ds-domain-test' },
  webContents: { fromId: webContentsFromId },
}));

// GitHub 来源不走真实网络:只替换解析与固化两步(内存快照写入真实仓库表),历史来源等其余路径保持真实。
vi.mock('../../design-scheme/source-ingestion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../design-scheme/source-ingestion')>();
  let snapshotSeq = 0;
  return {
    ...original,
    resolveGithubSource: vi.fn(async (repositoryUrl: string) => ({
      ok: true as const,
      data: {
        repositoryUrl,
        repositoryLabel: original.repositoryLabelOf(repositoryUrl),
        name: repositoryUrl.split('/').filter(Boolean).at(-1) ?? 'repo',
        description: '极简 zine 海报 Skill',
        resolvedRef: 'main',
        commitHash: 'b'.repeat(40),
        license: 'MIT',
        textFiles: [
          {
            path: 'SKILL.md',
            contentHash: 'sha256:1',
            sizeBytes: 20,
            text: '# 海报规则\n双色印刷',
          },
        ],
        imageFiles: [],
        otherCount: 0,
      },
    })),
    persistGithubSnapshot: vi.fn((db: Database.Database, source: { repositoryUrl: string }) => {
      const repository = new DesignSchemeRepository(db);
      snapshotSeq += 1;
      return {
        packageId: `pkg_gh_${snapshotSeq}`,
        snapshotId: repository.saveSourceSnapshot({
          package: {
            id: `pkg_gh_${snapshotSeq}`,
            kind: 'github',
            repositoryUrl: source.repositoryUrl,
          },
          snapshot: {
            id: `snap_gh_${snapshotSeq}`,
            ref: 'main',
            commitHash: 'b'.repeat(40),
            totalBytes: 20,
            scan: {},
          },
          files: [
            {
              path: 'SKILL.md',
              kind: 'text',
              contentHash: 'sha256:1',
              sizeBytes: 20,
              textContent: '# 海报规则',
            },
          ],
        }).snapshotId,
        imagePaths: [],
      };
    }),
  };
});

import {
  buildDesignSchemesDomainMethods,
  DESIGN_SCHEME_AGENT_AI_UNAVAILABLE,
  DESIGN_SCHEME_AGENT_CREATION_INPUT_UNSUPPORTED,
  DESIGN_SCHEME_CREATE_INPUT_REQUIRED,
  DESIGN_SCHEME_EXECUTION_NOT_CONFIRMABLE,
  DESIGN_SCHEME_EXECUTION_NOT_FOUND,
  DESIGN_SCHEME_HISTORY_SOURCE_UNAVAILABLE,
  designSchemeEventChannel,
  parseDesignSchemeEvent,
  type DesignSchemeDomainDeps,
} from '../design-scheme-domain';
import { designSchemeExecutionRegistry } from '../../design-scheme/execution-registry';
import type {
  OpenAiCompatibleTextAdapter,
  TextCompletionRequest,
} from '../../design-scheme/text-adapter';
import { BridgeError } from '../envelope';

// ---------------------------------------------------------------------------
// 固定件
// ---------------------------------------------------------------------------

const CONTENT_HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const NOW_ISO = '2026-01-15T08:00:00.000Z';
const GITHUB_URI = 'https://github.com/acme/zine-kit';

/** 真实 PNG 字节(合法签名 + IHDR):懒回填的真实探测对象。 */
function realPngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

// 返回类型交给推断:defaults 字段(sourceSnapshotIds 等)由各调用点的 zod parse 补齐。
function canonicalDocument(
  revisionId: string,
  schemeId: string,
  overrides: Partial<DesignSchemeRevisionDocument> = {},
) {
  return {
    schemaVersion: 1,
    revisionId,
    schemeId,
    name: 'zine 封面方案',
    summary: '杂志风封面版式',
    fidelity: 'adapted',
    sources: [
      {
        id: 'srcb_main',
        kind: 'github-skill',
        role: 'normative',
        repositoryUrl: GITHUB_URI,
        resolvedRef: 'main',
        commitHash: COMMIT,
        contentHash: CONTENT_HASH,
      },
    ],
    sourceSnapshotIds: [`dssnap_${schemeId}`],
    inputs: [{ id: 'slot_topic', label: '主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'pm_open',
        order: 0,
        kind: 'input-template',
        template: '{{topic}} 的杂志封面',
        variables: ['topic'],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: NOW_ISO,
      model: { model: 'test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      briefExcerpt: '做一张 zine 封面',
      trace: [
        { id: 'trace_ok', kind: 'system', title: '编译完成', status: 'success', durationMs: 5 },
      ],
    },
    parentRevisionId: null,
    ...overrides,
  };
}

function canonicalSnapshot(suffix: string) {
  return {
    id: `dssnap_${suffix}`,
    packageId: `dspkg_${suffix}`,
    kind: 'github' as const,
    repositoryUrl: GITHUB_URI,
    resolvedRef: 'main',
    commitHash: COMMIT,
    totalBytes: 120,
    files: [
      {
        relativePath: 'SKILL.md',
        kind: 'text' as const,
        mimeType: 'text/markdown',
        sizeBytes: 120,
        contentHash: CONTENT_HASH,
        evidencePath: null,
        textExcerpt: '# zine kit',
      },
    ],
    createdAt: NOW_ISO,
  };
}

function createInputFixture(schemeId: string, revisionId: string, overrides = {}) {
  return {
    executionId: 'exec_create_1',
    brief: '做一张 zine 封面',
    sourceUris: [GITHUB_URI],
    sourceBindings: [
      {
        id: `srcb_snap_${schemeId}`,
        kind: 'github-skill' as const,
        role: 'normative' as const,
        snapshotId: `dssnap_${schemeId}`,
      },
    ],
    sourcePackages: [
      {
        id: `dspkg_${schemeId}`,
        kind: 'github' as const,
        repositoryUrl: GITHUB_URI,
        license: 'MIT',
        createdAt: NOW_ISO,
      },
    ],
    sourceSnapshots: [canonicalSnapshot(schemeId)],
    sourceAssetIds: [],
    document: canonicalDocument(revisionId, schemeId),
    ...overrides,
  };
}

/** Agent 创建的 renderer 严格入参:只有 brief / 历史来源身份,没有 document 与预解析来源。 */
function agentCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'exec_agent_create_1',
    brief: '做一套柔和水彩质感的活动海报方案',
    sourceUris: [],
    sourceBindings: [],
    sourceAssetIds: [],
    historySources: [],
    ...overrides,
  };
}

/** 仓库层种子用的 legacy 文档(promoteWorkingDraft 前置:applyAgentRevision)。 */
function legacyDocument(revisionId: string, schemeId: string): LegacyDocument {
  const binding: LegacySourceBinding = {
    id: 'srcb_main',
    kind: 'github-skill',
    role: 'normative',
    uri: GITHUB_URI,
    ref: 'main',
    commit: COMMIT,
    contentHash: CONTENT_HASH,
  };
  return {
    schemaVersion: 1,
    revisionId,
    schemeId,
    name: 'zine 封面方案',
    summary: '杂志风封面版式 v2',
    fidelity: 'adapted',
    sources: [binding],
    inputs: [{ id: 'slot_topic', label: '主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'pm_open',
        order: 0,
        kind: 'input-template',
        template: '{{topic}} 的杂志封面',
        variables: ['topic'],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: Date.parse(NOW_ISO),
      model: { model: 'test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

function legacyCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'mc_101',
    repositoryUrl: GITHUB_URI,
    fullName: 'acme/zine-kit',
    description: 'zine 排版 skill',
    license: 'MIT',
    ref: 'main',
    updatedAt: 1_750_000_000_000,
    stars: 12,
    topics: ['zine'],
    matchReason: '仓库描述包含 zine',
    riskSummary: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 驱动工具
// ---------------------------------------------------------------------------

type MethodName = keyof typeof DESIGN_SCHEME_WIRE_METHODS;

let db: Database.Database;
let coreDb: Database.Database;
let repo: DesignSchemeRepository;
let methods: ReturnType<typeof buildDesignSchemesDomainMethods>;
let searchMarket: ReturnType<typeof vi.fn>;
let checkUpdate: ReturnType<typeof vi.fn>;
let consumeStagedPackage: ReturnType<typeof vi.fn>;
let importPackage: ReturnType<typeof vi.fn>;
let exportPackage: ReturnType<typeof vi.fn>;
let showSaveDialog: ReturnType<typeof vi.fn>;
let resolveAgentAdapter: ReturnType<typeof vi.fn>;
let resolveUploadedReference: ReturnType<typeof vi.fn>;
let userDataDir: string;
let picturesDir: string;
let outsideManagedDir: string;

/** Compiler/Reviser 角色的结构化 JSON 替身(满足 desktop-contracts agents schema)。 */
const AGENT_COMPILED_JSON = JSON.stringify({
  name: 'Agent 水彩海报',
  summary: '柔和水彩质感的活动海报配方',
  fidelity: 'adapted',
  inputs: [
    { label: '主题', kind: 'text', required: true, variable: 'topic', description: '一句话主题' },
  ],
  constraints: [
    {
      domain: 'output',
      statement: '默认 3:4 竖版',
      mode: 'required',
      userOverridable: true,
      evidencePaths: [],
    },
  ],
  promptProgram: [
    { kind: 'input-template', template: '为「{{topic}}」画一幅水彩海报', variables: ['topic'] },
    { kind: 'style-rule', template: '柔和水彩,留白克制', variables: [] },
  ],
  adopted: ['水彩质感'],
  omitted: [],
  warnings: [],
  creationSummary: '已根据描述整理出可复用的水彩海报方案,请试运行验证。',
});

/** Repository Analyst 角色的结构化 JSON 替身(GitHub 来源路径)。 */
const AGENT_ANALYST_JSON = JSON.stringify({
  repoKind: 'agent-skill',
  capabilitySummary: '极简双色 zine 海报',
  rules: [
    { domain: 'color', statement: '只用两种油墨色', mode: 'required', evidencePaths: ['SKILL.md'] },
  ],
  variables: [{ label: '主题', kind: 'text', required: true }],
  referenceImages: [],
  unsupported: [],
  license: 'MIT',
});

/** 假文本适配器:按系统提示词角色返回固定 JSON;`fail` 时抛 401 模拟密钥失效。 */
function makeAgentAdapter(options: { fail?: boolean; onComplete?: () => void } = {}) {
  const complete = vi.fn(async (request: TextCompletionRequest) => {
    options.onComplete?.();
    if (request.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (options.fail) {
      throw Object.assign(new Error('AI 请求失败(401):invalid key'), { statusCode: 401 });
    }
    if (request.system.includes('仓库分析师')) {
      return { text: AGENT_ANALYST_JSON, model: 'test-text-model' };
    }
    return { text: AGENT_COMPILED_JSON, model: 'test-text-model' };
  });
  return {
    adapter: {
      modelId: 'test-text-model',
      connectionName: 'test-text-conn',
      complete,
    } as unknown as OpenAiCompatibleTextAdapter,
    complete,
  };
}

function wire() {
  searchMarket = vi.fn();
  checkUpdate = vi.fn();
  consumeStagedPackage = vi.fn(async (_ownerId, _input, consume) =>
    consume('/verified/package', Buffer.from('verified fixture bytes')),
  );
  importPackage = vi.fn();
  exportPackage = vi.fn();
  showSaveDialog = vi.fn();
  resolveAgentAdapter = vi.fn(() => makeAgentAdapter().adapter);
  resolveUploadedReference = vi.fn(() => null);
  const deps: DesignSchemeDomainDeps = {
    db,
    coreDb,
    searchMarket: searchMarket as unknown as NonNullable<DesignSchemeDomainDeps['searchMarket']>,
    checkUpdate: checkUpdate as unknown as NonNullable<DesignSchemeDomainDeps['checkUpdate']>,
    resolveAgentAdapter: resolveAgentAdapter as unknown as NonNullable<
      DesignSchemeDomainDeps['resolveAgentAdapter']
    >,
    resolveUploadedReference: resolveUploadedReference as unknown as NonNullable<
      DesignSchemeDomainDeps['resolveUploadedReference']
    >,
    consumeStagedPackage: consumeStagedPackage as unknown as NonNullable<
      DesignSchemeDomainDeps['consumeStagedPackage']
    >,
    importPackage: importPackage as unknown as NonNullable<DesignSchemeDomainDeps['importPackage']>,
    exportPackage: exportPackage as unknown as NonNullable<DesignSchemeDomainDeps['exportPackage']>,
    showSaveDialog: showSaveDialog as unknown as NonNullable<
      DesignSchemeDomainDeps['showSaveDialog']
    >,
    downloadsDir: userDataDir,
    userDataDir,
    picturesDir,
  };
  methods = buildDesignSchemesDomainMethods(deps);
}

// noExplicitAny 在 biome.json 中关闭;测试驱动层用 any 保持断言简洁。
async function invoke<T = any>(name: MethodName, payload: unknown, senderId?: number): Promise<T> {
  const def = methods[DESIGN_SCHEME_WIRE_METHODS[name]];
  return (await def.handle(def.input.parse(payload), senderId ? { senderId } : undefined)) as T;
}

/** 期待 BridgeError 的调用:返回错误对象并断言类型与消息非空。 */
async function invokeError(
  name: MethodName,
  payload: unknown,
  senderId?: number,
): Promise<BridgeError> {
  const def = methods[DESIGN_SCHEME_WIRE_METHODS[name]];
  try {
    await def.handle(def.input.parse(payload), senderId ? { senderId } : undefined);
  } catch (error) {
    expect(error, `designSchemes.${name} 应抛 BridgeError`).toBeInstanceOf(BridgeError);
    const bridgeError = error as BridgeError;
    expect(bridgeError.message.length).toBeGreaterThan(0);
    return bridgeError;
  }
  throw new Error(`designSchemes.${name} 应当失败,但成功返回`);
}

/** 与 invokeError 同,但跳过入参解析(供与入参无关的 blocker 用)。 */
async function invokeErrorRaw(name: MethodName): Promise<BridgeError> {
  const def = methods[DESIGN_SCHEME_WIRE_METHODS[name]];
  try {
    await def.handle({});
  } catch (error) {
    expect(error, `designSchemes.${name} 应抛 BridgeError`).toBeInstanceOf(BridgeError);
    return error as BridgeError;
  }
  throw new Error(`designSchemes.${name} 应当失败,但成功返回`);
}

function seedSuccessfulTrial(revisionId: string): void {
  const runId = `dsrun_${revisionId}`;
  repo.insertRun({ runId, revisionId, mode: 'trial', policy: {} });
  repo.updateRunStatus(runId, 'completed');
}

/** 走完整生命周期得到一个 formal 方案;返回封面资产与 formalize 后的版本号。 */
async function createFormalScheme(schemeId: string, revisionId: string) {
  await invoke('create', createInputFixture(schemeId, revisionId));
  seedSuccessfulTrial(revisionId);
  const assetId = repo.insertLocalRunAsset(revisionId, 'previews/cover.png');
  await invoke('selectCover', { schemeId, assetId, expectedVersion: 1 }); // version 1 → 2
  const formalized = await invoke('formalize', {
    schemeId,
    revisionId,
    coverAssetId: assetId,
    expectedVersion: 2,
    confirmed: true,
  }); // version 2 → 3
  return { assetId, formalized };
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'musefold-ds-get-'));
  picturesDir = join(userDataDir, 'Pictures');
  outsideManagedDir = mkdtempSync(join(tmpdir(), 'musefold-ds-outside-'));
  mkdirSync(picturesDir, { recursive: true });
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  repo = new DesignSchemeRepository(db);
  configureCoreRuntime({
    getPaths: () => ({
      userData: userDataDir,
      db: join(userDataDir, 'core.db'),
      backups: userDataDir,
      previews: userDataDir,
      pictures: picturesDir,
      logs: userDataDir,
    }),
    loadApiKey: () => null,
    createLogger: () => ({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    estimateProviderCost: () => null,
  });
  coreDb = new Database(':memory:');
  coreDb.pragma('foreign_keys = ON');
  runMigrations(coreDb);
  takeoverDesktopDatabase(coreDb);
  wire();
});

afterEach(() => {
  db.close();
  coreDb.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(outsideManagedDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 方法表与输入校验
// ---------------------------------------------------------------------------

describe('方法表', () => {
  it('逐名锁定为 deployed canonical 方法集(19 个,含永久删除且无旧通道残留)', () => {
    expect([...DESIGN_SCHEME_METHOD_NAMES]).toHaveLength(19);
    expect(Object.keys(methods).sort()).toEqual([...DESIGN_SCHEME_METHOD_NAMES].sort());
  });

  it('拒绝携带本地路径或凭据的入参(信封前的第一道闸)', () => {
    const create = methods[DESIGN_SCHEME_WIRE_METHODS.create];
    expect(() =>
      create.input.parse(
        createInputFixture('dsch_s', 'dsrv_s1', { sourceUris: ['file:///etc/passwd'] }),
      ),
    ).toThrow();
    expect(() =>
      create.input.parse(
        createInputFixture('dsch_s', 'dsrv_s1', {
          sourceUris: ['https://user:pass@github.com/acme/zine-kit'],
        }),
      ),
    ).toThrow();
    // rename.name 在 canonical 契约里是普通字符串(非 safeText),此处不设路径断言。
    expect(() => methods[DESIGN_SCHEME_WIRE_METHODS.get].input.parse({ id: '../etc' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------

describe('list', () => {
  it('空库返回空页', async () => {
    await expect(invoke('list', {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('按状态/关键词过滤并使用不透明 keyset 游标分页', async () => {
    await invoke('create', createInputFixture('dsch_a', 'dsrv_a1'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await invoke(
      'create',
      createInputFixture('dsch_b', 'dsrv_b1', {
        document: canonicalDocument('dsrv_b1', 'dsch_b', {
          name: '海报排版方案',
          summary: '展览海报版式',
        }),
      }),
    );

    const all = await invoke<{ items: Array<{ id: string }>; nextCursor: string | null }>(
      'list',
      {},
    );
    expect(all.items.map((item) => item.id).sort()).toEqual(['dsch_a', 'dsch_b']);
    expect(all.nextCursor).toBeNull();

    const formalOnly = await invoke<{ items: unknown[] }>('list', { status: 'formal' });
    expect(formalOnly.items).toEqual([]);

    // 「封面」只命中 dsch_a 的名称;sourceLabel(acme/zine-kit)不含该词。
    const zine = await invoke<{ items: Array<{ id: string }> }>('list', { query: '封面' });
    expect(zine.items.map((item) => item.id)).toEqual(['dsch_a']);

    const none = await invoke<{ items: unknown[] }>('list', { query: '不存在的词' });
    expect(none.items).toEqual([]);

    const page1 = await invoke<{ items: Array<{ id: string }>; nextCursor: string | null }>(
      'list',
      { limit: 1 },
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = await invoke<{ items: Array<{ id: string }>; nextCursor: string | null }>(
      'list',
      { limit: 1, cursor: page1.nextCursor },
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect([...page1.items, ...page2.items].map((item) => item.id).sort()).toEqual([
      'dsch_a',
      'dsch_b',
    ]);
  });

  it('已移除方案返回软删后的版本，活动列表隔离且拒绝旧式游标', async () => {
    await invoke('create', createInputFixture('dsch_removed', 'dsrv_removed'));
    await invoke('remove', { schemeId: 'dsch_removed', expectedVersion: 1 });
    expect((await invoke('list', {})).items).toEqual([]);
    expect((await invoke('list', { deletedOnly: true })).items).toMatchObject([
      { id: 'dsch_removed', version: 2 },
    ]);
    expect((await invoke('list', { deletedOnly: 'false' })).items).toEqual([]);
    await expect(invoke('list', { cursor: '1' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('get', () => {
  it('未知方案 → NOT_FOUND', async () => {
    expect((await invokeError('get', { id: 'dsch_ghost' })).code).toBe('NOT_FOUND');
  });

  it('v2.1 历史来源写过的 `history:<id>` 伪 URI 不阻断详情读取:降级丢弃,来源身份保留', async () => {
    const legacy = legacyDocument('dsrv_legacy_hist', 'dsch_legacy_hist');
    legacy.sources = [
      { id: 'src_brief', kind: 'user-brief', role: 'context' },
      { id: 'src_hist_1', kind: 'history-image', role: 'example', uri: 'history:hist_001' },
      {
        id: 'src_hist_1_prompt',
        kind: 'conversation-turn',
        role: 'context',
        uri: 'history:hist_001',
      },
    ];
    repo.insertSchemeDraft({
      document: legacy,
      sourceLabel: '历史 · 1 张图片',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });

    const detail = await invoke('get', { id: 'dsch_legacy_hist' });
    expect(() => designSchemeDetailSchema.parse(detail)).not.toThrow();
    expect(detail.document.sources).toEqual([
      { id: 'src_brief', kind: 'user-brief', role: 'context' },
      { id: 'src_hist_1', kind: 'history-image', role: 'example' },
      { id: 'src_hist_1_prompt', kind: 'conversation-turn', role: 'context' },
    ]);
    expect(JSON.stringify(detail)).not.toContain('history:');
  });

  it('详情过 canonical 契约:legacy 资产真实 PNG 懒回填,缺失资产省略,无路径泄漏', async () => {
    await invoke('create', createInputFixture('dsch_get', 'dsrv_g1'));
    // 四种 legacy 资产形态:受管绝对生图路径、managed 相对 storeKey、已缺失文件、根外文件。
    const png = realPngBuffer(320, 240);
    const storeKey = join('design-scheme-sources', 'snap_get', 'run.png');
    mkdirSync(join(userDataDir, 'design-scheme-sources', 'snap_get'), { recursive: true });
    writeFileSync(join(userDataDir, storeKey), png);
    const generatedPath = join(picturesDir, 'generated.png');
    writeFileSync(generatedPath, png);
    const outsidePath = join(outsideManagedDir, 'outside.png');
    writeFileSync(outsidePath, png);
    const absoluteId = repo.insertLocalRunAsset('dsrv_g1', generatedPath);
    const managedId = repo.insertLocalRunAsset('dsrv_g1', storeKey);
    const outsideId = repo.insertLocalRunAsset('dsrv_g1', outsidePath);
    const missingId = repo.insertLocalRunAsset(
      'dsrv_g1',
      join(userDataDir, 'design-scheme-sources', 'snap_get', 'gone.png'),
    );

    const detail = await invoke<{
      summary: { id: string };
      document: { revisionId: string };
      assets: Array<Record<string, unknown>>;
      sourceSnapshots: Array<{ files: Array<Record<string, unknown>> }>;
    }>('get', { id: 'dsch_get' });

    expect(() => designSchemeDetailSchema.parse(detail)).not.toThrow();
    expect(detail.summary.id).toBe('dsch_get');
    expect(detail.document.revisionId).toBe('dsrv_g1');
    // canonical 创建持久化的来源 mime/evidence 读回(mime 列,evidence 缺省 null)。
    const file = detail.sourceSnapshots[0].files[0];
    expect(file.mimeType).toBe('text/markdown');
    expect(file.evidencePath).toBeNull();
    // 真实探测回填的元数据;缺失文件资产被省略而不是伪造。
    expect(detail.assets.map((asset) => asset.id).sort()).toEqual([absoluteId, managedId].sort());
    for (const asset of detail.assets) {
      expect(asset).toMatchObject({
        mimeType: 'image/png',
        width: 320,
        height: 240,
        byteSize: png.byteLength,
        contentHash: createHash('sha256').update(png).digest('hex'),
        origin: 'local-run',
        role: 'example',
      });
    }
    expect(detail.assets.some((asset) => asset.id === missingId)).toBe(false);
    expect(detail.assets.some((asset) => asset.id === outsideId)).toBe(false);
    // 回填已持久化:DB 行从 NULL 变为探测值,下次读取无需再探测。
    expect(
      db
        .prepare('SELECT mime_type, width, height FROM design_scheme_assets WHERE id = ?')
        .get(managedId),
    ).toEqual({ mime_type: 'image/png', width: 320, height: 240 });
    // 出参 path-free:无 storeKey/本机路径泄漏。
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('storeKey');
    expect(serialized).not.toContain(userDataDir);
    expect(serialized).not.toContain('coverImagePath');
  });

  it('正式方案详情按 selector 区分 current 与 exact working draft', async () => {
    await createFormalScheme('dsch_detail_rev', 'dsrv_detail_1');
    repo.applyAgentRevision(
      'dsch_detail_rev',
      'dsrv_detail_1',
      legacyDocument('dsrv_detail_2', 'dsch_detail_rev'),
      [],
      3,
    );

    const current = await invoke<{ document: { revisionId: string } }>('get', {
      id: 'dsch_detail_rev',
      revision: { kind: 'current' },
    });
    expect(current.document.revisionId).toBe('dsrv_detail_1');

    const workingDraft = await invoke<{ document: { revisionId: string } }>('get', {
      id: 'dsch_detail_rev',
      revision: { kind: 'working-draft', revisionId: 'dsrv_detail_2' },
    });
    expect(workingDraft.document.revisionId).toBe('dsrv_detail_2');

    const mismatch = await invokeError('get', {
      id: 'dsch_detail_rev',
      revision: { kind: 'working-draft', revisionId: 'dsrv_detail_ghost' },
    });
    expect(mismatch.code).toBe('DESIGN_SCHEME_INVALID_STATE');
  });

  it('v6 新写入资产(已带元数据)直接映射,不再探测文件系统', async () => {
    await invoke('create', createInputFixture('dsch_get2', 'dsrv_g2'));
    const png = realPngBuffer(64, 64);
    repo.insertLocalRunAsset('dsrv_g2', '/definitely/not/probed.png', {
      mimeType: 'image/png',
      width: 64,
      height: 64,
      byteSize: png.byteLength,
      contentHash: createHash('sha256').update(png).digest('hex'),
    });
    const detail = await invoke<{ assets: Array<Record<string, unknown>> }>('get', {
      id: 'dsch_get2',
    });
    expect(detail.assets).toHaveLength(1);
    expect(detail.assets[0]).toMatchObject({ width: 64, height: 64, mimeType: 'image/png' });
  });

  it('不安全文本节选 → null 而不是毒化详情;非法 hash 的文件被省略', async () => {
    await invoke('create', createInputFixture('dsch_get3', 'dsrv_g3'));
    const saved = repo.saveSourceSnapshot({
      package: { id: 'pkg_excerpt', kind: 'github' },
      snapshot: { id: 'snap_excerpt', ref: 'main', commitHash: null, totalBytes: 2, scan: {} },
      files: [
        {
          path: 'notes.txt',
          kind: 'text',
          contentHash: CONTENT_HASH,
          sizeBytes: 18,
          textContent: '/Users/leak/secret', // 形似本地路径:canonical 安全校验拒绝
          mimeType: 'text/plain',
        },
        {
          path: 'broken.bin',
          kind: 'other',
          contentHash: 'not-a-hash', // 过不了 designSchemeHashSchema → 整条省略
          sizeBytes: 1,
        },
      ],
    });
    db.prepare(
      `INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
       VALUES ('dsrv_g3', ?, 'context')`,
    ).run(saved.snapshotId);

    const detail = await invoke<{
      sourceSnapshots: Array<{
        files: Array<{
          relativePath: string;
          textExcerpt: string | null;
          mimeType: string | null;
        }>;
      }>;
    }>('get', { id: 'dsch_get3' });
    expect(() => designSchemeDetailSchema.parse(detail)).not.toThrow();
    const excerptSnapshot = detail.sourceSnapshots.find((snapshot) =>
      snapshot.files.some((file) => file.relativePath === 'notes.txt'),
    );
    expect(excerptSnapshot).toBeDefined();
    const files = excerptSnapshot?.files ?? [];
    expect(files.map((item) => item.relativePath)).toEqual(['notes.txt']);
    expect(files[0].textExcerpt).toBeNull();
    expect(files[0].mimeType).toBe('text/plain');
  });
});

// ---------------------------------------------------------------------------
// create / update
// ---------------------------------------------------------------------------

describe('create', () => {
  it('落草稿并持久化来源元数据(出参满足 canonical 结果契约)', async () => {
    const def = methods[DESIGN_SCHEME_WIRE_METHODS.create];
    const parsed = def.input.parse(createInputFixture('dsch_ok', 'dsrv_ok1')) as any;
    const result = (await def.handle(parsed)) as any;

    expect(() => createDesignSchemeResultSchema.parse(result)).not.toThrow();
    expect(result.scheme).toMatchObject({
      id: 'dsch_ok',
      status: 'draft',
      version: 1,
      currentRevisionId: 'dsrv_ok1',
      sourcePresentation: 'skill',
      sourceLabel: 'acme/zine-kit',
      hasSuccessfulTrial: false,
      coverAssetId: null,
      workingDraftRevisionId: null,
    });
    expect(result.document).toEqual(parsed.document);
    expect(result.revisionId).toBe('dsrv_ok1');
    expect(result.trace).toEqual([]);

    // 来源快照/文件/绑定真的入库(相对路径形态,无本机绝对路径)。
    expect(db.prepare('SELECT count(*) AS n FROM source_snapshots').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM source_files').get()).toEqual({ n: 1 });
    expect(
      db
        .prepare(
          'SELECT source_snapshot_id AS sid, role FROM design_scheme_source_bindings WHERE revision_id = ?',
        )
        .get('dsrv_ok1'),
    ).toEqual({ sid: 'dssnap_dsch_ok', role: 'normative' });
  });

  it('无 GitHub 来源时来源展示记为 Musefold 创建', async () => {
    const document = canonicalDocument('dsrv_m1', 'dsch_muse', {
      sources: [{ id: 'srcb_brief', kind: 'user-brief', role: 'context' }],
    });
    const result = await invoke(
      'create',
      createInputFixture('dsch_muse', 'dsrv_m1', {
        document,
        sourceUris: [],
        sourceBindings: [],
        sourcePackages: [],
        sourceSnapshots: [],
      }),
    );
    expect(result.scheme.sourcePresentation).toBe('musefold-created');
    expect(result.scheme.sourceLabel).toBe('Musefold 创建');
  });

  it('重复 id → DESIGN_SCHEME_ALREADY_EXISTS', async () => {
    await invoke('create', createInputFixture('dsch_dup', 'dsrv_d1'));
    const error = await invokeError('create', createInputFixture('dsch_dup', 'dsrv_d2'));
    expect(error.code).toBe('DESIGN_SCHEME_ALREADY_EXISTS');
  });

  it('缺少已编译 document 且无 renderer 所有者 → 拒绝进入 Agent 管线', async () => {
    const error = await invokeError('create', agentCreateInput());
    expect(error.code).toBe('DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED');
    expect(error.code).not.toBe('DESIGN_SCHEME_UNAVAILABLE');
  });

  it('share-import 来源包 → 结构化拒绝且不留半成品方案', async () => {
    const base = createInputFixture('dsch_share', 'dsrv_sh1');
    const error = await invokeError('create', {
      ...base,
      sourcePackages: [{ ...base.sourcePackages[0], kind: 'share-import' as const }],
      sourceSnapshots: [{ ...canonicalSnapshot('dsch_share'), kind: 'share-import' as const }],
    });
    expect(error.code).toBe('DESIGN_SCHEME_CREATE_SOURCE_UNSUPPORTED');
    expect(
      db.prepare("SELECT count(*) AS n FROM design_schemes WHERE id = 'dsch_share'").get(),
    ).toEqual({ n: 0 });
  });

  it('historySources 按成功 run/available asset 从账本固化，并只读取账本提示词快照', async () => {
    const png = realPngBuffer(320, 240);
    const sourcePath = join(picturesDir, 'ledger-source.png');
    writeFileSync(sourcePath, png);
    const runs = new GenerationRunRepository(coreDb);
    runs.create({
      id: 'run_history_ok',
      providerId: 'provider-test',
      model: 'test-model',
      basePrompt: 'base prompt',
      finalPrompt: 'ledger final prompt',
      userPrompt: 'user prompt',
      params: { schemaVersion: 1 },
      promptSnapshot: {
        schemaVersion: 1,
        userPrompt: 'user prompt',
        basePrompt: 'base prompt',
        refinementInstruction: null,
        finalPrompt: 'ledger snapshot prompt',
        negativePrompt: null,
      },
    });
    runs.start('run_history_ok');
    runs.complete('run_history_ok', {
      assets: [{ id: 'asset_history_ok', mediaPath: sourcePath, mimeType: 'image/png' }],
    });
    expect(runs.getAsset('asset_history_ok')).toMatchObject({
      runId: 'run_history_ok',
      status: 'available',
      mediaPath: sourcePath,
    });

    const result = await invoke<{ document: DesignSchemeRevisionDocument }>(
      'create',
      createInputFixture('dsch_hist_ok', 'dsrv_hist_ok', {
        historySources: [
          { runId: 'run_history_ok', assetId: 'asset_history_ok', includePrompt: true },
        ],
        document: canonicalDocument('dsrv_hist_ok', 'dsch_hist_ok', {
          sources: [],
          sourceSnapshotIds: [],
        }),
      }),
    );

    expect(result.document.sourceSnapshotIds).toHaveLength(1);
    expect(result.document.sources).toEqual([
      expect.objectContaining({
        kind: 'history-image',
        role: 'example',
        packageId: expect.stringMatching(/^pkg_hist_/),
        snapshotId: expect.stringMatching(/^snap_/),
      }),
      expect.objectContaining({ kind: 'conversation-turn', role: 'context' }),
    ]);
    expect(result.document.sources[1]).not.toHaveProperty('promptText');
    const detail = await invoke<{
      sourceSnapshots: Array<{
        kind: string;
        files: Array<{ textExcerpt: string | null }>;
      }>;
    }>('get', { id: 'dsch_hist_ok' });
    const historySnapshot = detail.sourceSnapshots.find((snapshot) => snapshot.kind === 'history');
    expect(historySnapshot?.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ textExcerpt: 'ledger snapshot prompt' })]),
    );
    expect(JSON.stringify(result)).not.toContain(sourcePath);
  });

  it('历史快照已固化但后续来源校验失败时清理全部半成品', async () => {
    const sourcePath = join(picturesDir, 'ledger-cleanup.png');
    writeFileSync(sourcePath, realPngBuffer(320, 240));
    const runs = new GenerationRunRepository(coreDb);
    runs.create({
      id: 'run_history_cleanup',
      providerId: 'provider-test',
      model: 'test-model',
      basePrompt: 'base prompt',
      finalPrompt: 'final prompt',
      params: { schemaVersion: 1 },
    });
    runs.start('run_history_cleanup');
    runs.complete('run_history_cleanup', {
      assets: [{ id: 'asset_history_cleanup', mediaPath: sourcePath, mimeType: 'image/png' }],
    });
    const base = createInputFixture('dsch_hist_cleanup', 'dsrv_hist_cleanup', {
      historySources: [
        { runId: 'run_history_cleanup', assetId: 'asset_history_cleanup', includePrompt: false },
      ],
      document: canonicalDocument('dsrv_hist_cleanup', 'dsch_hist_cleanup', {
        sources: [],
        sourceSnapshotIds: [],
      }),
    });

    const error = await invokeError('create', {
      ...base,
      sourcePackages: [{ ...base.sourcePackages[0], kind: 'share-import' as const }],
      sourceSnapshots: [
        { ...canonicalSnapshot('dsch_hist_cleanup'), kind: 'share-import' as const },
      ],
    });

    expect(error.code).toBe('DESIGN_SCHEME_CREATE_SOURCE_UNSUPPORTED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_packages').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_files').get()).toEqual({ n: 0 });
    expect(readdirSync(join(userDataDir, 'design-scheme-sources'))).toEqual([]);
  });

  it.each([
    ['missing run', 'run_history_missing', 'asset_history_ok'],
    ['cross-run asset', 'run_history_ok', 'asset_history_foreign'],
  ])('%s → fail closed without scheme or snapshot', async (_label, runId, assetId) => {
    const error = await invokeError(
      'create',
      createInputFixture(`dsch_hist_${runId}`, `dsrv_hist_${runId}`, {
        historySources: [{ runId, assetId, includePrompt: true }],
      }),
    );
    expect(error.code).toBe(DESIGN_SCHEME_HISTORY_SOURCE_UNAVAILABLE);
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get()).toEqual({ n: 0 });
  });

  it('失败 run、软删除 run、不可用 asset 和盘外路径全部拒绝', async () => {
    const runs = new GenerationRunRepository(coreDb);
    const seed = (
      runId: string,
      status: 'failed' | 'success',
      deletedAt: number | null,
      assetId: string,
      mediaPath: string,
      assetStatus = 'available',
    ) => {
      runs.create({
        id: runId,
        providerId: 'p',
        model: 'm',
        basePrompt: 'b',
        finalPrompt: 'f',
        params: { schemaVersion: 1 },
      });
      runs.start(runId);
      if (status === 'failed') runs.fail(runId, 'FAILED', 'failed');
      else
        runs.complete(runId, {
          assets: [{ id: assetId, mediaPath, status: assetStatus as 'available' }],
        });
      if (deletedAt !== null)
        coreDb
          .prepare('UPDATE generation_runs SET deleted_at = ? WHERE id = ?')
          .run(deletedAt, runId);
    };
    seed('run_history_failed', 'failed', null, 'asset_failed', join(picturesDir, 'missing.png'));
    seed(
      'run_history_deleted',
      'success',
      Date.now(),
      'asset_deleted',
      join(picturesDir, 'missing.png'),
    );
    seed(
      'run_history_unavailable',
      'success',
      null,
      'asset_unavailable',
      join(picturesDir, 'missing.png'),
      'missing',
    );
    const outside = join(outsideManagedDir, 'outside.png');
    writeFileSync(outside, realPngBuffer(32, 32));
    seed('run_history_outside', 'success', null, 'asset_outside', outside);

    for (const [runId, assetId] of [
      ['run_history_failed', 'asset_failed'],
      ['run_history_deleted', 'asset_deleted'],
      ['run_history_unavailable', 'asset_unavailable'],
      ['run_history_outside', 'asset_outside'],
    ]) {
      const error = await invokeError(
        'create',
        createInputFixture(`dsch_${runId}`, `dsrv_${runId}`, {
          historySources: [{ runId, assetId, includePrompt: false }],
        }),
      );
      expect(error.code).toBe(DESIGN_SCHEME_HISTORY_SOURCE_UNAVAILABLE);
    }
  });
});

// ---------------------------------------------------------------------------
// Agent 创建 / 修改(P01-10):保留的 v2.1 会话经 canonical adapter 驾驭
// ---------------------------------------------------------------------------

const AGENT_SENDER = 41;

/** 订阅域向 renderer 发出的 canonical 事件(webContents.fromId 替身)。 */
function captureEvents(senderId: number) {
  const events: unknown[] = [];
  const send = vi.fn((_channel: string, payload: unknown) => {
    events.push(payload);
  });
  webContentsFromId.mockImplementation((id: number) =>
    id === senderId ? { isDestroyed: () => false, send } : undefined,
  );
  return { events, send };
}

describe('create(Agent 管线,无 document)', () => {
  beforeEach(() => {
    designSchemeExecutionRegistry.cleanupAll();
  });

  it('brief → Compiler 编译 → 落草稿;返回 canonical 结果并按序发出 creation 事件', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    const result = await invoke('create', agentCreateInput(), AGENT_SENDER);

    expect(() => createDesignSchemeResultSchema.parse(result)).not.toThrow();
    expect(result.scheme).toMatchObject({
      status: 'draft',
      name: 'Agent 水彩海报',
      sourcePresentation: 'musefold-created',
      sourceLabel: 'Musefold 创建',
    });
    expect(result.document.revisionId).toBe(result.revisionId);
    expect(result.document.inputs).toEqual([
      expect.objectContaining({ id: 'topic', label: '主题', kind: 'text', required: true }),
    ]);
    expect(result.document.sources).toEqual([
      expect.objectContaining({ id: 'src_brief', kind: 'user-brief', role: 'context' }),
    ]);
    expect(result.creationSummary).toContain('水彩海报方案');
    expect(result.trace.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['compiler', 'save-draft', 'creation-summary']),
    );
    // 方案确实落库且可经 get 读回。
    expect(repo.requireSummary(result.scheme.id).status).toBe('draft');

    const kinds = events.map((event) => parseDesignSchemeEvent(event).kind);
    expect(kinds[0]).toBe('state');
    expect(kinds).toContain('trace');
    expect(kinds.at(-1)).toBe('draft-ready');
    const states = events
      .map((event) => parseDesignSchemeEvent(event))
      .flatMap((event) => (event.kind === 'state' ? [event.state] : []));
    expect(states).toEqual(['created', 'compiling_scheme', 'draft_ready']);
    const draftReady = events.map((event) => parseDesignSchemeEvent(event)).at(-1);
    expect(draftReady?.kind === 'draft-ready' && draftReady.result.revisionId).toBe(
      result.revisionId,
    );
    // 事件与返回值绝不含本地路径。
    expect(JSON.stringify(events)).not.toContain(userDataDir);
    expect(JSON.stringify(result)).not.toContain(userDataDir);
  });

  it('历史来源随 Agent 创建固化为 example 来源,提示词只取账本快照', async () => {
    const sourcePath = join(picturesDir, 'agent-history.png');
    writeFileSync(sourcePath, realPngBuffer(320, 240));
    const runs = new GenerationRunRepository(coreDb);
    runs.create({
      id: 'run_agent_history',
      providerId: 'provider-test',
      model: 'test-model',
      basePrompt: 'base prompt',
      finalPrompt: 'ledger final prompt',
      params: { schemaVersion: 1 },
      promptSnapshot: {
        schemaVersion: 1,
        userPrompt: 'user prompt',
        basePrompt: 'base prompt',
        refinementInstruction: null,
        finalPrompt: 'agent snapshot prompt',
        negativePrompt: null,
      },
    });
    runs.start('run_agent_history');
    runs.complete('run_agent_history', {
      assets: [{ id: 'asset_agent_history', mediaPath: sourcePath, mimeType: 'image/png' }],
    });
    captureEvents(AGENT_SENDER);

    const result = await invoke(
      'create',
      agentCreateInput({
        historySources: [
          { runId: 'run_agent_history', assetId: 'asset_agent_history', includePrompt: true },
        ],
      }),
      AGENT_SENDER,
    );

    expect(result.scheme.sourceLabel).toBe('历史 · 1 张图片');
    expect(result.document.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user-brief', role: 'context' }),
        expect.objectContaining({ kind: 'history-image', role: 'example' }),
        expect.objectContaining({ kind: 'conversation-turn', role: 'context' }),
      ]),
    );
    const detail = await invoke('get', { id: result.scheme.id });
    const historySnapshot = detail.sourceSnapshots.find(
      (snapshot: { kind: string }) => snapshot.kind === 'history',
    );
    expect(historySnapshot?.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ textExcerpt: 'agent snapshot prompt' })]),
    );
    expect(JSON.stringify(result)).not.toContain(sourcePath);
  });

  it('历史来源不可用时在启动 Agent 前拒绝(不消耗模型调用)', async () => {
    captureEvents(AGENT_SENDER);
    const { adapter, complete } = makeAgentAdapter();
    resolveAgentAdapter.mockReturnValue(adapter);
    const error = await invokeError(
      'create',
      agentCreateInput({
        historySources: [{ runId: 'run_missing', assetId: 'asset_missing', includePrompt: false }],
      }),
      AGENT_SENDER,
    );
    expect(error.code).toBe(DESIGN_SCHEME_HISTORY_SOURCE_UNAVAILABLE);
    expect(complete).not.toHaveBeenCalled();
  });

  it('无可用 Agent 文本连接 → 结构化 blocker + canonical failed 事件(configure-ai)', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    resolveAgentAdapter.mockReturnValue(null);
    const error = await invokeError('create', agentCreateInput(), AGENT_SENDER);
    expect(error.code).toBe(DESIGN_SCHEME_AGENT_AI_UNAVAILABLE);
    expect(error.message).toContain('文本模型');
    const failed = events.map((event) => parseDesignSchemeEvent(event)).at(-1);
    expect(failed).toMatchObject({
      kind: 'failed',
      executionId: 'exec_agent_create_1',
      error: { code: DESIGN_SCHEME_AGENT_AI_UNAVAILABLE, recoveryAction: 'configure-ai' },
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
  });

  it('模型 401 → 会话失败:failed 事件与 BridgeError 同码(AUTH_REQUIRED),不留半成品', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    resolveAgentAdapter.mockReturnValue(makeAgentAdapter({ fail: true }).adapter);
    const error = await invokeError('create', agentCreateInput(), AGENT_SENDER);
    expect(error.code).toBe('AUTH_REQUIRED');
    const failed = events.map((event) => parseDesignSchemeEvent(event)).at(-1);
    expect(failed).toMatchObject({
      kind: 'failed',
      error: { code: 'AUTH_REQUIRED', recoveryAction: 'configure-ai' },
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
  });

  it('GitHub 来源:解析后发 confirmation-required 并停住;confirmInstall(install) 后 Analyst → Compiler 落 skill 草稿', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    const { adapter, complete } = makeAgentAdapter();
    resolveAgentAdapter.mockReturnValue(adapter);
    const parsed = () => events.map((event) => parseDesignSchemeEvent(event));

    const running = invoke('create', agentCreateInput({ sourceUris: [GITHUB_URI] }), AGENT_SENDER);
    await vi.waitFor(() =>
      expect(parsed().map((event) => event.kind)).toContain('confirmation-required'),
    );
    // 用户未确认前不得调用任何模型,也不得固化快照。
    expect(complete).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get()).toEqual({ n: 0 });
    const confirmation = parsed().find((event) => event.kind === 'confirmation-required');
    expect(confirmation?.kind === 'confirmation-required' && confirmation.source).toMatchObject({
      repositoryUrl: GITHUB_URI,
      name: 'zine-kit',
      resolvedRef: 'main',
      commitHash: COMMIT,
      textFileCount: 1,
      textNames: ['SKILL.md'],
      imageFileCount: 0,
      license: 'MIT',
    });
    expect(parsed().flatMap((event) => (event.kind === 'state' ? [event.state] : []))).toEqual([
      'created',
      'source_resolving',
      'awaiting_install_confirmation',
    ]);

    const accepted = await invoke(
      'confirmInstall',
      { executionId: 'exec_agent_create_1', decision: 'install' },
      AGENT_SENDER,
    );
    expect(accepted).toEqual({ executionId: 'exec_agent_create_1', status: 'accepted' });

    const result = await running;
    expect(() => createDesignSchemeResultSchema.parse(result)).not.toThrow();
    expect(result.scheme).toMatchObject({
      status: 'draft',
      sourcePresentation: 'skill',
      sourceLabel: 'acme/zine-kit',
    });
    expect(result.document.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'src_repo',
          kind: 'github-skill',
          role: 'normative',
          uri: GITHUB_URI,
          resolvedRef: 'main',
          commitHash: COMMIT,
          license: 'MIT',
        }),
      ]),
    );
    expect(result.document.sourceSnapshotIds).toHaveLength(1);
    expect(complete.mock.calls.map(([request]) => request.system.includes('仓库分析师'))).toEqual([
      true,
      false,
    ]);
    expect(parsed().flatMap((event) => (event.kind === 'state' ? [event.state] : []))).toEqual([
      'created',
      'source_resolving',
      'awaiting_install_confirmation',
      'source_snapshotting',
      'analyzing',
      'compiling_scheme',
      'draft_ready',
    ]);
    // 后续对已终态执行再确认 → already-terminal,不报错。
    await expect(
      invoke(
        'confirmInstall',
        { executionId: 'exec_agent_create_1', decision: 'install' },
        AGENT_SENDER,
      ),
    ).resolves.toEqual({ executionId: 'exec_agent_create_1', status: 'already-terminal' });
  });

  it('GitHub 来源:confirmInstall(cancel) → 会话取消、cancelled 事件,不固化快照也不留方案', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    const { adapter, complete } = makeAgentAdapter();
    resolveAgentAdapter.mockReturnValue(adapter);

    const running = invoke(
      'create',
      agentCreateInput({ sourceUris: [GITHUB_URI] }),
      AGENT_SENDER,
    ).catch((error: unknown) => error);
    await vi.waitFor(() =>
      expect(events.map((event) => parseDesignSchemeEvent(event).kind)).toContain(
        'confirmation-required',
      ),
    );
    const declined = await invoke(
      'confirmInstall',
      { executionId: 'exec_agent_create_1', decision: 'cancel' },
      AGENT_SENDER,
    );
    expect(declined).toEqual({ executionId: 'exec_agent_create_1', status: 'cancelled' });

    const outcome = (await running) as BridgeError;
    expect(outcome).toBeInstanceOf(BridgeError);
    expect(outcome.code).toBe('CANCELLED');
    expect(events.map((event) => parseDesignSchemeEvent(event)).at(-1)).toMatchObject({
      kind: 'cancelled',
      executionId: 'exec_agent_create_1',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
  });

  it('confirmInstall:未知执行 → NOT_FOUND;无所有者 → OWNER_REQUIRED;其他窗口的执行不可见', async () => {
    expect(
      (
        await invokeError(
          'confirmInstall',
          { executionId: 'exec_ghost', decision: 'install' },
          AGENT_SENDER,
        )
      ).code,
    ).toBe(DESIGN_SCHEME_EXECUTION_NOT_FOUND);
    expect(
      (await invokeError('confirmInstall', { executionId: 'exec_ghost', decision: 'install' }))
        .code,
    ).toBe('DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED');

    captureEvents(AGENT_SENDER);
    resolveAgentAdapter.mockReturnValue(makeAgentAdapter().adapter);
    const running = invoke(
      'create',
      agentCreateInput({ sourceUris: [GITHUB_URI] }),
      AGENT_SENDER,
    ).catch((error: unknown) => error);
    await vi.waitFor(() =>
      expect(designSchemeExecutionRegistry.get(AGENT_SENDER, 'exec_agent_create_1').status).toBe(
        'active',
      ),
    );
    const foreign = await invokeError(
      'confirmInstall',
      { executionId: 'exec_agent_create_1', decision: 'install' },
      AGENT_SENDER + 1,
    );
    expect(foreign.code).toBe(DESIGN_SCHEME_EXECUTION_NOT_FOUND);
    await invoke('cancel', { executionId: 'exec_agent_create_1' }, AGENT_SENDER);
    await running;
  });

  it('无 document 却夹带预解析来源快照/资产 → 拒绝(那是确定性建库入参)', async () => {
    const base = createInputFixture('dsch_mixed', 'dsrv_mixed', { document: undefined });
    const error = await invokeError('create', { ...base, sourceUris: [] }, AGENT_SENDER);
    expect(error.code).toBe(DESIGN_SCHEME_AGENT_CREATION_INPUT_UNSUPPORTED);
  });

  it('既无 brief 也无来源 → 拒绝', async () => {
    const error = await invokeError('create', agentCreateInput({ brief: '   ' }), AGENT_SENDER);
    expect(error.code).toBe(DESIGN_SCHEME_CREATE_INPUT_REQUIRED);
  });

  it('同一 executionId 的执行进行中时重复提交 → DUPLICATE;取消经 cancel 生效并发 cancelled 事件', async () => {
    const { events } = captureEvents(AGENT_SENDER);
    let releaseModel!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const adapter = {
      modelId: 'slow-model',
      connectionName: 'slow',
      complete: async (request: TextCompletionRequest) => {
        await gate;
        if (request.signal?.aborted) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        return { text: AGENT_COMPILED_JSON, model: 'slow-model' };
      },
    } as unknown as OpenAiCompatibleTextAdapter;
    resolveAgentAdapter.mockReturnValue(adapter);

    const running = invoke('create', agentCreateInput(), AGENT_SENDER).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() =>
      expect(events.map((event) => parseDesignSchemeEvent(event).kind)).toContain('trace'),
    );
    const duplicate = await invokeError('create', agentCreateInput(), AGENT_SENDER);
    expect(duplicate.code).toBe('DESIGN_SCHEME_EXECUTION_DUPLICATE');

    const cancelled = await invoke('cancel', { executionId: 'exec_agent_create_1' }, AGENT_SENDER);
    expect(cancelled).toEqual({ executionId: 'exec_agent_create_1', status: 'cancelled' });
    releaseModel();
    const outcome = (await running) as BridgeError;
    expect(outcome).toBeInstanceOf(BridgeError);
    expect(outcome.code).toBe('CANCELLED');
    expect(events.map((event) => parseDesignSchemeEvent(event)).at(-1)).toMatchObject({
      kind: 'cancelled',
      executionId: 'exec_agent_create_1',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual({ n: 0 });
  });
});

describe('modify(Agent 管线)', () => {
  beforeEach(() => {
    designSchemeExecutionRegistry.cleanupAll();
  });

  it('草稿方案:Reviser 产出直接替换当前版本;返回 canonical 结果并发 draft-ready', async () => {
    await invoke('create', createInputFixture('dsch_mod_draft', 'dsrv_md1'));
    const { events } = captureEvents(AGENT_SENDER);

    const result = await invoke(
      'modify',
      {
        executionId: 'exec_agent_modify_1',
        schemeId: 'dsch_mod_draft',
        baseRevisionId: 'dsrv_md1',
        instruction: '把默认比例改成 3:4',
      },
      AGENT_SENDER,
    );

    expect(() => createDesignSchemeResultSchema.parse(result)).not.toThrow();
    expect(result.scheme.id).toBe('dsch_mod_draft');
    expect(result.scheme.status).toBe('draft');
    expect(result.scheme.currentRevisionId).toBe(result.revisionId);
    expect(result.revisionId).not.toBe('dsrv_md1');
    expect(result.document.name).toBe('Agent 水彩海报');
    expect(result.document.parentRevisionId).toBe('dsrv_md1');
    expect(result.document.createdBy).toBe('agent');
    expect(result.creationSummary).toContain('水彩海报方案');
    expect(events.map((event) => parseDesignSchemeEvent(event).kind).at(-1)).toBe('draft-ready');
  });

  it('正式方案:新版本作为待验证草稿保存,正式版本保持可用', async () => {
    await createFormalScheme('dsch_mod_formal', 'dsrv_mf1');
    captureEvents(AGENT_SENDER);

    const result = await invoke(
      'modify',
      {
        executionId: 'exec_agent_modify_2',
        schemeId: 'dsch_mod_formal',
        baseRevisionId: 'dsrv_mf1',
        instruction: '加宽标题区域',
      },
      AGENT_SENDER,
    );

    expect(result.scheme.status).toBe('formal');
    expect(result.scheme.currentRevisionId).toBe('dsrv_mf1');
    expect(result.scheme.workingDraftRevisionId).toBe(result.revisionId);
    expect(result.document.revisionId).toBe(result.revisionId);
  });

  it('修改执行没有安装确认步骤:进行中对其 confirmInstall → NOT_CONFIRMABLE,执行不受影响', async () => {
    await invoke('create', createInputFixture('dsch_mod_confirm', 'dsrv_mc1'));
    captureEvents(AGENT_SENDER);
    let releaseModel!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    resolveAgentAdapter.mockReturnValue({
      modelId: 'slow-model',
      connectionName: 'slow',
      complete: async () => {
        await gate;
        return { text: AGENT_COMPILED_JSON, model: 'slow-model' };
      },
    } as unknown as OpenAiCompatibleTextAdapter);

    const running = invoke(
      'modify',
      {
        executionId: 'exec_agent_modify_confirm',
        schemeId: 'dsch_mod_confirm',
        baseRevisionId: 'dsrv_mc1',
        instruction: '改一下',
      },
      AGENT_SENDER,
    );
    await vi.waitFor(() =>
      expect(
        designSchemeExecutionRegistry.get(AGENT_SENDER, 'exec_agent_modify_confirm').status,
      ).toBe('active'),
    );
    const error = await invokeError(
      'confirmInstall',
      { executionId: 'exec_agent_modify_confirm', decision: 'install' },
      AGENT_SENDER,
    );
    expect(error.code).toBe(DESIGN_SCHEME_EXECUTION_NOT_CONFIRMABLE);
    releaseModel();
    expect((await running).scheme.id).toBe('dsch_mod_confirm');
  });

  it('基线不是当前版本/待验证草稿 → INVALID_STATE,不调用模型', async () => {
    await invoke('create', createInputFixture('dsch_mod_stale', 'dsrv_ms1'));
    const { adapter, complete } = makeAgentAdapter();
    resolveAgentAdapter.mockReturnValue(adapter);
    const error = await invokeError(
      'modify',
      {
        executionId: 'exec_agent_modify_3',
        schemeId: 'dsch_mod_stale',
        baseRevisionId: 'dsrv_someone_else',
        instruction: '改一下',
      },
      AGENT_SENDER,
    );
    expect(error.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(complete).not.toHaveBeenCalled();
  });

  it('方案不存在 → NOT_FOUND;无所有者 → OWNER_REQUIRED;无文本连接 → AGENT_AI_UNAVAILABLE', async () => {
    const payload = {
      executionId: 'exec_agent_modify_4',
      schemeId: 'dsch_nope',
      baseRevisionId: 'dsrv_nope',
      instruction: '改一下',
    };
    expect((await invokeError('modify', payload, AGENT_SENDER)).code).toBe('NOT_FOUND');
    expect((await invokeError('modify', payload)).code).toBe(
      'DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED',
    );

    await invoke('create', createInputFixture('dsch_mod_noai', 'dsrv_mn1'));
    captureEvents(AGENT_SENDER);
    resolveAgentAdapter.mockReturnValue(null);
    const error = await invokeError(
      'modify',
      { ...payload, schemeId: 'dsch_mod_noai', baseRevisionId: 'dsrv_mn1' },
      AGENT_SENDER,
    );
    expect(error.code).toBe(DESIGN_SCHEME_AGENT_AI_UNAVAILABLE);
  });
});

describe('update', () => {
  async function createForUpdate() {
    await invoke('create', createInputFixture('dsch_upd', 'dsrv_v1'));
  }

  it('提交新版本文档:草稿当前版本前移,来源别名无损读回', async () => {
    await createForUpdate();
    const result = await invoke<{
      scheme: Record<string, unknown>;
      document: DesignSchemeRevisionDocument;
    }>('update', {
      schemeId: 'dsch_upd',
      baseRevisionId: 'dsrv_v1',
      expectedVersion: 1,
      document: canonicalDocument('dsrv_v2', 'dsch_upd', {
        summary: '杂志风封面版式 v2',
        parentRevisionId: 'dsrv_v1',
      }),
    });

    expect(result.scheme).toMatchObject({
      version: 2,
      currentRevisionId: 'dsrv_v2',
      status: 'draft',
    });
    expect(result.document.revisionId).toBe('dsrv_v2');
    // legacy 往返:canonical 写入别名(repositoryUrl/resolvedRef/commitHash)以 legacy
    // 读回形态(uri/resolvedRef/commitHash)呈现,同为 canonical 合法别名。
    expect(result.document.sources[0]).toMatchObject({
      uri: GITHUB_URI,
      resolvedRef: 'main',
      commitHash: COMMIT,
      contentHash: CONTENT_HASH,
    });
    expect(typeof result.document.compilation.compiledAt).toBe('number');
    expect(result.document.compilation.trace[0]).toMatchObject({
      title: '编译完成',
      status: 'success',
    });
  });

  it('过期版本号 → DESIGN_SCHEME_VERSION_CONFLICT', async () => {
    await createForUpdate();
    await invoke('update', {
      schemeId: 'dsch_upd',
      baseRevisionId: 'dsrv_v1',
      expectedVersion: 1,
      document: canonicalDocument('dsrv_v2', 'dsch_upd', { parentRevisionId: 'dsrv_v1' }),
    });
    const error = await invokeError('update', {
      schemeId: 'dsch_upd',
      baseRevisionId: 'dsrv_v2',
      expectedVersion: 1,
      document: canonicalDocument('dsrv_v3', 'dsch_upd', { parentRevisionId: 'dsrv_v2' }),
    });
    expect(error.code).toBe('DESIGN_SCHEME_VERSION_CONFLICT');
  });

  it('过期基线 → INVALID_STATE;未知方案 → NOT_FOUND', async () => {
    await createForUpdate();
    expect(
      (
        await invokeError('update', {
          schemeId: 'dsch_upd',
          baseRevisionId: 'dsrv_stale',
          expectedVersion: 1,
          document: canonicalDocument('dsrv_v2', 'dsch_upd', { parentRevisionId: 'dsrv_stale' }),
        })
      ).code,
    ).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(
      (
        await invokeError('update', {
          schemeId: 'dsch_ghost',
          baseRevisionId: 'dsrv_v1',
          expectedVersion: 1,
          document: canonicalDocument('dsrv_v2', 'dsch_ghost', { parentRevisionId: 'dsrv_v1' }),
        })
      ).code,
    ).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// rename / remove / selectCover / formalize / promoteWorkingDraft
// ---------------------------------------------------------------------------

describe('rename', () => {
  it('改名成功并递增版本;超 80 字符给结构化 NAME_TOO_LONG', async () => {
    await invoke('create', createInputFixture('dsch_rn', 'dsrv_r1'));
    const result = await invoke('rename', {
      schemeId: 'dsch_rn',
      name: '新名字',
      expectedVersion: 1,
    });
    expect(result.scheme.name).toBe('新名字');
    expect(result.scheme.version).toBe(2);

    const tooLong = await invokeError('rename', {
      schemeId: 'dsch_rn',
      name: '长'.repeat(81),
      expectedVersion: 2,
    });
    expect(tooLong.code).toBe('DESIGN_SCHEME_NAME_TOO_LONG');
    expect(tooLong.message).toContain('80');
  });

  it('未知方案 → NOT_FOUND;过期版本 → VERSION_CONFLICT', async () => {
    await invoke('create', createInputFixture('dsch_rn2', 'dsrv_r2'));
    expect(
      (await invokeError('rename', { schemeId: 'dsch_ghost', name: 'x', expectedVersion: 1 })).code,
    ).toBe('NOT_FOUND');
    expect(
      (await invokeError('rename', { schemeId: 'dsch_rn2', name: 'y', expectedVersion: 99 })).code,
    ).toBe('DESIGN_SCHEME_VERSION_CONFLICT');
  });
});

describe('remove', () => {
  it('软删除后列表消失,重复删除 → NOT_FOUND', async () => {
    await invoke('create', createInputFixture('dsch_rm', 'dsrv_rm1'));
    await expect(invoke('remove', { schemeId: 'dsch_rm', expectedVersion: 1 })).resolves.toEqual({
      schemeId: 'dsch_rm',
      removed: true,
    });
    expect((await invoke('list', {})).items).toEqual([]);
    expect((await invokeError('remove', { schemeId: 'dsch_rm', expectedVersion: 2 })).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('purge', () => {
  it('requires the removed version and returns the same committed receipt on replay', async () => {
    await invoke('create', createInputFixture('dsch_purge', 'dsrv_purge'));
    expect((await invokeError('purge', { schemeId: 'dsch_purge', expectedVersion: 1 })).code).toBe(
      'DESIGN_SCHEME_INVALID_STATE',
    );
    await invoke('remove', { schemeId: 'dsch_purge', expectedVersion: 1 });
    expect((await invokeError('purge', { schemeId: 'dsch_purge', expectedVersion: 1 })).code).toBe(
      'DESIGN_SCHEME_VERSION_CONFLICT',
    );
    const result = await invoke('purge', { schemeId: 'dsch_purge', expectedVersion: 2 });
    expect(result).toEqual({
      schemeId: 'dsch_purge',
      purged: true,
      retiredKeys: 0,
      deferredKeys: 0,
    });
    expect(await invoke('purge', { schemeId: 'dsch_purge', expectedVersion: 2 })).toEqual(result);
    expect((await invoke('list', { deletedOnly: true })).items).toEqual([]);
    expect((await invokeError('get', { id: 'dsch_purge' })).code).toBe('NOT_FOUND');
    expect((await invokeError('purge', { schemeId: 'missing', expectedVersion: 2 })).code).toBe(
      'NOT_FOUND',
    );
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('selectCover', () => {
  it('资产必须属于本方案;合法资产可设为封面', async () => {
    await invoke('create', createInputFixture('dsch_cv', 'dsrv_cv1'));
    const foreign = await invokeError('selectCover', {
      schemeId: 'dsch_cv',
      assetId: 'dsa_ghost',
      expectedVersion: 1,
    });
    expect(foreign.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(foreign.message).toContain('封面必须选择本方案的试运行结果');

    const assetId = repo.insertLocalRunAsset('dsrv_cv1', 'previews/run.png');
    const result = await invoke('selectCover', {
      schemeId: 'dsch_cv',
      assetId,
      expectedVersion: 1,
    });
    expect(result.scheme.coverAssetId).toBe(assetId);
    expect(result.selectedAssetId).toBe(assetId);
  });
});

describe('formalize', () => {
  it('断言不满足给结构化 INVALID_STATE;满足后转正(结果过 canonical 契约)', async () => {
    await invoke('create', createInputFixture('dsch_fm', 'dsrv_fm1'));
    seedSuccessfulTrial('dsrv_fm1');
    const assetId = repo.insertLocalRunAsset('dsrv_fm1', 'previews/fm.png');
    await invoke('selectCover', { schemeId: 'dsch_fm', assetId, expectedVersion: 1 });

    const staleRevision = await invokeError('formalize', {
      schemeId: 'dsch_fm',
      revisionId: 'dsrv_other',
      coverAssetId: assetId,
      expectedVersion: 2,
      confirmed: true,
    });
    expect(staleRevision.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(staleRevision.message).toContain('转正基线与当前版本不一致');

    const staleCover = await invokeError('formalize', {
      schemeId: 'dsch_fm',
      revisionId: 'dsrv_fm1',
      coverAssetId: 'dsa_ghost',
      expectedVersion: 2,
      confirmed: true,
    });
    expect(staleCover.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(staleCover.message).toContain('封面断言与已选封面不一致');

    const result = await invoke('formalize', {
      schemeId: 'dsch_fm',
      revisionId: 'dsrv_fm1',
      coverAssetId: assetId,
      expectedVersion: 2,
      confirmed: true,
    });
    expect(() => formalizeDesignSchemeResultSchema.parse(result)).not.toThrow();
    expect(result.scheme.status).toBe('formal');
    expect(result.revisionId).toBe('dsrv_fm1');

    const again = await invokeError('formalize', {
      schemeId: 'dsch_fm',
      revisionId: 'dsrv_fm1',
      coverAssetId: assetId,
      expectedVersion: 3,
      confirmed: true,
    });
    expect(again.message).toContain('方案已是正式状态');
  });

  it('缺成功试运行时转正被仓库拒绝(INVALID_STATE)', async () => {
    await invoke('create', createInputFixture('dsch_fm2', 'dsrv_fm2'));
    const assetId = repo.insertLocalRunAsset('dsrv_fm2', 'previews/fm2.png');
    await invoke('selectCover', { schemeId: 'dsch_fm2', assetId, expectedVersion: 1 });
    const error = await invokeError('formalize', {
      schemeId: 'dsch_fm2',
      revisionId: 'dsrv_fm2',
      coverAssetId: assetId,
      expectedVersion: 2,
      confirmed: true,
    });
    expect(error.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(error.message).toContain('试运行');
  });
});

describe('promoteWorkingDraft', () => {
  it('断言一致 + 草稿试运行成功 → 替换正式版本并清空草稿指针', async () => {
    await createFormalScheme('dsch_pr', 'dsrv_pr1');
    repo.applyAgentRevision('dsch_pr', 'dsrv_pr1', legacyDocument('dsrv_pr2', 'dsch_pr'), [], 3);
    seedSuccessfulTrial('dsrv_pr2');

    const mismatch = await invokeError('promoteWorkingDraft', {
      schemeId: 'dsch_pr',
      workingDraftRevisionId: 'dsrv_other',
      expectedVersion: 4,
      confirmed: true,
    });
    expect(mismatch.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(mismatch.message).toContain('待验证草稿与当前状态不一致');

    const result = await invoke('promoteWorkingDraft', {
      schemeId: 'dsch_pr',
      workingDraftRevisionId: 'dsrv_pr2',
      expectedVersion: 4,
      confirmed: true,
    });
    expect(() => promoteWorkingDraftResultSchema.parse(result)).not.toThrow();
    expect(result.promotedRevisionId).toBe('dsrv_pr2');
    expect(result.scheme).toMatchObject({
      status: 'formal',
      currentRevisionId: 'dsrv_pr2',
      workingDraftRevisionId: null,
    });
  });

  it('草稿未试运行 → 仓库拒绝(INVALID_STATE)', async () => {
    await createFormalScheme('dsch_pr2', 'dsrv_pr3');
    repo.applyAgentRevision('dsch_pr2', 'dsrv_pr3', legacyDocument('dsrv_pr4', 'dsch_pr2'), [], 3);
    const error = await invokeError('promoteWorkingDraft', {
      schemeId: 'dsch_pr2',
      workingDraftRevisionId: 'dsrv_pr4',
      expectedVersion: 4,
      confirmed: true,
    });
    expect(error.code).toBe('DESIGN_SCHEME_INVALID_STATE');
    expect(error.message).toContain('试运行');
  });
});

// ---------------------------------------------------------------------------
// searchMarket / checkUpdate(注入假网络 seam)
// ---------------------------------------------------------------------------

describe('searchMarket', () => {
  it('候选过 canonical 安全校验:路径形描述/非法全名被丢弃,commit 补 null', async () => {
    searchMarket.mockResolvedValue(
      ok({
        query: 'zine',
        fromCache: false,
        fetchedAt: 1_000,
        candidates: [
          legacyCandidate(),
          legacyCandidate({
            candidateId: 'mc_102',
            description: '/etc/hosts 主题', // 整串即本地路径 → 拒
          }),
          legacyCandidate({ candidateId: 'mc_103', fullName: 'not-a-full-name' }),
        ],
      }),
    );
    const result = await invoke<{
      candidates: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>('searchMarket', { query: 'zine' });
    expect(() => marketSearchResultSchema.parse(result)).not.toThrow();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'mc_101',
      repositoryUrl: GITHUB_URI,
      ref: 'main',
      commit: null,
    });
    expect(result.nextCursor).toBeNull();
  });

  it('limit 截断保留前 N 条', async () => {
    searchMarket.mockResolvedValue(
      ok({
        query: 'zine',
        fromCache: true,
        fetchedAt: 2_000,
        candidates: [
          legacyCandidate(),
          legacyCandidate({ candidateId: 'mc_202', fullName: 'acme/zine-kit-2' }),
        ],
      }),
    );
    const result = await invoke<{ candidates: Array<{ candidateId: string }> }>('searchMarket', {
      query: 'zine',
      limit: 1,
    });
    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual(['mc_101']);
  });

  it('搜索失败 → MARKET_SEARCH_FAILED,消息中的本地路径被脱敏', async () => {
    searchMarket.mockResolvedValue(
      fail(appError('NETWORK_ERROR', 'GitHub 搜索返回 403 /Users/leak/secret')),
    );
    const error = await invokeError('searchMarket', { query: 'zine' });
    expect(error.code).toBe('DESIGN_SCHEME_MARKET_SEARCH_FAILED');
    expect(error.message).not.toContain('/Users');
    expect(error.message).toContain('[路径已脱敏]');
  });
});

describe('checkUpdate', () => {
  it('确定性结果过 canonical 契约;Agent 适配器 seam 与 requestedRevisionId 原样交给更新检查', async () => {
    let adapterFromDeps: unknown = 'unset';
    let requestedRevision: unknown = 'unset';
    const { adapter } = makeAgentAdapter();
    resolveAgentAdapter.mockReturnValue(adapter);
    checkUpdate.mockImplementationOnce(
      async (
        _schemeId: string,
        deps: { resolveAdapter: () => unknown },
        requestedRevisionId?: string,
      ) => {
        adapterFromDeps = deps.resolveAdapter();
        requestedRevision = requestedRevisionId;
        return ok({ status: 'no-source', detail: '这个方案没有 GitHub 来源，不需要检查更新。' });
      },
    );
    const result = await invoke('checkUpdate', { schemeId: 'dsch_ck', revisionId: 'dsrv_pin' });
    expect(adapterFromDeps).toBe(adapter);
    expect(requestedRevision).toBe('dsrv_pin');
    expect(() => checkDesignSchemeUpdateResultSchema.parse(result)).not.toThrow();
    expect(result).toEqual({
      status: 'no-source',
      detail: '这个方案没有 GitHub 来源，不需要检查更新。',
      scheme: null,
      revisionId: null,
    });
  });

  it('up-to-date 直通;AUTH_REQUIRED → Agent 文本连接不可用 blocker;MISSING_REFERENCE → NOT_FOUND', async () => {
    checkUpdate.mockResolvedValueOnce(ok({ status: 'up-to-date', detail: '已是最新。' }));
    const upToDate = await invoke('checkUpdate', { schemeId: 'dsch_ck' });
    expect(upToDate.status).toBe('up-to-date');

    checkUpdate.mockResolvedValueOnce(
      fail(
        appError('AUTH_REQUIRED', '重新编译需要可用的文本模型 /Users/leak', {
          recoveryAction: 'configure-ai',
        }),
      ),
    );
    const unavailable = await invokeError('checkUpdate', { schemeId: 'dsch_ck' });
    expect(unavailable.code).toBe(DESIGN_SCHEME_AGENT_AI_UNAVAILABLE);
    expect(unavailable.message).toContain('[路径已脱敏]');

    checkUpdate.mockResolvedValueOnce(
      fail(appError('MISSING_REFERENCE', '方案不存在', { recoveryAction: 'retry' })),
    );
    expect((await invokeError('checkUpdate', { schemeId: 'dsch_ck' })).code).toBe('NOT_FOUND');
  });

  it('其余失败 → UPDATE_CHECK_FAILED 且消息脱敏', async () => {
    checkUpdate.mockResolvedValueOnce(
      fail(appError('NETWORK_ERROR', '下载失败 /tmp/gh-cache', { retryable: true })),
    );
    const error = await invokeError('checkUpdate', { schemeId: 'dsch_ck' });
    expect(error.code).toBe('DESIGN_SCHEME_UPDATE_CHECK_FAILED');
    expect(error.message).toContain('[路径已脱敏]');
  });
});

describe('主进程权威 run plan(文本 + 图片输入)', () => {
  function seedProvider(type = 'openai-compatible'): void {
    coreDb
      .prepare(
        `INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'provider_prepare',
        '本地生图连接',
        type,
        'https://provider.example/v1',
        'image-model',
        1,
        1,
      );
  }

  function prepareInput(overrides: Record<string, unknown> = {}) {
    return {
      executionId: 'exec_prepare',
      schemeId: 'dsch_prepare',
      revisionId: 'dsrv_prepare',
      mode: 'trial',
      brief: '保持留白',
      inputValues: { slot_topic: '城市夜景' },
      executionSettings: {
        providerId: 'provider_prepare',
        size: '1024x1024',
        aspectRatio: '1:1',
        quality: 'high',
        outputCount: 1,
        referenceAssetIds: [],
        promptReferenceSelections: [],
      },
      ...overrides,
    };
  }

  it('从 exact revision、来源绑定和 Provider 行生成 canonical 四步计划', async () => {
    await invoke('create', createInputFixture('dsch_prepare', 'dsrv_prepare'));
    seedProvider();

    const prepared = await invoke('prepareRun', prepareInput());

    expect(prepared).toMatchObject({
      schemeId: 'dsch_prepare',
      revisionId: 'dsrv_prepare',
      schemeStatus: 'draft',
      schemeFidelity: 'adapted',
      inputValues: { slot_topic: '城市夜景' },
      plan: {
        schemeRevisionId: 'dsrv_prepare',
        sourceSnapshotIds: ['dssnap_dsch_prepare'],
        inputs: [{ slotId: 'slot_topic', kind: 'text', valueIds: [], text: '城市夜景' }],
        provider: {
          providerId: 'provider_prepare',
          providerName: '本地生图连接',
          model: 'image-model',
          capabilities: { image: true, multiImage: true, editing: true },
        },
        policy: { policyVersion: 'desktop-fixed-v1' },
        budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
        evaluation: {
          ratio: '1:1',
          requiredChecks: ['output-count', 'file-valid', 'aspect-ratio'],
        },
      },
    });
    expect(prepared.plan.steps.map((step: { kind: string }) => step.kind)).toEqual([
      'inspect-input',
      'compile-prompt',
      'generate-image',
      'evaluate-image',
    ]);
    expect(JSON.stringify(prepared)).not.toMatch(
      /provider\.example|base_url|storeKey|filePath|apiKey/,
    );
  });

  it('对缺必填文本、无图片槽位却带参考图、未知参考图与未知 Provider 稳定 fail-closed', async () => {
    await invoke('create', createInputFixture('dsch_prepare', 'dsrv_prepare'));
    seedProvider();
    expect((await invokeError('prepareRun', prepareInput({ inputValues: {} }))).code).toBe(
      'DESIGN_SCHEME_INPUT_REQUIRED',
    );

    // 纯文本方案没有图片槽位:参考图无处可放 → 明确拒绝而不是静默丢弃。
    resolveUploadedReference.mockReturnValue({ path: '/managed/upload.png', source: 'upload' });
    expect(
      (
        await invokeError(
          'prepareRun',
          prepareInput({
            executionSettings: {
              ...prepareInput().executionSettings,
              referenceAssetIds: ['UPLOAD_REF'],
            },
          }),
        )
      ).code,
    ).toBe('DESIGN_SCHEME_INPUT_MISMATCH');
    // 既不是方案资产也不是本次上传暂存。
    resolveUploadedReference.mockReturnValue(null);
    expect(
      (
        await invokeError(
          'prepareRun',
          prepareInput({
            executionSettings: {
              ...prepareInput().executionSettings,
              referenceAssetIds: ['asset_reference'],
            },
          }),
        )
      ).code,
    ).toBe('DESIGN_SCHEME_REFERENCE_MISSING');

    coreDb
      .prepare("UPDATE providers SET type = 'future-provider' WHERE id = ?")
      .run('provider_prepare');
    expect((await invokeError('prepareRun', prepareInput())).code).toBe(
      'DESIGN_SCHEME_PROVIDER_UNSUPPORTED',
    );
  });

  it('含图片槽位的方案:Composer 上传暂存 id 经宿主解析落入图片槽位快照,run 前复核通过', async () => {
    await invoke(
      'create',
      createInputFixture('dsch_prepare_img', 'dsrv_prepare_img', {
        document: canonicalDocument('dsrv_prepare_img', 'dsch_prepare_img', {
          inputs: [
            { id: 'slot_topic', label: '主题', kind: 'text', required: true },
            {
              id: 'slot_subject',
              label: '主体参考',
              kind: 'image',
              required: true,
              imageRole: 'subject-reference',
            },
          ],
        }),
      }),
    );
    seedProvider();
    resolveUploadedReference.mockImplementation((assetId: string) =>
      assetId === 'UPLOAD_SUBJECT' ? { path: '/managed/upload.png', source: 'upload' } : null,
    );

    const prepared = await invoke(
      'prepareRun',
      prepareInput({
        schemeId: 'dsch_prepare_img',
        revisionId: 'dsrv_prepare_img',
        executionSettings: {
          ...prepareInput().executionSettings,
          referenceAssetIds: ['UPLOAD_SUBJECT'],
        },
      }),
    );
    expect(prepared.plan.inputs).toEqual([
      { slotId: 'slot_topic', kind: 'text', valueIds: [], text: '城市夜景' },
      { slotId: 'slot_subject', kind: 'image', valueIds: ['UPLOAD_SUBJECT'], text: null },
    ]);
    expect(prepared.inputValues).toEqual({ slot_topic: '城市夜景' });
    expect(prepared.executionSettings.referenceAssetIds).toEqual(['UPLOAD_SUBJECT']);
    expect(JSON.stringify(prepared)).not.toContain('/managed/');

    // 必需图片槽位缺参考图 → blocked。
    expect(
      (
        await invokeError(
          'prepareRun',
          prepareInput({ schemeId: 'dsch_prepare_img', revisionId: 'dsrv_prepare_img' }),
        )
      ).code,
    ).toBe('DESIGN_SCHEME_INPUT_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// 执行类操作的所有者门与结构化 blocker
// ---------------------------------------------------------------------------

describe('执行类操作要求可信 renderer 所有者,并只返回结构化 blocker', () => {
  const cases: Array<[MethodName, unknown, string]> = [
    [
      'modify',
      {
        executionId: 'exec_1',
        schemeId: 'dsch_x',
        baseRevisionId: 'dsrv_1',
        instruction: '改一下',
      },
      'DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED',
    ],
    ['cancel', { executionId: 'exec_2' }, 'DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED'],
  ];

  it.each(cases)('designSchemes.%s 无所有者时拒绝', async (name, payload, code) => {
    const error = await invokeError(name, payload);
    expect(error.code).toBe(code);
    expect(error.code).not.toBe('DESIGN_SCHEME_UNAVAILABLE');
  });

  it('designSchemes.run 要求可信 renderer 所有者', async () => {
    const error = await invokeErrorRaw('run');
    expect(error.code).toBe('DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED');
    expect(error.code).not.toBe('DESIGN_SCHEME_UNAVAILABLE');
  });

  it('剩余 Agent blocker 码与旧的 fail-closed 语义区分,逐一登记', () => {
    for (const code of [
      DESIGN_SCHEME_AGENT_AI_UNAVAILABLE,
      DESIGN_SCHEME_AGENT_CREATION_INPUT_UNSUPPORTED,
      DESIGN_SCHEME_CREATE_INPUT_REQUIRED,
      DESIGN_SCHEME_EXECUTION_NOT_FOUND,
      DESIGN_SCHEME_EXECUTION_NOT_CONFIRMABLE,
    ]) {
      expect(code).not.toBe('DESIGN_SCHEME_UNAVAILABLE');
      expect(code).toMatch(/^[A-Z][A-Z0-9_.-]{1,79}$/);
    }
  });
});

describe('分享包导入导出', () => {
  const importInput = {
    stagedPackageId: 'stage_1',
    packageHash: CONTENT_HASH,
    formatVersion: 2 as const,
  };

  it('按 sender 消费 verified copy 并返回 path-free draft 结果', async () => {
    await invoke('create', createInputFixture('dsch_imported', 'dsrv_imported'));
    const importedSummary = repo.requireSummary('dsch_imported');
    importPackage.mockResolvedValueOnce(
      ok({ scheme: importedSummary, revisionId: 'dsrv_imported' }),
    );

    const result = await invoke('importPackage', importInput, 73);

    expect(consumeStagedPackage).toHaveBeenCalledWith(73, importInput, expect.any(Function));
    expect(importPackage).toHaveBeenCalledWith(
      '/verified/package',
      {
        db,
        userDataDir,
        picturesDir,
      },
      Buffer.from('verified fixture bytes'),
    );
    expect(result).toMatchObject({
      scheme: { id: 'dsch_imported', status: 'draft' },
      revisionId: 'dsrv_imported',
      status: 'draft',
    });
    expect(JSON.stringify(result)).not.toMatch(/verified|Users|storeKey|filePath/);
  });

  it('导入要求 sender ownership 且 staging/import 错误映射为脱敏 BridgeError', async () => {
    expect((await invokeError('importPackage', importInput)).code).toBe(
      'DESIGN_SCHEME_PACKAGE_OWNER_REQUIRED',
    );
    consumeStagedPackage.mockRejectedValueOnce(new Error('tampered /Users/private/package'));
    const error = await invokeError('importPackage', importInput, 73);
    expect(error.code).toBe('DESIGN_SCHEME_PACKAGE_IMPORT_FAILED');
    expect(error.message).toContain('[路径已脱敏]');
  });

  it('保存对话框取消返回 canonical cancelled', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await expect(
      invoke('exportPackage', { schemeId: 'dsch_x', formatVersion: 2 }),
    ).resolves.toEqual({ schemeId: 'dsch_x', status: 'cancelled' });
    expect(exportPackage).not.toHaveBeenCalled();
  });

  it('导出只返回 canonical 元数据并使用安全默认文件名', async () => {
    const targetPath = join(userDataDir, 'picked.musefold.design');
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: targetPath });
    exportPackage.mockResolvedValueOnce(
      ok({
        path: '/Users/private/leak.musefold.design',
        fileName: 'leak.musefold.design',
        sizeBytes: 42,
        packageId: 'share_1',
        contentHash: CONTENT_HASH,
        createdAt: Date.parse(NOW_ISO),
      }),
    );

    const result = await invoke('exportPackage', {
      schemeId: 'dsch_export',
      revisionId: 'dsrv_export',
      formatVersion: 2,
    });

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: join(userDataDir, 'dsch_export.musefold.design'),
      }),
    );
    expect(exportPackage).toHaveBeenCalledWith(
      'dsch_export',
      targetPath,
      { db, userDataDir, picturesDir },
      'dsrv_export',
    );
    expect(result).toEqual({
      package: {
        id: 'share_1',
        format: 'musefold.design',
        formatVersion: 2,
        contentHash: CONTENT_HASH,
        sizeBytes: 42,
        createdAt: NOW_ISO,
      },
      schemeId: 'dsch_export',
      status: 'delivered',
    });
    expect(JSON.stringify(result)).not.toMatch(/Users|fileName|filePath|path/);
  });
});

// ---------------------------------------------------------------------------
// 事件 seam
// ---------------------------------------------------------------------------

describe('designSchemes:event 事件 seam', () => {
  it('canonical 事件可解析;携带本地路径的事件被拒绝', () => {
    expect(designSchemeEventChannel).toBe('designSchemes:event');
    expect(parseDesignSchemeEvent({ kind: 'cancelled', executionId: 'exec_1' })).toEqual({
      kind: 'cancelled',
      executionId: 'exec_1',
    });
    expect(() =>
      parseDesignSchemeEvent({
        kind: 'trace',
        executionId: 'exec_1',
        item: { id: 't1', title: '步骤', status: 'success', detail: '/Users/leak' },
      }),
    ).toThrow();
  });
});
