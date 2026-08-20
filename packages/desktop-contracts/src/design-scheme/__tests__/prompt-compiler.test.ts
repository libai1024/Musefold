import { describe, expect, it } from 'vitest';
import { MULTI_IMAGE_INDEX_HINT, RATIO_CONSTRAINT_PREFIX } from '@musefold/domain/generation-prompt';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '../schema';
import { compileSchemePrompt, missingRequiredSlots } from '../prompt-compiler';

function documentFixture(
  overrides: Partial<DesignSchemeRevisionDocument> = {},
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_pc',
    schemeId: 'dsch_pc',
    name: '测试方案',
    summary: '编译器单测夹具',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      { id: 'subject', label: '主体图片', kind: 'image', required: true, imageRole: 'subject-reference' },
      { id: 'mood', label: '情绪', kind: 'text', required: false },
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      // 故意乱序写入，验证按 order 而非数组顺序拼接。
      { id: 'pm_2', order: 1, kind: 'style-rule', template: '极简版式，双色印刷', variables: [], sourceIds: ['src_brief'] },
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」设计海报，情绪基调 {{mood}}', variables: ['topic', 'mood'], sourceIds: ['src_brief'] },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    ...overrides,
  };
}

describe('compileSchemePrompt', () => {
  it('按 order 拼接模块并代入变量值', () => {
    const { prompt, unresolvedVariables } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: '城市夜行', mood: '克制冷静' },
      brief: '',
      imageCount: 1,
      ratioId: 'auto',
    });
    expect(prompt).toBe('为「城市夜行」设计海报，情绪基调 克制冷静\n\n极简版式，双色印刷');
    expect(unresolvedVariables).toEqual([]);
  });

  it('缺失变量按空值代入并回报 unresolvedVariables', () => {
    const { prompt, unresolvedVariables } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: '城市夜行' },
      brief: '',
      imageCount: 0,
      ratioId: 'auto',
    });
    expect(prompt).toContain('为「城市夜行」设计海报，情绪基调');
    expect(prompt).not.toContain('{{');
    expect(unresolvedVariables).toEqual(['mood']);
  });

  it('用户补充追加在方案文本之后，不覆盖方案规则', () => {
    const { prompt } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '背景偏暖一点',
      imageCount: 1,
      ratioId: 'auto',
    });
    const briefIndex = prompt.indexOf('补充要求（不改变方案核心规则）：\n背景偏暖一点');
    expect(briefIndex).toBeGreaterThan(prompt.indexOf('极简版式'));
  });

  it('多图时前置图 N 编号说明，非 auto 比例时追加比例约束', () => {
    const { prompt } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '',
      imageCount: 2,
      ratioId: '1:1',
    });
    expect(prompt.startsWith(MULTI_IMAGE_INDEX_HINT)).toBe(true);
    expect(prompt).toContain(RATIO_CONSTRAINT_PREFIX);
  });

  it('单图不加编号说明，auto 比例不加约束', () => {
    const { prompt } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '',
      imageCount: 1,
      ratioId: 'auto',
    });
    expect(prompt).not.toContain(MULTI_IMAGE_INDEX_HINT);
    expect(prompt).not.toContain(RATIO_CONSTRAINT_PREFIX);
  });

  it('user_first：用户要求置于方案文本之前并声明优先', () => {
    const { prompt, policySummary } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '改成横版构图',
      imageCount: 0,
      ratioId: 'auto',
      priorityMode: 'user_first',
    });
    const briefIndex = prompt.indexOf('用户本次要求（优先；与后文方案规则冲突时，以本段为准）：\n改成横版构图');
    expect(briefIndex).toBeGreaterThanOrEqual(0);
    expect(briefIndex).toBeLessThan(prompt.indexOf('极简版式'));
    expect(policySummary).toContain('用户主导');
  });

  it('agent_mediated：补充要求带自动协调说明', () => {
    const { prompt, policySummary } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '更亮一些',
      imageCount: 0,
      ratioId: 'auto',
      priorityMode: 'agent_mediated',
    });
    expect(prompt).toContain('补充要求：\n更亮一些\n（若与方案规则冲突，请以整体视觉质量为先自动协调取舍）');
    expect(prompt.indexOf('更亮一些')).toBeGreaterThan(prompt.indexOf('极简版式'));
    expect(policySummary).toContain('智能协调');
  });

  it('缺省与 scheme_first 等价，策略摘要标注方案主导', () => {
    const base = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '背景偏暖',
      imageCount: 0,
      ratioId: 'auto',
    });
    const explicit = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '背景偏暖',
      imageCount: 0,
      ratioId: 'auto',
      priorityMode: 'scheme_first',
    });
    expect(base.prompt).toBe(explicit.prompt);
    expect(base.policySummary).toContain('方案主导');
  });
});

describe('missingRequiredSlots', () => {
  it('必填文本槽位缺值 / 空白值视为缺失', () => {
    const document = documentFixture();
    expect(missingRequiredSlots(document, {}, 1).map((slot) => slot.id)).toEqual(['topic']);
    expect(missingRequiredSlots(document, { topic: '   ' }, 1).map((slot) => slot.id)).toEqual(['topic']);
  });

  it('必填图片槽位按参考图数量校验，可选槽位不参与', () => {
    const document = documentFixture();
    expect(missingRequiredSlots(document, { topic: 'x' }, 0).map((slot) => slot.id)).toEqual(['subject']);
    expect(missingRequiredSlots(document, { topic: 'x' }, 1)).toEqual([]);
  });

  it('image-set 按 minItems 计数', () => {
    const document = documentFixture({
      inputs: [
        { id: 'refs', label: '参考图组', kind: 'image-set', required: true, minItems: 2, imageRole: 'style-reference' },
      ],
    });
    expect(missingRequiredSlots(document, {}, 1).map((slot) => slot.id)).toEqual(['refs']);
    expect(missingRequiredSlots(document, {}, 2)).toEqual([]);
  });
});
