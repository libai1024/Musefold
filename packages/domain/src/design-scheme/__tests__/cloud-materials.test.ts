import { describe, expect, it } from 'vitest';
import { designSchemeAgentMaterialsSchema } from '@musefold/contracts';
import { attachCloudAgentMaterials } from '../cloud-materials';
import { buildCloudCompiledDocument } from '../cloud-compiler';
import { buildCompilerPrompt } from '../compiler-prompt';
const materials = designSchemeAgentMaterialsSchema.parse({
  uploads: ['second', 'first'].map((id) => ({
    sourceAssetId: `selected_${id}`,
    asset: {
      id,
      origin: 'uploaded',
      role: 'reference',
      license: null,
      mimeType: 'image/png',
      width: 3,
      height: 2,
      byteSize: 80,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00Z',
    },
  })),
});
const document = buildCloudCompiledDocument(
  {
    name: '海报',
    summary: '海报',
    fidelity: 'adapted',
    inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
    constraints: [],
    promptProgram: [
      { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
      { kind: 'style-rule', template: 'poster', variables: [] },
    ],
    creationSummary: '先试运行',
  },
  [],
  {
    schemeId: 'scheme',
    revisionId: 'revision',
    now: '2026-09-09T00:00:00Z',
    model: 'text',
    brief: 'poster',
  },
);
describe('preserved images are not visual analysis', () => {
  it('preserves order without adding required slots, parameter changes or trial success', () => {
    const result = attachCloudAgentMaterials(document, materials);
    expect(result.assetIds).toEqual(['second', 'first']);
    expect(result.inputs).toEqual(document.inputs);
    expect(result.parameters).toEqual(document.parameters);
    expect(result.compilation.warnings.join(' ')).toContain('未做图片视觉解析');
    expect(document.assetIds).toEqual([]);
    expect(result.sources.at(-1)).toMatchObject({ kind: 'reference-image', role: 'reference' });
  });
  it('enforces truthful fidelity and bounded warnings even when a model claims otherwise', () => {
    const output = attachCloudAgentMaterials(
      {
        ...document,
        fidelity: 'faithful',
        compilation: {
          ...document.compilation,
          warnings: Array.from({ length: 40 }, () => 'model warning'),
        },
      },
      materials,
    );
    expect(output.fidelity).toBe('adapted');
    expect(output.compilation.warnings).toHaveLength(40);
    expect(output.compilation.warnings.at(-1)).toContain('未做图片视觉解析');
    expect(
      attachCloudAgentMaterials({ ...document, fidelity: 'unsupported' }, materials).fidelity,
    ).toBe('unsupported');
    expect(attachCloudAgentMaterials(document, null)).toBe(document);
  });
  it('tells the compiler what was actually provided, without embedding bytes or inventing visual evidence', () => {
    const prompt = buildCompilerPrompt({ brief: '海报', uploadedImageCount: 2 });
    expect(prompt.user).toContain('已保存 2 张图片');
    expect(prompt.user).toContain('未接收图片像素');
    expect(prompt.user).not.toContain('image_url');
  });
});
