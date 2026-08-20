import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignSchemeCreationEvent } from '@musefold/desktop-contracts/design-scheme';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import type { OpenAiCompatibleTextAdapter, TextCompletionRequest } from '../text-adapter';

// with-source 路径不下载真实仓库：resolve/persist 都替换为内存实现。
// 标签按 URL 推导、快照 id 逐次递增，让多来源合并（P3）也能走同一套 mock。
vi.mock('../source-ingestion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../source-ingestion')>();
  let snapshotSeq = 0;
  return {
    ...original,
    resolveGithubSource: vi.fn(async (repositoryUrl: string) => ({
      ok: true as const,
      data: {
        repositoryUrl,
        repositoryLabel: repositoryUrl.replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, ''),
        name: repositoryUrl.split('/').filter(Boolean).at(-1) ?? 'repo',
        description: '极简杂志海报 Skill',
        resolvedRef: 'main',
        commitHash: 'abcdef1234567890',
        license: 'MIT License',
        textFiles: [{ path: 'SKILL.md', contentHash: 'sha256:1', sizeBytes: 20, text: '# 海报规则\n双色印刷' }],
        imageFiles: [],
        otherCount: 0,
      },
    })),
    persistGithubSnapshot: vi.fn((db: Database.Database, source: { repositoryUrl: string }) => {
      const repository = new DesignSchemeRepository(db);
      snapshotSeq += 1;
      return {
        packageId: `pkg_test_${snapshotSeq}`,
        snapshotId: repository.saveSourceSnapshot({
          package: { id: `pkg_test_${snapshotSeq}`, kind: 'github', repositoryUrl: source.repositoryUrl },
          snapshot: { id: `snap_test_${snapshotSeq}`, ref: 'main', commitHash: 'abcdef1234567890', totalBytes: 20, scan: {} },
          files: [{ path: 'SKILL.md', kind: 'text', contentHash: 'sha256:1', sizeBytes: 20, textContent: '# 海报规则' }],
        }).snapshotId,
        imagePaths: [],
      };
    }),
  };
});

import { DesignSchemeCreationSession } from '../orchestrator';

const ANALYST_JSON = JSON.stringify({
  repoKind: 'agent-skill',
  capabilitySummary: '极简双色杂志海报',
  rules: [{ domain: 'color', statement: '只用两种油墨色', mode: 'required', evidencePaths: ['SKILL.md'] }],
  variables: [{ label: '海报主题', kind: 'text', required: true }],
  referenceImages: [],
  unsupported: ['自动导出 PDF'],
  license: 'MIT',
});

const COMPILER_JSON = JSON.stringify({
  name: '极简杂志海报',
  summary: '双色印刷版式方案',
  fidelity: 'faithful',
  inputs: [{ label: '海报主题', kind: 'text', required: true, description: '一句话主题' }],
  constraints: [{ domain: 'color', statement: '只用两种油墨色', mode: 'required', userOverridable: false, evidencePaths: ['SKILL.md'] }],
  promptProgram: [
    { kind: 'input-template', template: '为「{{topic}}」设计极简杂志海报', variables: ['topic'] },
    { kind: 'style-rule', template: '双色印刷质感，网格排版', variables: [] },
  ],
  adopted: ['双色规则'],
  omitted: ['自动导出 PDF'],
  warnings: [],
  creationSummary: '已创建极简杂志海报方案草稿。运行时提供海报主题即可，建议先试运行。',
});

