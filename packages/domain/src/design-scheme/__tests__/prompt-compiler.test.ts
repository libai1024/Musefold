import type { DesignSchemeRevisionDocument } from '@musefold/contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { MULTI_IMAGE_INDEX_HINT, RATIO_CONSTRAINT_PREFIX } from '../../generation-prompt';
import {
  compileSchemePrompt,
  type DesignSchemePromptDocument,
  describePriorityMode,
  missingRequiredSlots,
  PRIORITY_MODE_LABEL,
} from '../prompt-compiler';

type CanonicalPromptDocument = Pick<DesignSchemeRevisionDocument, 'inputs' | 'promptProgram'>;

interface LegacyPromptDocument {
  inputs: Array<{
    id: string;
    label: string;
    kind: 'text' | 'image' | 'image-set' | 'article' | 'choice';
    required: boolean;
    minItems?: number;
    imageRole?: string;
  }>;
  promptProgram: Array<{
    id: string;
    order: number;
    kind: string;
    template: string;
    variables: string[];
    sourceIds: string[];
  }>;
}

function documentFixture(
  overrides: Partial<CanonicalPromptDocument> = {},
): CanonicalPromptDocument {
  return {
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      {
        id: 'subject',
        label: '主体图片',
        kind: 'image',
        required: true,
        imageRole: 'subject-reference',
      },
      { id: 'mood', label: '情绪', kind: 'text', required: false },
    ],
    promptProgram: [
      {
        id: 'pm_2',
        order: 1,
        kind: 'style-rule',
        template: '极简版式，双色印刷',
        variables: [],
        sourceIds: ['src_brief'],
      },
      {
        id: 'pm_1',
        order: 0,
        kind: 'input-template',
        template: '为「{{topic}}」设计海报，情绪基调 {{mood}}',
        variables: ['topic', 'mood'],
        sourceIds: ['src_brief'],
      },
    ],
    ...overrides,
  };
}

function legacyDocumentFixture(): LegacyPromptDocument {
  return {
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      {
        id: 'subject',
        label: '主体图片',
        kind: 'image',
        required: true,
        imageRole: 'subject-reference',
      },
    ],
    promptProgram: [
      {
        id: 'pm_1',
        order: 0,
        kind: 'input-template',
        template: '为「{{topic}}」设计海报',
        variables: ['topic'],
        sourceIds: ['src_brief'],
      },
    ],
  };
}

describe('design-scheme prompt compiler contracts', () => {
  it('accepts canonical and legacy structural document fields', () => {
    const canonical: CanonicalPromptDocument = documentFixture();
    const legacy: LegacyPromptDocument = legacyDocumentFixture();

    expectTypeOf(canonical).toMatchTypeOf<DesignSchemePromptDocument>();
    expectTypeOf(legacy).toMatchTypeOf<DesignSchemePromptDocument>();
    expect(
      compileSchemePrompt({
        document: canonical,
        inputValues: { topic: '城市夜行' },
        brief: '',
        imageCount: 1,
        ratioId: 'auto',
      }).prompt,
    ).toContain('城市夜行');
    expect(
      compileSchemePrompt({
        document: legacy,
        inputValues: { topic: '城市夜行' },
        brief: '',
        imageCount: 1,
        ratioId: 'auto',
      }).prompt,
    ).toBe('为「城市夜行」设计海报');
  });

  it('preserves exact priority labels and descriptions', () => {
    expect(PRIORITY_MODE_LABEL).toEqual({
      user_first: '用户主导',
      scheme_first: '方案主导',
      agent_mediated: '智能协调',
    });
    expect(describePriorityMode('user_first')).toBe('用户本次输入优先；方案核心规则只作为参考');
    expect(describePriorityMode('scheme_first')).toBe(
      '方案核心规则优先；用户输入填充方案声明的变量',
    );
    expect(describePriorityMode('agent_mediated')).toBe(
      '按方案证据与用户目标自动取舍，结果写入摘要',
    );
  });
});

