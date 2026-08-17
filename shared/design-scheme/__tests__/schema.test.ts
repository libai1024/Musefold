import { describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  parseDesignSchemeRevisionDocument,
  type DesignSchemeRevisionDocument,
} from '../schema';
import { analystReportSchema, compilerOutputSchema } from '../agents';

function validDocument(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_1',
    schemeId: 'dsch_1',
    name: '极简杂志海报',
    summary: '基于 gc-minimal-zine-poster 的版式方案',
    fidelity: 'faithful',
    sources: [
      { id: 'src_repo', kind: 'github-skill', role: 'normative', uri: 'https://github.com/a/b', ref: 'main', commit: 'abc' },
    ],
    inputs: [
      { id: 'input_1', label: '主题描述', kind: 'text', required: true },
      { id: 'input_2', label: '主体图片', kind: 'image', required: false, imageRole: 'subject-reference' },
    ],
    parameters: [],
    constraints: [
      { id: 'con_1', domain: 'composition', statement: '大面积留白，主体置于下三分之一', mode: 'required', sourceIds: ['src_repo'], userOverridable: false },
    ],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」设计海报', variables: ['topic'], sourceIds: ['src_repo'] },
      { id: 'pm_2', order: 1, kind: 'style-rule', template: '极简杂志风，网格排版', variables: [], sourceIds: ['src_repo'] },
    ],
    compilation: {
      compiledAt: 1_700_000_000_000,
      model: { model: 'gpt-5.4-mini', connectionName: 'TvT' },
      adopted: ['留白构图规则'],
      omitted: ['需要执行脚本的排版工具'],
      warnings: [],
      briefExcerpt: '做一个杂志海报方案',
      trace: [{ id: 'analyst', title: 'Repository Analyst 分析仓库', status: 'success', durationMs: 1200 }],
    },
  };
}

describe('designSchemeRevisionDocumentSchema', () => {
  it('接受完整合法文档', () => {
    const parsed = parseDesignSchemeRevisionDocument(validDocument());
    expect(parsed.ok).toBe(true);
  });

  it('拒绝缺少提示词模块的文档并给出路径化 issues', () => {
    const document = { ...validDocument(), promptProgram: [] };
    const parsed = parseDesignSchemeRevisionDocument(document);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.some((issue) => issue.path.startsWith('promptProgram'))).toBe(true);
    }
  });

  it('拒绝未知 fidelity 与超长名称', () => {
    const bad = { ...validDocument(), fidelity: 'perfect', name: 'x'.repeat(200) };
    const parsed = parseDesignSchemeRevisionDocument(bad);
    expect(parsed.ok).toBe(false);
  });
});

describe('agent 输出契约', () => {
  it('analystReportSchema 补默认值', () => {
    const parsed = analystReportSchema.safeParse({
      repoKind: 'agent-skill',
      capabilitySummary: '极简杂志海报生成',
      rules: [{ domain: 'color', statement: '双色印刷', mode: 'required' }],
      variables: [{ label: '主题', kind: 'text', required: true }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rules[0]?.evidencePaths).toEqual([]);
      expect(parsed.data.unsupported).toEqual([]);
      expect(parsed.data.referenceImages).toEqual([]);
    }
  });

  it('compilerOutputSchema 要求至少一个输入与提示词模块', () => {
    const parsed = compilerOutputSchema.safeParse({
      name: '方案',
      summary: '简介',
      fidelity: 'adapted',
      inputs: [],
      constraints: [],
      promptProgram: [],
      creationSummary: '说明',
    });
    expect(parsed.success).toBe(false);
  });
});
