import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@shared/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '../migrations';
import { DesignSchemeRepository } from '../repositories';

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_run_1',
    schemeId: 'dsch_run_1',
    name: '运行切片测试方案',
    summary: '试运行/封面/转正仓储单测',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      { id: 'main_image', label: '主体图片', kind: 'image', required: true, imageRole: 'subject-reference' },
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '{{topic}}', variables: ['topic'], sourceIds: ['src_brief'] },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

describe('DesignSchemeRepository 运行切片', () => {
  let db: Database.Database;
  let repository: DesignSchemeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runDesignSchemeDbMigrations(db);
    repository = new DesignSchemeRepository(db);
    repository.insertSchemeDraft({
      document: documentFixture(),
      sourceLabel: 'Musefold 创建',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });
  });

  afterEach(() => {
    db.close();
  });

  function completeTrialRun(runId = 'dsr_1'): string {
    repository.insertRun({ runId, revisionId: 'dsrv_run_1', mode: 'trial', policy: {} });
    repository.updateRunStatus(runId, 'completed');
    return repository.insertLocalRunAsset('dsrv_run_1', '/tmp/trial-result.png');
  }

  it('新草稿没有成功试运行，转正被拒绝', () => {
    const summary = repository.requireSummary('dsch_run_1');
    expect(summary.status).toBe('draft');
    expect(summary.hasSuccessfulTrial).toBe(false);
    expect(() => repository.formalize('dsch_run_1')).toThrow(/成功的本机试运行/);
  });

  it('试运行完成但未选封面时仍不能转正', () => {
    completeTrialRun();
    expect(repository.requireSummary('dsch_run_1').hasSuccessfulTrial).toBe(true);
    expect(() => repository.formalize('dsch_run_1')).toThrow(/封面/);
  });

  it('成功试运行 + 封面后可转正，重复转正被拒绝', () => {
    const assetId = completeTrialRun();
    const withCover = repository.selectCover('dsch_run_1', assetId);
    expect(withCover.coverAssetId).toBe(assetId);
    expect(withCover.coverImagePath).toBe('/tmp/trial-result.png');

    const formal = repository.formalize('dsch_run_1');
    expect(formal.status).toBe('formal');
    expect(() => repository.formalize('dsch_run_1')).toThrow(/已是正式/);
  });

  it('封面只能选择本方案的资产', () => {
    completeTrialRun();
    expect(() => repository.selectCover('dsch_run_1', 'dsa_not_exists')).toThrow(/本方案的试运行结果/);
  });

  it('结构化编辑：图片槽位改可选并删除 → 新 revision，试运行校验重置', () => {
    completeTrialRun();
    expect(repository.requireSummary('dsch_run_1').hasSuccessfulTrial).toBe(true);

    const { summary, document } = repository.updateRevisionInputs('dsch_run_1', 'dsrv_run_1', [
      { id: 'topic', required: true },
      { id: 'main_image', required: false },
    ]);
    expect(summary.currentRevisionId).not.toBe('dsrv_run_1');
    expect(document.inputs.find((slot) => slot.id === 'main_image')?.required).toBe(false);
    // 新 revision 没有成功试运行记录 → 需重新试运行
    expect(summary.hasSuccessfulTrial).toBe(false);
    // 来源绑定被继承（文档 sources 不变）
    expect(document.sources).toEqual(documentFixture().sources);

    // 再删除图片槽位
    const removed = repository.updateRevisionInputs('dsch_run_1', summary.currentRevisionId, [
      { id: 'topic', required: true },
    ]);
    expect(removed.document.inputs.map((slot) => slot.id)).toEqual(['topic']);
  });

  it('结构化编辑守卫：模板引用的文本槽位不可删，过期版本/新增槽位被拒绝', () => {
    // topic 被 {{topic}} 引用 → 删除被拒
    expect(() => repository.updateRevisionInputs('dsch_run_1', 'dsrv_run_1', [
      { id: 'main_image', required: true },
    ])).toThrow(/被方案提示词模板引用/);
    // 新增未知槽位被拒
    expect(() => repository.updateRevisionInputs('dsch_run_1', 'dsrv_run_1', [
      { id: 'topic', required: true },
      { id: 'brand_new', required: false },
    ])).toThrow(/新增/);
    // 基于过期 revision 编辑被拒
    const { summary } = repository.updateRevisionInputs('dsch_run_1', 'dsrv_run_1', [
      { id: 'topic', required: true },
      { id: 'main_image', required: false },
    ]);
    expect(() => repository.updateRevisionInputs('dsch_run_1', 'dsrv_run_1', [
      { id: 'topic', required: true },
    ])).toThrow(/更新版本/);
    // 正式方案不允许结构化编辑
    const assetId = repository.insertLocalRunAsset(summary.currentRevisionId, '/tmp/x.png');
    repository.insertRun({ runId: 'dsr_new', revisionId: summary.currentRevisionId, mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_new', 'completed');
    repository.selectCover('dsch_run_1', assetId);
    repository.formalize('dsch_run_1');
    expect(() => repository.updateRevisionInputs('dsch_run_1', summary.currentRevisionId, [
      { id: 'topic', required: true },
    ])).toThrow(/正式方案/);
  });

  it('listAssets 返回方案全部相册资产（详情页数据源）', () => {
    expect(repository.listAssets('dsch_run_1')).toEqual([]);
    const first = repository.insertLocalRunAsset('dsrv_run_1', '/tmp/a.png');
    const second = repository.insertLocalRunAsset('dsrv_run_1', '/tmp/b.png');
    const assets = repository.listAssets('dsch_run_1');
    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.id)).toEqual(expect.arrayContaining([first, second]));
    expect(assets[0]).toMatchObject({
      revisionId: 'dsrv_run_1',
      role: 'example',
      origin: 'local-run',
    });
    expect(assets.map((asset) => asset.path)).toEqual(expect.arrayContaining(['/tmp/a.png', '/tmp/b.png']));
    // 其他方案查不到这些资产
    expect(repository.listAssets('dsch_other')).toEqual([]);
  });

  it('失败/取消的试运行不计入成功记录', () => {
    repository.insertRun({ runId: 'dsr_fail', revisionId: 'dsrv_run_1', mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_fail', 'failed');
    repository.insertRun({ runId: 'dsr_cancel', revisionId: 'dsrv_run_1', mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_cancel', 'cancelled');
    expect(repository.hasSuccessfulTrial('dsrv_run_1')).toBe(false);

    // 正式模式的运行也不满足「本机试运行」要求。
    repository.insertRun({ runId: 'dsr_formal', revisionId: 'dsrv_run_1', mode: 'formal', policy: {} });
    repository.updateRunStatus('dsr_formal', 'completed');
    expect(repository.hasSuccessfulTrial('dsrv_run_1')).toBe(false);
  });

  it('lastRunAt：完成运行后记录最近使用时间（选择器排序依据）', () => {
    expect(repository.requireSummary('dsch_run_1').lastRunAt).toBeNull();
    completeTrialRun();
    const afterTrial = repository.requireSummary('dsch_run_1').lastRunAt;
    expect(afterTrial).toBeTypeOf('number');
    // 失败运行不更新最近使用
    repository.insertRun({ runId: 'dsr_fail_last', revisionId: 'dsrv_run_1', mode: 'formal', policy: {} });
    repository.updateRunStatus('dsr_fail_last', 'failed');
    expect(repository.requireSummary('dsch_run_1').lastRunAt).toBe(afterTrial);
  });

  it('重命名：只改展示名并校验长度，软删后拒绝', () => {
    const renamed = repository.rename('dsch_run_1', '  新名字  ');
    expect(renamed.name).toBe('新名字');
    // 编译文档保持原名（不可变产物）
    expect(repository.getRevisionDocument('dsrv_run_1')?.name).toBe('运行切片测试方案');
    expect(() => repository.rename('dsch_run_1', '   ')).toThrow(/不能为空/);
    expect(() => repository.rename('dsch_run_1', '超'.repeat(81))).toThrow(/80/);

    repository.softDelete('dsch_run_1');
    expect(() => repository.rename('dsch_run_1', '再改')).toThrow(/不存在/);
  });

  it('软删除：从列表消失但运行记录保留，重复删除被拒绝', () => {
    completeTrialRun();
    repository.softDelete('dsch_run_1');
    expect(repository.listSummaries()).toEqual([]);
    expect(() => repository.requireSummary('dsch_run_1')).toThrow(/不存在/);
    // 历史运行记录不受影响（可追溯）
    const runs = db.prepare('SELECT COUNT(*) AS n FROM design_scheme_runs').get() as { n: number };
    expect(runs.n).toBe(1);
    expect(() => repository.softDelete('dsch_run_1')).toThrow(/不存在/);
  });

  it('listSourceFiles：返回当前 revision 绑定的快照与文件清单', () => {
    // 无绑定时为空数组
    expect(repository.listSourceFiles('dsch_run_1')).toEqual([]);

    const snapshot = repository.saveSourceSnapshot({
      package: { id: 'pkg_src', kind: 'github', repositoryUrl: 'https://github.com/acme/poster', license: 'MIT' },
      snapshot: { id: 'snap_src', ref: 'main', commitHash: 'abc123def456', totalBytes: 30, scan: {} },
      files: [
        { path: 'SKILL.md', kind: 'text', contentHash: 'h1', sizeBytes: 20, textContent: '# 规则\n双色印刷' },
        { path: 'examples/a.png', kind: 'image', contentHash: 'h2', sizeBytes: 10, storeKey: 'design-scheme-sources/snap_src/examples/a.png' },
      ],
    });
    db.prepare(
      `INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role) VALUES (?, ?, 'normative')`,
    ).run('dsrv_run_1', snapshot.snapshotId);

    const details = repository.listSourceFiles('dsch_run_1');
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      snapshotId: 'snap_src',
      packageKind: 'github',
      repositoryUrl: 'https://github.com/acme/poster',
      commitHash: 'abc123def456',
      license: 'MIT',
    });
    expect(details[0].files).toHaveLength(2);
    expect(details[0].files.find((file) => file.path === 'SKILL.md')?.textExcerpt).toContain('双色印刷');
    expect(details[0].files.find((file) => file.path === 'examples/a.png')?.storeKey).toContain('snap_src');
  });

  it('applyAgentRevision（草稿）：新 revision 直接替换当前版本，过期基线被拒绝', () => {
    const revised = {
      ...documentFixture(),
      revisionId: 'dsrv_run_2',
      name: '修改后的方案',
      summary: '标题区域更宽',
    };
    const { summary, document } = repository.applyAgentRevision('dsch_run_1', 'dsrv_run_1', revised);
    expect(summary.status).toBe('draft');
    expect(summary.currentRevisionId).toBe('dsrv_run_2');
    expect(summary.workingDraftRevisionId).toBeNull();
    expect(summary.name).toBe('修改后的方案');
    expect(document.revisionId).toBe('dsrv_run_2');
    // 来源绑定继承基线；基于过期基线的修改被拒绝
    expect(() => repository.applyAgentRevision('dsch_run_1', 'dsrv_run_1', {
      ...documentFixture(),
      revisionId: 'dsrv_run_3',
    })).toThrow(/更新版本/);
  });

  it('applyAgentRevision（正式）→ promoteWorkingDraft：正式版本保持可用，新版本试运行后才替换', () => {
    // 先转正
    const assetId = completeTrialRun();
    repository.selectCover('dsch_run_1', assetId);
    repository.formalize('dsch_run_1');

    const revised = {
      ...documentFixture(),
      revisionId: 'dsrv_working_1',
      name: '正式方案的新版本',
      summary: '默认比例改成 3:4',
    };
    const { summary } = repository.applyAgentRevision('dsch_run_1', 'dsrv_run_1', revised);
    // 正式版本不动；新内容只挂在待验证草稿上，展示名保持正式版本
    expect(summary.status).toBe('formal');
    expect(summary.currentRevisionId).toBe('dsrv_run_1');
    expect(summary.workingDraftRevisionId).toBe('dsrv_working_1');
    expect(summary.name).toBe('运行切片测试方案');

    // 新版本还没有成功试运行 → 不能替换正式版本
    expect(() => repository.promoteWorkingDraft('dsch_run_1')).toThrow(/成功的本机试运行/);

    // 在待验证草稿之上继续修改（基线是 workingDraft）
    const secondPass = repository.applyAgentRevision('dsch_run_1', 'dsrv_working_1', {
      ...documentFixture(),
      revisionId: 'dsrv_working_2',
      name: '正式方案的新版本 v2',
    });
    expect(secondPass.summary.workingDraftRevisionId).toBe('dsrv_working_2');

    // 完成新版本的本机试运行后可替换
    repository.insertRun({ runId: 'dsr_wd', revisionId: 'dsrv_working_2', mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_wd', 'completed');
    const promoted = repository.promoteWorkingDraft('dsch_run_1');
    expect(promoted.currentRevisionId).toBe('dsrv_working_2');
    expect(promoted.workingDraftRevisionId).toBeNull();
    expect(promoted.name).toBe('正式方案的新版本 v2');
    expect(() => repository.promoteWorkingDraft('dsch_run_1')).toThrow(/没有待验证/);
  });

  it('applyAgentRevision 附加来源绑定（检查更新写入新快照）', () => {
    const snapshot = repository.saveSourceSnapshot({
      package: { id: 'pkg_upd', kind: 'github', repositoryUrl: 'https://github.com/acme/poster' },
      snapshot: { id: 'snap_upd', ref: 'main', commitHash: 'ffff0000', totalBytes: 0, scan: {} },
      files: [],
    });
    const { document } = repository.applyAgentRevision('dsch_run_1', 'dsrv_run_1', {
      ...documentFixture(),
      revisionId: 'dsrv_upd_1',
    }, [{ snapshotId: snapshot.snapshotId, role: 'normative' }]);
    const bindings = db.prepare(
      'SELECT source_snapshot_id, role FROM design_scheme_source_bindings WHERE revision_id = ?',
    ).all(document.revisionId) as Array<{ source_snapshot_id: string; role: string }>;
    expect(bindings).toEqual(expect.arrayContaining([
      { source_snapshot_id: 'snap_upd', role: 'normative' },
    ]));
  });

  it('运行步骤 upsert：同 step 覆盖状态并保留已有输入输出', () => {
    repository.insertRun({ runId: 'dsr_steps', revisionId: 'dsrv_run_1', mode: 'trial', policy: {} });
    repository.upsertRunStep('dsr_steps', 'compile-prompt', { status: 'running', input: { modules: 1 } });
    repository.upsertRunStep('dsr_steps', 'compile-prompt', { status: 'completed', output: { promptLength: 42 } });

    const row = db.prepare(
      'SELECT status, input_json, output_json, completed_at FROM design_scheme_run_steps WHERE run_id = ? AND step_id = ?',
    ).get('dsr_steps', 'compile-prompt') as {
      status: string;
      input_json: string | null;
      output_json: string | null;
      completed_at: number | null;
    };
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.input_json ?? '{}')).toEqual({ modules: 1 });
    expect(JSON.parse(row.output_json ?? '{}')).toEqual({ promptLength: 42 });
    expect(row.completed_at).not.toBeNull();
  });
});
