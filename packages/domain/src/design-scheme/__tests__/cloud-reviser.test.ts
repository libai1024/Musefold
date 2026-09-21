import { describe, expect, it } from 'vitest';
import { buildCloudCompiledDocument } from '../cloud-compiler';
import { buildCloudRevisedDocument } from '../cloud-reviser';
const output = () => ({
  name: '海报',
  summary: '黑白海报',
  fidelity: 'adapted',
  inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
  constraints: [],
  promptProgram: [
    { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
    { kind: 'style-rule', template: '黑白', variables: [] },
  ],
  creationSummary: '重新试运行',
});
const now = '2026-09-09T00:00:00Z';
const base = () =>
  buildCloudCompiledDocument(output(), [], {
    schemeId: 'scheme',
    revisionId: 'base',
    now,
    model: 'text',
    brief: 'base',
  });
const revised = (raw: unknown, document = base()) =>
  buildCloudRevisedDocument(raw, document, [], {
    revisionId: 'revised',
    now,
    model: 'text',
    instruction: '改成红色',
  });
describe('cloud reviser preserves authoritative revision context', () => {
  it('assigns a child identity, changes the requested rule and never mutates the base or adopts model provenance', () => {
    const original = base();
    const saved = structuredClone(original);
    original.assetIds = ['existing-image'];
    const raw = output();
    raw.promptProgram[1].template = '红色';
    const result = revised({ ...raw, schemeId: 'attacker', assetIds: ['attacker'] }, original);
    expect(result).toMatchObject({
      schemeId: 'scheme',
      revisionId: 'revised',
      parentRevisionId: 'base',
      createdBy: 'agent',
      assetIds: ['existing-image'],
      sources: original.sources,
      inputs: [{ id: 'topic' }],
    });
    expect(result.promptProgram[1].template).toBe('红色');
    expect(original.promptProgram).toEqual(saved.promptProgram);
    expect(result.parameters).toEqual(original.parameters);
  });
  it('keeps an existing image slot identity and limits when its role is unchanged', () => {
    const original = base();
    original.inputs.push({
      id: 'subject_image',
      label: '图片',
      kind: 'image-set',
      required: false,
      imageRole: 'subject-reference',
      minItems: 0,
      maxItems: 3,
    });
    const raw = {
      ...output(),
      inputs: [
        ...output().inputs,
        { label: '图片', kind: 'image-set', required: false, imageRole: 'subject-reference' },
      ],
    };
    expect(revised(raw, original).inputs[1]).toMatchObject({
      id: 'subject_image',
      maxItems: 3,
      imageRole: 'subject-reference',
    });
  });
  it.each(['verified', 'faithful', 'unbound', 'evidence'])(
    'rejects %s instead of promoting an invalid draft',
    (mode) => {
      const raw = output();
      if (mode === 'verified' || mode === 'faithful') raw.fidelity = mode;
      if (mode === 'unbound') raw.promptProgram[0].variables = ['absent'];
      const value =
        mode === 'evidence'
          ? {
              ...raw,
              constraints: [
                {
                  domain: 'color',
                  statement: 'red',
                  mode: 'required',
                  userOverridable: false,
                  evidencePaths: ['not-in-base.txt'],
                },
              ],
            }
          : raw;
      expect(() => revised(value)).toThrow();
    },
  );
});
