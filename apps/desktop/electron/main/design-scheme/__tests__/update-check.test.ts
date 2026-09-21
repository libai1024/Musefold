import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
  type SourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { isDesignSchemeOperationActive } from '@musefold/core/services/design-scheme-lifetime';
import type { ResolvedGithubSource } from '../source-ingestion';
import type { OpenAiCompatibleTextAdapter, TextCompletionRequest } from '../text-adapter';

const sourceMocks = vi.hoisted(() => ({
  resolveGithubSource: vi.fn(),
  persistGithubSnapshot: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('../source-ingestion', async (original) => ({
  ...(await original<typeof import('../source-ingestion')>()),
  ...sourceMocks,
}));

import { checkSchemeUpdate } from '../update-check';

const REPO_A = 'https://github.com/acme/source-a';
const REPO_B = 'https://github.com/acme/source-b';
const OLD_A = 'a'.repeat(40);
const NEW_A = 'b'.repeat(40);
const OLD_B = 'c'.repeat(40);
const CONTENT_HASH = createHash('sha256').update('# 测试规则').digest('hex');

const ANALYST_JSON = JSON.stringify({
  repoKind: 'agent-skill',
  capabilitySummary: '可复用海报规则',
  rules: [
    {
      domain: 'color',
      statement: '使用高对比配色',
      mode: 'required',
      evidencePaths: ['SKILL.md'],
    },
  ],
  variables: [{ label: '主题', kind: 'text', required: true }],
  referenceImages: [],
  unsupported: [],
  license: 'MIT',
});

const COMPILER_JSON = JSON.stringify({
  name: '更新后的方案',
  summary: '使用最新来源重新编译',
  fidelity: 'faithful',
  inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
  constraints: [
    {
      domain: 'color',
      statement: '使用高对比配色',
      mode: 'required',
      userOverridable: false,
      evidencePaths: ['SKILL.md'],
    },
  ],
  promptProgram: [
    { kind: 'input-template', template: '为 {{topic}} 设计海报', variables: ['topic'] },
    { kind: 'style-rule', template: '高对比配色', variables: [] },
  ],
  adopted: ['最新来源规则'],
  omitted: [],
  warnings: [],
  creationSummary: '已按上游更新重新编译。',
});

function githubSource(repositoryUrl: string, commitHash: string): ResolvedGithubSource {
  return {
    repositoryUrl,
    repositoryLabel: repositoryUrl.replace('https://github.com/', ''),
    name: repositoryUrl.split('/').at(-1) ?? 'source',
    description: '测试来源',
    resolvedRef: 'main',
    commitHash,
    license: 'MIT',
    textFiles: [
      {
        path: 'SKILL.md',
        contentHash: CONTENT_HASH,
        sizeBytes: Buffer.byteLength('# 测试规则'),
        text: '# 测试规则',
      },
    ],
    imageFiles: [],
    otherCount: 0,
  };
}

function githubBinding(
  id: string,
  uri: string,
  commit: string,
  role: SourceBinding['role'] = 'normative',
): SourceBinding {
  return { id, kind: 'github-skill', role, uri, ref: 'main', commit, license: 'MIT' };
}

function documentFixture(
  options: {
    revisionId?: string;
    schemeId?: string;
    name?: string;
    brief?: string;
    sources?: SourceBinding[];
    parameters?: DesignSchemeRevisionDocument['parameters'];
  } = {},
): DesignSchemeRevisionDocument {
  const sources = options.sources ?? [{ id: 'src_brief', kind: 'user-brief', role: 'context' }];
  const sourceIds = sources
    .filter((source) => source.kind.startsWith('github'))
    .map((source) => source.id);
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: options.revisionId ?? 'dsrv_base',
    schemeId: options.schemeId ?? 'dsch_update',
    name: options.name ?? '更新测试方案',
    summary: '检查 GitHub 上游更新',
    fidelity: 'faithful',
    sources,
    inputs: [{ id: 'topic', label: '主题', kind: 'text', required: true }],
    parameters: options.parameters ?? [],
    constraints: [
      {
        id: 'con_1',
        domain: 'color',
        statement: '使用旧版配色规则',
        mode: 'required',
        userOverridable: false,
        sourceIds,
      },
    ],
    promptProgram: [
      {
        id: 'pm_1',
        order: 0,
        kind: 'input-template',
        template: '{{topic}}',
        variables: ['topic'],
        sourceIds,
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'old-model', connectionName: 'old-connection' },
      adopted: [],
      omitted: [],
      warnings: [],
      ...(options.brief !== undefined ? { briefExcerpt: options.brief } : {}),
      trace: [],
    },
  };
}

function makeAdapter(
  requests: TextCompletionRequest[] = [],
  compilerJson = COMPILER_JSON,
): OpenAiCompatibleTextAdapter {
  return {
    modelId: 'test-model',
    connectionName: 'test-connection',
    complete: async (request: TextCompletionRequest) => {
      requests.push(request);
      return {
        text: request.system.includes('仓库分析师') ? ANALYST_JSON : compilerJson,
        model: 'test-model',
      };
    },
  } as unknown as OpenAiCompatibleTextAdapter;
}

function snapshotBindings(db: Database.Database, revisionId: string): string[] {
  return (
    db
      .prepare(
        `SELECT source_snapshot_id
           FROM design_scheme_source_bindings
          WHERE revision_id = ?
          ORDER BY source_snapshot_id`,
      )
      .all(revisionId) as Array<{ source_snapshot_id: string }>
  ).map((row) => row.source_snapshot_id);
}

describe('checkSchemeUpdate', () => {
  let db: Database.Database;
  let repository: DesignSchemeRepository;
  let upstream: Map<string, ResolvedGithubSource>;
  let persistedSequence: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runDesignSchemeDbMigrations(db);
    repository = new DesignSchemeRepository(db);
    upstream = new Map();
    persistedSequence = 0;
    sourceMocks.resolveGithubSource.mockReset();
    sourceMocks.persistGithubSnapshot.mockReset();
    sourceMocks.resolveGithubSource.mockImplementation(async (repositoryUrl: string) => {
      const source = upstream.get(repositoryUrl);
      if (!source) throw new Error(`未配置测试来源 ${repositoryUrl}`);
      return { ok: true as const, data: source };
    });
    sourceMocks.persistGithubSnapshot.mockImplementation(
      (targetDb: Database.Database, source: ResolvedGithubSource) => {
        persistedSequence += 1;
        const snapshotId = `snap_new_${persistedSequence}`;
        new DesignSchemeRepository(targetDb).saveSourceSnapshot({
          package: {
            id: `pkg_new_${persistedSequence}`,
            kind: 'github',
            repositoryUrl: source.repositoryUrl,
            license: source.license ?? undefined,
          },
          snapshot: {
            id: snapshotId,
            ref: source.resolvedRef,
            commitHash: source.commitHash,
            totalBytes: 12,
            scan: {},
          },
          files: [],
        });
        return { packageId: `pkg_new_${persistedSequence}`, snapshotId, imagePaths: [] };
      },
    );
  });

  afterEach(() => {
    db.close();
  });

  function saveSnapshot(options: {
    snapshotId: string;
    packageId: string;
    kind?: 'github' | 'history' | 'user-brief';
    repositoryUrl?: string;
    commitHash?: string | null;
    role?: 'normative' | 'reference' | 'example' | 'context';
  }): { snapshotId: string; role: 'normative' | 'reference' | 'example' | 'context' } {
    repository.saveSourceSnapshot({
      package: {
        id: options.packageId,
        kind: options.kind ?? 'github',
        ...(options.repositoryUrl ? { repositoryUrl: options.repositoryUrl } : {}),
      },
      snapshot: {
        id: options.snapshotId,
        ref: options.kind === 'history' ? 'history' : 'main',
        commitHash: options.commitHash ?? null,
        totalBytes: 0,
        scan: {},
      },
      files: [],
    });
    return { snapshotId: options.snapshotId, role: options.role ?? 'normative' };
  }

  function insertDraft(
    document: DesignSchemeRevisionDocument,
    bindings: Array<{
      snapshotId: string;
      role: 'normative' | 'reference' | 'example' | 'context';
    }> = [],
  ): void {
    repository.insertSchemeDraft({
      document,
      sourceLabel: '更新测试来源',
      sourcePresentation: bindings.length > 0 ? 'skill' : 'musefold-created',
      createdBy: 'agent',
      bindings,
    });
  }

  it.each(['resolve', 'reject'] as const)(
    'holds the scheme while checking upstream and releases after %s',
    async (outcome) => {
      insertDraft(documentFixture({ sources: [githubBinding('src_repo', REPO_A, OLD_A)] }));
      let settle!: () => void;
      sourceMocks.resolveGithubSource.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              outcome === 'resolve'
                ? resolve({ ok: true, data: githubSource(REPO_A, OLD_A) })
                : reject(new Error('upstream unavailable'));
          }),
      );
      const pending = checkSchemeUpdate('dsch_update', { db, resolveAdapter: () => null });
      const heldWhilePending = isDesignSchemeOperationActive(db, 'dsch_update');
      settle();
      const result = await pending;
      expect(heldWhilePending).toBe(true);
      expect(result.ok).toBe(outcome === 'resolve');
      expect(isDesignSchemeOperationActive(db, 'dsch_update')).toBe(false);
    },
  );

  it('没有 GitHub 来源时返回 no-source，且不解析适配器', async () => {
    insertDraft(documentFixture());
    const resolveAdapter = vi.fn(() => makeAdapter());

    const result = await checkSchemeUpdate('dsch_update', { db, resolveAdapter });

    expect(result).toMatchObject({ ok: true, data: { status: 'no-source' } });
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(sourceMocks.resolveGithubSource).not.toHaveBeenCalled();
    expect(isDesignSchemeOperationActive(db, 'dsch_update')).toBe(false);
  });

  it('所有来源已是最新时返回 up-to-date，且只做上游比较', async () => {
    const binding = githubBinding('src_repo', REPO_A, OLD_A);
    const oldSnapshot = saveSnapshot({
      snapshotId: 'snap_old_a',
      packageId: 'pkg_old_a',
      repositoryUrl: REPO_A,
      commitHash: OLD_A,
    });
    insertDraft(documentFixture({ sources: [binding] }), [oldSnapshot]);
    upstream.set(REPO_A, githubSource(REPO_A, OLD_A));
    const resolveAdapter = vi.fn(() => makeAdapter());

    const result = await checkSchemeUpdate('dsch_update', { db, resolveAdapter });

    expect(result).toMatchObject({ ok: true, data: { status: 'up-to-date' } });
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(sourceMocks.persistGithubSnapshot).not.toHaveBeenCalled();
    expect(repository.requireSummary('dsch_update')).toMatchObject({
      currentRevisionId: 'dsrv_base',
      version: 1,
    });
  });

  it('草稿来源变化时从当前 revision 重编译并替换该来源快照', async () => {
    const binding = githubBinding('src_repo', REPO_A, OLD_A);
    const oldSnapshot = saveSnapshot({
      snapshotId: 'snap_old_a',
      packageId: 'pkg_old_a',
      repositoryUrl: REPO_A,
      commitHash: OLD_A,
    });
    insertDraft(
      documentFixture({
        brief: '草稿用户说明',
        sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }, binding],
        parameters: [
          { id: 'density', label: '密度', type: 'number', defaultValue: 2, userEditable: true },
        ],
      }),
      [oldSnapshot],
    );
    upstream.set(REPO_A, githubSource(REPO_A, NEW_A));
    const requests: TextCompletionRequest[] = [];

    const result = await checkSchemeUpdate('dsch_update', {
      db,
      resolveAdapter: () => makeAdapter(requests),
    });

    expect(result).toMatchObject({ ok: true, data: { status: 'draft-created' } });
    if (!result.ok || !result.data.revisionId) return;
    const updated = repository.getRevisionDocument(result.data.revisionId);
    expect(updated?.sources).toEqual([
      { id: 'src_brief', kind: 'user-brief', role: 'context' },
      {
        ...githubBinding('src_repo', REPO_A, NEW_A),
        packageId: 'pkg_new_1',
        snapshotId: 'snap_new_1',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(updated?.parameters).toEqual([
      { id: 'density', label: '密度', type: 'number', defaultValue: 2, userEditable: true },
    ]);
    expect(updated?.compilation.briefExcerpt).toBe('草稿用户说明');
    expect(requests[0]?.user).toContain('草稿用户说明');
    expect(snapshotBindings(db, result.data.revisionId)).toEqual(['snap_new_1']);
    expect(repository.requireSummary('dsch_update')).toMatchObject({
      currentRevisionId: result.data.revisionId,
      version: 2,
    });
  });

  it('正式方案有 working draft 时默认以 working draft 为文档和保存基线', async () => {
    const formalBinding = githubBinding('src_formal', REPO_A, OLD_A);
    insertDraft(documentFixture({ sources: [formalBinding], brief: '正式版本说明' }));
    db.prepare(`UPDATE design_schemes SET status = 'formal' WHERE id = ?`).run('dsch_update');
    const workingBinding = githubBinding('src_working', REPO_B, OLD_B);
    const working = repository.applyAgentRevision(
      'dsch_update',
      'dsrv_base',
      documentFixture({
        revisionId: 'dsrv_working',
        name: '待验证版本',
        brief: '待验证草稿说明',
        sources: [
          { id: 'src_history', kind: 'history-image', role: 'example', uri: 'history:item-1' },
          workingBinding,
        ],
        parameters: [
          { id: 'working_only', label: '草稿参数', type: 'boolean', userEditable: true },
        ],
      }),
    );
    expect(working.summary.workingDraftRevisionId).toBe('dsrv_working');
    upstream.set(REPO_B, githubSource(REPO_B, NEW_A));
    const requests: TextCompletionRequest[] = [];

    const result = await checkSchemeUpdate('dsch_update', {
      db,
      resolveAdapter: () => makeAdapter(requests),
    });

    expect(sourceMocks.resolveGithubSource).toHaveBeenCalledTimes(1);
    expect(sourceMocks.resolveGithubSource).toHaveBeenCalledWith(REPO_B);
    expect(result).toMatchObject({ ok: true, data: { status: 'draft-created' } });
    if (!result.ok || !result.data.revisionId) return;
    const summary = repository.requireSummary('dsch_update');
    expect(summary.currentRevisionId).toBe('dsrv_base');
    expect(summary.workingDraftRevisionId).toBe(result.data.revisionId);
    const updated = repository.getRevisionDocument(result.data.revisionId);
    expect(updated?.sources[0]).toEqual({
      id: 'src_history',
      kind: 'history-image',
      role: 'example',
      uri: 'history:item-1',
    });
    expect(updated?.parameters[0]?.id).toBe('working_only');
    expect(updated?.compilation.briefExcerpt).toBe('待验证草稿说明');
    expect(requests[0]?.user).toContain('待验证草稿说明');
  });

  it('正式方案有 working draft 时拒绝显式选择当前正式版本', async () => {
    const formalBinding = githubBinding('src_formal', REPO_A, OLD_A);
    insertDraft(documentFixture({ sources: [formalBinding], brief: '正式版本说明' }));
    db.prepare(`UPDATE design_schemes SET status = 'formal' WHERE id = ?`).run('dsch_update');
    repository.applyAgentRevision(
      'dsch_update',
      'dsrv_base',
      documentFixture({
        revisionId: 'dsrv_working',
        sources: [githubBinding('src_working', REPO_B, OLD_B)],
        brief: '权威草稿基线',
      }),
    );

    const result = await checkSchemeUpdate(
      'dsch_update',
      { db, resolveAdapter: () => makeAdapter() },
      'dsrv_base',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect(sourceMocks.resolveGithubSource).not.toHaveBeenCalled();
    expect(sourceMocks.persistGithubSnapshot).not.toHaveBeenCalled();
    expect(repository.requireSummary('dsch_update').workingDraftRevisionId).toBe('dsrv_working');
  });

  it('多来源只刷新变化的 GitHub 快照，并保留其他 GitHub、user brief 和 history 来源', async () => {
    const sources: SourceBinding[] = [
      { id: 'src_brief', kind: 'user-brief', role: 'context' },
      githubBinding('src_repo_a', REPO_A, OLD_A),
      { id: 'src_history', kind: 'history-image', role: 'example', uri: 'history:item-1' },
      {
        id: 'src_history_prompt',
        kind: 'conversation-turn',
        role: 'context',
        uri: 'history:item-1',
      },
      githubBinding('src_repo_b', REPO_B, OLD_B, 'reference'),
    ];
    const oldA = saveSnapshot({
      snapshotId: 'snap_old_a',
      packageId: 'pkg_old_a',
      repositoryUrl: REPO_A,
      commitHash: OLD_A,
    });
    const oldB = saveSnapshot({
      snapshotId: 'snap_old_b',
      packageId: 'pkg_old_b',
      repositoryUrl: REPO_B,
      commitHash: OLD_B,
      role: 'reference',
    });
    const history = saveSnapshot({
      snapshotId: 'snap_history',
      packageId: 'pkg_history',
      kind: 'history',
      role: 'example',
    });
    const brief = saveSnapshot({
      snapshotId: 'snap_brief',
      packageId: 'pkg_brief',
      kind: 'user-brief',
      role: 'context',
    });
    insertDraft(documentFixture({ sources, brief: '组合来源说明' }), [oldA, oldB, history, brief]);
    upstream.set(REPO_A, githubSource(REPO_A, NEW_A));
    upstream.set(REPO_B, githubSource(REPO_B, OLD_B));
    const requests: TextCompletionRequest[] = [];

    const result = await checkSchemeUpdate('dsch_update', {
      db,
      resolveAdapter: () => makeAdapter(requests),
    });

    expect(result).toMatchObject({ ok: true, data: { status: 'draft-created' } });
    if (!result.ok || !result.data.revisionId) return;
    const updated = repository.getRevisionDocument(result.data.revisionId);
    expect(updated?.sources).toEqual([
      sources[0],
      {
        ...githubBinding('src_repo_a', REPO_A, NEW_A),
        packageId: 'pkg_new_1',
        snapshotId: 'snap_new_1',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      sources[2],
      sources[3],
      sources[4],
    ]);
    expect(updated?.constraints[0]?.sourceIds).toEqual(['src_repo_a', 'src_repo_b']);
    expect(snapshotBindings(db, result.data.revisionId)).toEqual([
      'snap_brief',
      'snap_history',
      'snap_new_1',
      'snap_old_b',
    ]);
    expect(sourceMocks.persistGithubSnapshot).toHaveBeenCalledTimes(1);
    expect(requests.filter((request) => request.system.includes('仓库分析师'))).toHaveLength(1);
    const compilerRequest = requests.find((request) => request.system.includes('方案编译器'));
    expect(compilerRequest?.user).toContain('acme/source-a');
    expect(compilerRequest?.user).not.toContain('acme/source-b');
  });

  it('拒绝不符合 canonical 契约的上游数据，且不交给 AI 或快照持久化', async () => {
    const binding = githubBinding('src_repo', REPO_A, OLD_A);
    insertDraft(documentFixture({ sources: [binding] }));
    upstream.set(REPO_A, {
      ...githubSource(REPO_A, NEW_A),
      repositoryUrl: 'file:///Users/leak/repository',
    });
    const resolveAdapter = vi.fn(() => makeAdapter());

    const result = await checkSchemeUpdate('dsch_update', { db, resolveAdapter });

    expect(result).toMatchObject({ ok: false, error: { code: 'OUTPUT_SCHEMA_INVALID' } });
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(sourceMocks.persistGithubSnapshot).not.toHaveBeenCalled();
    expect(repository.requireSummary('dsch_update')).toMatchObject({
      currentRevisionId: 'dsrv_base',
      version: 1,
    });
  });

  it('AI 结果违反 canonical 文档安全约束时不持久化快照或 revision', async () => {
    const binding = githubBinding('src_repo', REPO_A, OLD_A);
    insertDraft(documentFixture({ sources: [binding] }));
    upstream.set(REPO_A, githubSource(REPO_A, NEW_A));
    const unsafeCompilerJson = JSON.stringify({
      ...JSON.parse(COMPILER_JSON),
      summary: '/Users/leak/secret',
    });

    const result = await checkSchemeUpdate('dsch_update', {
      db,
      resolveAdapter: () => makeAdapter([], unsafeCompilerJson),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'OUTPUT_SCHEMA_INVALID' } });
    expect(sourceMocks.persistGithubSnapshot).not.toHaveBeenCalled();
    expect(repository.requireSummary('dsch_update')).toMatchObject({
      currentRevisionId: 'dsrv_base',
      version: 1,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM design_scheme_revisions').get()).toEqual({
      count: 1,
    });
  });

  it('保存期间版本变化时回滚新快照、revision、绑定和版本指针', async () => {
    const binding = githubBinding('src_repo', REPO_A, OLD_A);
    const oldSnapshot = saveSnapshot({
      snapshotId: 'snap_old_a',
      packageId: 'pkg_old_a',
      repositoryUrl: REPO_A,
      commitHash: OLD_A,
    });
    insertDraft(documentFixture({ sources: [binding] }), [oldSnapshot]);
    upstream.set(REPO_A, githubSource(REPO_A, NEW_A));
    const initial = repository.requireSummary('dsch_update');
    const countsBefore = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM source_snapshots) AS snapshots,
           (SELECT COUNT(*) FROM design_scheme_revisions) AS revisions,
           (SELECT COUNT(*) FROM design_scheme_source_bindings) AS bindings`,
      )
      .get();
    db.exec(`
      CREATE TRIGGER bump_version_during_update_check
      AFTER INSERT ON source_snapshots
      WHEN NEW.id LIKE 'snap_new_%'
      BEGIN
        UPDATE design_schemes SET version = version + 1 WHERE id = 'dsch_update';
      END;
    `);

    const result = await checkSchemeUpdate('dsch_update', {
      db,
      resolveAdapter: () => makeAdapter(),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_STATE', retryable: true } });
    expect(
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM source_snapshots) AS snapshots,
             (SELECT COUNT(*) FROM design_scheme_revisions) AS revisions,
             (SELECT COUNT(*) FROM design_scheme_source_bindings) AS bindings`,
        )
        .get(),
    ).toEqual(countsBefore);
    expect(repository.requireSummary('dsch_update')).toMatchObject({
      currentRevisionId: 'dsrv_base',
      workingDraftRevisionId: null,
      version: initial.version,
    });
  });
});
