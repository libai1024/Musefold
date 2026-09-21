import { describe, expect, it } from 'vitest';
import {
  analystReportSchema,
  compilerOutputSchema,
  analystInputSchema,
  compilerInputSchema,
} from '../design-scheme-model';

const output = {
  name: '城市海报',
  summary: '可复用的城市海报规则',
  fidelity: 'adapted',
  inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
  constraints: [
    { domain: 'color', statement: '使用双色', mode: 'preferred', userOverridable: true },
  ],
  promptProgram: [{ kind: 'input-template', template: '{{topic}}' }],
  creationSummary: '提供主题并先试运行。',
};

describe('shared design-scheme model contracts', () => {
  it('strips model-supplied storage identities before the runtime assigns them', () => {
    const parsed = compilerOutputSchema.parse({
      ...output,
      schemeId: 'model-chosen',
      ownerId: 'other-owner',
      inputs: [{ ...output.inputs[0], id: 'model-chosen-input' }],
      constraints: [{ ...output.constraints[0], sourceIds: ['other-source'] }],
      promptProgram: [
        { ...output.promptProgram[0], id: 'module', order: 999, sourceIds: ['other'] },
      ],
    });
    expect(parsed).not.toHaveProperty('schemeId');
    expect(parsed).not.toHaveProperty('ownerId');
    expect(parsed.inputs[0]).not.toHaveProperty('id');
    expect(parsed.constraints[0]).not.toHaveProperty('sourceIds');
    expect(parsed.promptProgram[0]).not.toHaveProperty('order');
    expect(parsed.promptProgram[0]).not.toHaveProperty('sourceIds');
    expect(parsed.promptProgram[0]?.variables).toEqual([]);
    expect(parsed.constraints[0]?.evidencePaths).toEqual([]);
    expect(parsed.adopted).toEqual([]);
    expect(parsed.omitted).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('rejects invalid roles, missing runnable input, oversized output and unsupported enums', () => {
    for (const patch of [
      { inputs: [] },
      { inputs: Array(25).fill(output.inputs[0]) },
      { promptProgram: [] },
      { creationSummary: '' },
      { name: 'x'.repeat(121) },
      { fidelity: 'guaranteed' },
      { constraints: [{ ...output.constraints[0], mode: 'execute-shell' }] },
      { inputs: [{ ...output.inputs[0], imageRole: 'filesystem' }] },
    ]) {
      expect(compilerOutputSchema.safeParse({ ...output, ...patch }).success).toBe(false);
    }
  });

  it('preserves analyst evidence and unsupported capabilities without accepting runtime IDs', () => {
    const report = analystReportSchema.parse({
      repoKind: 'workflow-config',
      capabilitySummary: '需要外部执行器的视觉工作流',
      rules: [
        {
          domain: 'texture',
          statement: '纸张质感',
          mode: 'preferred',
          evidencePaths: ['README.md'],
          id: 'untrusted',
        },
      ],
      variables: [],
      unsupported: ['需要运行外部脚本'],
      sourceIds: ['injected'],
    });
    expect(report.rules[0]?.evidencePaths).toEqual(['README.md']);
    expect(report.rules[0]).not.toHaveProperty('id');
    expect(report).not.toHaveProperty('sourceIds');
    expect(report.unsupported).toEqual(['需要运行外部脚本']);
    expect(report.referenceImages).toEqual([]);
    expect(
      analystReportSchema.safeParse({ ...report, rules: Array(61).fill(report.rules[0]) }).success,
    ).toBe(false);
  });

  it('projects only role input fields and does not turn prompt data into model authorization', () => {
    expect(
      analystInputSchema.parse({
        brief: '',
        repositoryLabel: 'a/b',
        textFiles: [],
        imagePaths: [],
        license: null,
        credential: 'synthetic-private',
      }),
    ).not.toHaveProperty('credential');
    expect(compilerInputSchema.parse({ brief: 'poster', maxCalls: 100, payer: 'other' })).toEqual({
      brief: 'poster',
    });
    expect(
      compilerInputSchema.safeParse({
        brief: 'poster',
        historyContext: { imageCount: -1, prompts: [] },
      }).success,
    ).toBe(false);
  });
});