describe('compileSchemePrompt', () => {
  it('orders modules and substitutes trimmed input values', () => {
    const { prompt, unresolvedVariables } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: ' 城市夜行 ', mood: ' 克制冷静 ' },
      brief: '',
      imageCount: 1,
      ratioId: 'auto',
    });
    expect(prompt).toBe('为「城市夜行」设计海报，情绪基调 克制冷静\n\n极简版式，双色印刷');
    expect(unresolvedVariables).toEqual([]);
  });

  it('removes unresolved placeholders and reports variables in encounter order', () => {
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

  it('appends the default brief without changing scheme priority', () => {
    const { prompt, policySummary } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: ' 背景偏暖一点 ',
      imageCount: 1,
      ratioId: 'auto',
    });
    expect(prompt).toBe(
      '为「A」设计海报，情绪基调 B\n\n极简版式，双色印刷\n\n补充要求（不改变方案核心规则）：\n背景偏暖一点',
    );
    expect(policySummary).toBe('方案主导 · 方案核心规则优先；用户输入填充方案声明的变量');
  });

  it('adds the existing multi-image hint and ratio constraint', () => {
    const { prompt } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '',
      imageCount: 2,
      ratioId: '1:1',
    });
    expect(prompt).toBe(
      `${MULTI_IMAGE_INDEX_HINT}\n\n为「A」设计海报，情绪基调 B\n\n极简版式，双色印刷\n\n${RATIO_CONSTRAINT_PREFIX}严格按照 1:1 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`,
    );
  });

  it('does not add an image hint for one image or a ratio constraint for auto', () => {
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

  it('places user-first requirements before scheme text and declares precedence', () => {
    const { prompt, policySummary } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '改成横版构图',
      imageCount: 0,
      ratioId: 'auto',
      priorityMode: 'user_first',
    });
    expect(prompt).toBe(
      '用户本次要求（优先；与后文方案规则冲突时，以本段为准）：\n改成横版构图\n\n为「A」设计海报，情绪基调 B\n\n极简版式，双色印刷',
    );
    expect(policySummary).toBe('用户主导 · 用户本次输入优先；方案核心规则只作为参考');
  });

  it('appends the agent-mediated coordination instruction', () => {
    const { prompt, policySummary } = compileSchemePrompt({
      document: documentFixture(),
      inputValues: { topic: 'A', mood: 'B' },
      brief: '更亮一些',
      imageCount: 0,
      ratioId: 'auto',
      priorityMode: 'agent_mediated',
    });
    expect(prompt).toBe(
      '为「A」设计海报，情绪基调 B\n\n极简版式，双色印刷\n\n补充要求：\n更亮一些\n（若与方案规则冲突，请以整体视觉质量为先自动协调取舍）',
    );
    expect(policySummary).toBe('智能协调 · 按方案证据与用户目标自动取舍，结果写入摘要');
  });

  it('keeps omitted and explicit scheme-first modes equivalent', () => {
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
    expect(base).toEqual(explicit);
  });
});

describe('missingRequiredSlots', () => {
  it('treats missing and blank required text values as missing', () => {
    const document = documentFixture();
    expect(missingRequiredSlots(document, {}, 1).map((slot) => slot.id)).toEqual(['topic']);
    expect(missingRequiredSlots(document, { topic: '   ' }, 1).map((slot) => slot.id)).toEqual([
      'topic',
    ]);
  });

  it('counts required image slots cumulatively and ignores optional slots', () => {
    const document = documentFixture({
      inputs: [
        { id: 'optional', label: '可选图', kind: 'image', required: false },
        { id: 'subject', label: '主体图', kind: 'image', required: true },
        { id: 'layout', label: '版式图', kind: 'image', required: true },
      ],
    });
    expect(missingRequiredSlots(document, {}, 0).map((slot) => slot.id)).toEqual([
      'subject',
      'layout',
    ]);
    expect(missingRequiredSlots(document, {}, 1).map((slot) => slot.id)).toEqual(['layout']);
    expect(missingRequiredSlots(document, {}, 2)).toEqual([]);
  });

  it('counts image-set minItems while preserving the original slot type', () => {
    const document = documentFixture({
      inputs: [
        {
          id: 'refs',
          label: '参考图组',
          kind: 'image-set',
          required: true,
          minItems: 2,
          imageRole: 'style-reference',
        },
      ],
    });
    const missing = missingRequiredSlots(document, {}, 1);
    expectTypeOf(missing).toEqualTypeOf<CanonicalPromptDocument['inputs'][number][]>();
    expect(missing.map((slot) => slot.id)).toEqual(['refs']);
    expect(missingRequiredSlots(document, {}, 2)).toEqual([]);
  });
});
