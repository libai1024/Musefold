import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@shared/design-scheme/schema';
import type { DesignSchemeCreationEvent } from '@shared/types/design-scheme';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { DesignSchemeModifySession } from '../modify-session';
import type { OpenAiCompatibleTextAdapter, TextCompletionRequest } from '../text-adapter';

const REVISED_JSON = JSON.stringify({
  name: '极简杂志海报 3:4',
  summary: '双色印刷版式方案（默认 3:4）',
  fidelity: 'adapted',
  inputs: [{ label: '海报主题', kind: 'text', required: true, variable: 'topic', description: '一句话主题' }],
  constraints: [
    { domain: 'output', statement: '默认输出 3:4 竖版', mode: 'required', userOverridable: true, evidencePaths: [] },
  ],
  promptProgram: [
    { kind: 'input-template', template: '为「{{topic}}」设计极简杂志海报', variables: ['topic'] },
    { kind: 'style-rule', template: '双色印刷质感，标题区域加宽，3:4 竖版', variables: [] },
  ],
  adopted: ['双色规则'],
  omitted: [],
  warnings: ['比例调整偏离了原始来源'],
  creationSummary: '已把默认比例改成 3:4 并加宽标题区域，请重新试运行验证。',
});

function makeAdapter(): OpenAiCompatibleTextAdapter {
  return {
    modelId: 'test-model',
    connectionName: 'test-conn',
    complete: async (request: TextCompletionRequest) => {
      if (request.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      expect(request.system).toContain('方案修订器');
      return { text: REVISED_JSON, model: 'test-model' };
    },
  } as unknown as OpenAiCompatibleTextAdapter;
}

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_base',
    schemeId: 'dsch_mod',
    name: '极简杂志海报',
    summary: '双色印刷版式方案',
    fidelity: 'faithful',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [{ id: 'topic', label: '海报主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [
      { id: 'con_1', domain: 'color', statement: '只用两种油墨色', mode: 'required', userOverridable: false, sourceIds: ['src_brief'] },
    ],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」设计海报', variables: ['topic'], sourceIds: ['src_brief'] },
      { id: 'pm_2', order: 1, kind: 'style-rule', template: '双色印刷质感', variables: [], sourceIds: ['src_brief'] },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      briefExcerpt: '做一个双色海报方案',
      trace: [],
    },
  };
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  return db;
}

describe('DesignSchemeModifySession', () => {
  let db: Database.Database;
  let repository: DesignSchemeRepository;
  let events: DesignSchemeCreationEvent[];

  beforeEach(() => {
    db = makeDb();
    repository = new DesignSchemeRepository(db);
    repository.insertSchemeDraft({
      document: documentFixture(),
      sourceLabel: 'Musefold 创建',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });
    events = [];
  });

  const collect = (event: DesignSchemeCreationEvent) => events.push(event);
  const states = () => events.filter((event) => event.kind === 'state').map((event) => (event as { state: string }).state);

  it('草稿修改：Agent 输出新版本并直接替换当前草稿', async () => {
    const session = new DesignSchemeModifySession(
      { executionId: 'mod-1', schemeId: 'dsch_mod', baseRevisionId: 'dsrv_base', instruction: '把默认比例改成 3:4' },
      { db, resolveAdapter: makeAdapter, emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheme.status).toBe('draft');
    expect(result.data.scheme.name).toBe('极简杂志海报 3:4');
    expect(result.data.scheme.currentRevisionId).toBe(result.data.revisionId);
    expect(result.data.scheme.workingDraftRevisionId).toBeNull();
    expect(result.data.creationSummary).toContain('3:4');
    expect(states()).toEqual(['created', 'compiling_scheme', 'draft_ready']);

    const document = repository.getRevisionDocument(result.data.revisionId);
    expect(document?.constraints[0]?.statement).toContain('3:4');
    // 修订沿用基线来源（不引入新来源）
    expect(document?.sources).toEqual(documentFixture().sources);
    expect(document?.constraints[0]?.sourceIds).toEqual(['src_brief']);
    expect(document?.compilation.briefExcerpt).toContain('把默认比例改成 3:4');
  });

  it('正式方案修改：正式版本不动，新版本落入待验证草稿', async () => {
    // 转正前置：成功试运行 + 封面
    repository.insertRun({ runId: 'dsr_ok', revisionId: 'dsrv_base', mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_ok', 'completed');
    const assetId = repository.insertLocalRunAsset('dsrv_base', '/tmp/cover.png');
    repository.selectCover('dsch_mod', assetId);
    repository.formalize('dsch_mod');

    const session = new DesignSchemeModifySession(
      { executionId: 'mod-2', schemeId: 'dsch_mod', baseRevisionId: 'dsrv_base', instruction: '标题区域加宽' },
      { db, resolveAdapter: makeAdapter, emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheme.status).toBe('formal');
    expect(result.data.scheme.currentRevisionId).toBe('dsrv_base');
    expect(result.data.scheme.workingDraftRevisionId).toBe(result.data.revisionId);
    // 展示名保持正式版本
    expect(result.data.scheme.name).toBe('极简杂志海报');
    const saveTrace = events.filter((event) => event.kind === 'trace')
      .map((event) => (event as { item: { id: string; detail?: string } }).item)
      .find((item) => item.id === 'save-revision');
    expect(saveTrace?.detail).toContain('正式版本保持可用');
  });

  it('没有可用文本模型时直接阻断并提示配置 AI', async () => {
    const session = new DesignSchemeModifySession(
      { executionId: 'mod-3', schemeId: 'dsch_mod', baseRevisionId: 'dsrv_base', instruction: '随便改点' },
      { db, resolveAdapter: () => null, emit: collect },
    );
    const result = await session.run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('AUTH_REQUIRED');
    expect(states()).toEqual(['created', 'blocked']);
    // 阻断不产生新版本
    expect(repository.requireSummary('dsch_mod').currentRevisionId).toBe('dsrv_base');
  });
});