function makeAdapter(byRole: { analyst?: string; compiler?: string }): OpenAiCompatibleTextAdapter {
  return {
    modelId: 'test-model',
    connectionName: 'test-conn',
    complete: async (request: TextCompletionRequest) => {
      if (request.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (request.system.includes('仓库分析师')) return { text: byRole.analyst ?? ANALYST_JSON, model: 'test-model' };
      return { text: byRole.compiler ?? COMPILER_JSON, model: 'test-model' };
    },
  } as unknown as OpenAiCompatibleTextAdapter;
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  return db;
}

describe('DesignSchemeCreationSession', () => {
  let events: DesignSchemeCreationEvent[];

  beforeEach(() => {
    events = [];
  });

  const collect = (event: DesignSchemeCreationEvent) => events.push(event);
  const states = () => events.filter((event) => event.kind === 'state').map((event) => (event as { state: string }).state);

  it('纯想法路径：跳过来源步骤，直接编译并落库草稿', async () => {
    const db = makeDb();
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-idea', brief: '做一个胶片颗粒感的城市夜景方案' },
      { db, resolveAdapter: () => makeAdapter({}), emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheme.name).toBe('极简杂志海报');
    expect(result.data.scheme.status).toBe('draft');
    expect(result.data.scheme.sourcePresentation).toBe('musefold-created');
    expect(result.data.creationSummary).toContain('草稿');
    expect(states()).toEqual(['created', 'compiling_scheme', 'draft_ready']);

    const repository = new DesignSchemeRepository(db);
    const summaries = repository.listSummaries();
    expect(summaries).toHaveLength(1);
    const document = repository.getRevisionDocument(result.data.revisionId);
    expect(document?.promptProgram).toHaveLength(2);
    expect(document?.compilation.briefExcerpt).toContain('胶片颗粒');
    // 无来源仓库时约束证据指向用户想法
    expect(document?.constraints[0]?.sourceIds).toEqual(['src_brief']);
  });

  it('想法 + GitHub 来源路径：等待安装确认后走 Analyst→Compiler', async () => {
    const db = makeDb();
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-src', brief: '做成可复用海报方案', githubUrl: 'https://github.com/acme/zine-poster' },
      { db, resolveAdapter: () => makeAdapter({}), emit: collect },
    );
    const runPromise = session.run();

    // 等到确认请求事件出现后批准
    await vi.waitFor(() => {
      expect(events.some((event) => event.kind === 'confirmation-required')).toBe(true);
    });
    const confirmation = events.find((event) => event.kind === 'confirmation-required');
    if (confirmation?.kind === 'confirmation-required') {
      expect(confirmation.source.repositoryUrl).toBe('https://github.com/acme/zine-poster');
      expect(confirmation.source.textFileCount).toBe(1);
    }
    session.confirmInstall(true);

    const result = await runPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheme.sourcePresentation).toBe('skill');
    expect(result.data.scheme.sourceLabel).toBe('acme/zine-poster');
    expect(states()).toEqual([
      'created',
      'source_resolving',
      'awaiting_install_confirmation',
      'source_snapshotting',
      'analyzing',
      'compiling_scheme',
      'draft_ready',
    ]);
    // 轨迹里能看到未支持能力的诚实披露
    const unsupported = events.find((event) => event.kind === 'trace'
      && (event as { item: { id: string } }).item.id === 'analyst-unsupported');
    expect(unsupported).toBeTruthy();

    const document = new DesignSchemeRepository(db).getRevisionDocument(result.data.revisionId);
    expect(document?.sources.some((binding) => binding.kind === 'github-skill' && binding.commit === 'abcdef1234567890')).toBe(true);
    // 有证据的约束绑定到仓库来源
    expect(document?.constraints[0]?.sourceIds).toEqual(['src_repo']);
    // 快照与绑定已写库
    const bindings = db.prepare('SELECT COUNT(*) AS n FROM design_scheme_source_bindings').get() as { n: number };
    expect(bindings.n).toBe(1);
  });

  it('多来源合并（P3）：逐个确认，两份报告合并编译为一个组合方案', async () => {
    const db = makeDb();
    const compilerRequests: string[] = [];
    const adapter = {
      modelId: 'test-model',
      connectionName: 'test-conn',
      complete: async (request: TextCompletionRequest) => {
        if (request.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (request.system.includes('仓库分析师')) return { text: ANALYST_JSON, model: 'test-model' };
        compilerRequests.push(request.user);
        return { text: COMPILER_JSON, model: 'test-model' };
      },
    } as unknown as OpenAiCompatibleTextAdapter;

    const session = new DesignSchemeCreationSession(
      {
        executionId: 'exec-merge',
        brief: '合并两个海报 Skill',
        githubUrls: ['https://github.com/acme/zine-poster', 'https://github.com/beta/riso-print'],
      },
      { db, resolveAdapter: () => adapter, emit: collect },
    );
    const runPromise = session.run();

    // 每个来源都要单独确认；按事件顺序批准两次。
    for (const expected of [1, 2]) {
      await vi.waitFor(() => {
        expect(events.filter((event) => event.kind === 'confirmation-required')).toHaveLength(expected);
      });
      session.confirmInstall(true);
    }

    const result = await runPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheme.sourceLabel).toBe('acme/zine-poster 等 2 个来源');
    expect(result.data.scheme.sourcePresentation).toBe('skill');

    // 轨迹步骤带序号，两个来源都完整走过 解析→确认→快照→分析。
    const traceIds = result.data.trace.map((item) => item.id);
    for (const id of ['source-resolve-1', 'source-resolve-2', 'source-confirm-1', 'source-confirm-2', 'analyst-1', 'analyst-2']) {
      expect(traceIds).toContain(id);
    }

    // 编译器一次性收到两份报告与合并要求。
    expect(compilerRequests).toHaveLength(1);
    expect(compilerRequests[0]).toContain('acme/zine-poster');
    expect(compilerRequests[0]).toContain('beta/riso-print');
    expect(compilerRequests[0]).toContain('合并为一个组合方案');

    // 文档来源：两个 normative 仓库绑定；约束证据指向全部来源。
    const document = new DesignSchemeRepository(db).getRevisionDocument(result.data.revisionId);
    const repoBindings = document?.sources.filter((binding) => binding.kind === 'github-skill') ?? [];
    expect(repoBindings.map((binding) => binding.id)).toEqual(['src_repo_1', 'src_repo_2']);
    expect(repoBindings.every((binding) => binding.role === 'normative')).toBe(true);
    expect(document?.constraints[0]?.sourceIds).toEqual(['src_repo_1', 'src_repo_2']);
    // 两个快照绑定都写库。
    const bindings = db.prepare('SELECT COUNT(*) AS n FROM design_scheme_source_bindings').get() as { n: number };
    expect(bindings.n).toBe(2);
  });

  it('历史来源路径：固化快照、写入 example 绑定并跳过安装确认', async () => {
    const db = makeDb();
    const tmp = mkdtempSync(join(tmpdir(), 'musefold-hist-'));
    const imagePath = join(tmp, 'work1.png');
    writeFileSync(imagePath, Buffer.from('fake-png-bytes'));
    const session = new DesignSchemeCreationSession(
      {
        executionId: 'exec-history',
        brief: '把这些作品的风格整理成可复用方案',
        history: { items: [{ historyId: 'hist_1', imagePath, promptText: '深蓝配暖橙的极简海报' }] },
      },
      { db, resolveAdapter: () => makeAdapter({}), emit: collect, userDataDir: tmp },
    );
    const result = await session.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 本地历史来源不需要安装确认，也不经过 Analyst
    expect(states()).toEqual(['created', 'source_snapshotting', 'compiling_scheme', 'draft_ready']);
    expect(result.data.scheme.sourceLabel).toBe('历史 · 1 张图片');
    expect(result.data.scheme.sourcePresentation).toBe('musefold-created');

    const repository = new DesignSchemeRepository(db);
    const document = repository.getRevisionDocument(result.data.revisionId);
    expect(document?.sources.some((binding) => binding.kind === 'history-image' && binding.role === 'example')).toBe(true);
    expect(document?.sources.some((binding) => binding.kind === 'conversation-turn' && binding.role === 'context')).toBe(true);

    // 快照文件已复制固化（图片 + 提示词文本）
    const snapshotRow = db.prepare("SELECT id FROM source_snapshots WHERE package_id LIKE 'pkg_hist_%'").get() as { id: string } | undefined;
    expect(snapshotRow).toBeTruthy();
    const files = db.prepare('SELECT path, kind, store_key FROM source_files WHERE snapshot_id = ?').all(snapshotRow!.id) as Array<{ path: string; kind: string; store_key: string | null }>;
    expect(files.map((file) => file.kind).sort()).toEqual(['image', 'text']);
    const imageFile = files.find((file) => file.kind === 'image');
    expect(existsSync(join(tmp, imageFile!.store_key!))).toBe(true);
    // 方案与历史快照建立 example 绑定
    const bindings = db.prepare('SELECT role FROM design_scheme_source_bindings').all() as Array<{ role: string }>;
    expect(bindings).toEqual([{ role: 'example' }]);
  });

  it('历史图片文件缺失：跳过缺失项但创建仍完成', async () => {
    const db = makeDb();
    const tmp = mkdtempSync(join(tmpdir(), 'musefold-hist-miss-'));
    const session = new DesignSchemeCreationSession(
      {
        executionId: 'exec-history-miss',
        brief: '从历史整理方案',
        history: { items: [{ historyId: 'hist_gone', imagePath: join(tmp, 'gone.png') }] },
      },
      { db, resolveAdapter: () => makeAdapter({}), emit: collect, userDataDir: tmp },
    );
    const result = await session.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 全部条目缺失时来源为空，回落为纯想法展示
    expect(result.data.scheme.sourceLabel).toBe('Musefold 创建');
    const warning = events.find((event) => event.kind === 'trace'
      && (event as { item: { id: string; status: string } }).item.id === 'history-snapshot'
      && (event as { item: { status: string } }).item.status === 'warning');
    expect(warning).toBeTruthy();
  });

  it('拒绝安装确认：管线取消且不写任何方案', async () => {
    const db = makeDb();
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-reject', brief: '', githubUrl: 'https://github.com/acme/zine-poster' },
      { db, resolveAdapter: () => makeAdapter({}), emit: collect },
    );
    const runPromise = session.run();
    await vi.waitFor(() => {
      expect(events.some((event) => event.kind === 'confirmation-required')).toBe(true);
    });
    session.confirmInstall(false);
    const result = await runPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    expect(events.some((event) => event.kind === 'cancelled')).toBe(true);
    const schemes = db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get() as { n: number };
    expect(schemes.n).toBe(0);
  });

  it('未配置文本 AI：直接 blocked 并给出配置指引', async () => {
    const db = makeDb();
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-noai', brief: '想法' },
      { db, resolveAdapter: () => null, emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH_REQUIRED');
      expect(result.error.message).toContain('AI 连接');
    }
    expect(states()).toEqual(['created', 'blocked']);
  });

  it('AI 返回两次校验失败：failed 并携带可解释信息', async () => {
    const db = makeDb();
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-badjson', brief: '想法' },
      { db, resolveAdapter: () => makeAdapter({ compiler: '不是 JSON' }), emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(false);
    expect(events.some((event) => event.kind === 'failed')).toBe(true);
    expect(states().at(-1)).toBe('failed');
  });

  it('取消进行中的创建：以 cancelled 收尾', async () => {
    const db = makeDb();
    let releaseCompiler: (() => void) | null = null;
    const hangingAdapter = {
      modelId: 'test-model',
      connectionName: 'test-conn',
      complete: (request: TextCompletionRequest) => new Promise((_resolve, reject) => {
        releaseCompiler = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        request.signal?.addEventListener('abort', () => releaseCompiler?.());
      }),
    } as unknown as OpenAiCompatibleTextAdapter;
    const session = new DesignSchemeCreationSession(
      { executionId: 'exec-cancel', brief: '想法' },
      { db, resolveAdapter: () => hangingAdapter, emit: collect },
    );
    const runPromise = session.run();
    await vi.waitFor(() => {
      expect(states()).toContain('compiling_scheme');
    });
    session.cancel();
    const result = await runPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    expect(events.some((event) => event.kind === 'cancelled')).toBe(true);
  });
});
