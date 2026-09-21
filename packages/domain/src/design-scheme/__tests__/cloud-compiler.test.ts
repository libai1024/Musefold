import { describe, expect, it } from 'vitest';
import { sourceSnapshotSchema } from '@musefold/contracts';
import { buildCloudCompiledDocument, validateCloudAnalystReport } from '../cloud-compiler';

const output = () => ({
  name: '海报',
  summary: '黑白海报',
  fidelity: 'adapted',
  inputs: [{ label: '主题', kind: 'text', required: true, variable: 'topic' }],
  constraints: [{ domain: 'color', statement: '黑白', mode: 'required', userOverridable: false }],
  promptProgram: [
    { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
    { kind: 'style-rule', template: '黑白', variables: [] },
  ],
  creationSummary: '提供主题并试运行',
  schemeId: 'untrusted',
});
const identity = {
  schemeId: 'trusted-scheme',
  revisionId: 'trusted-revision',
  now: '2026-09-09T00:00:00Z',
  model: 'text-model',
  brief: '创建海报',
};
const snapshot = sourceSnapshotSchema.parse({
  id: 'snapshot',
  packageId: 'package',
  kind: 'github',
  repositoryUrl: 'https://github.com/example/design',
  resolvedRef: 'main',
  commitHash: 'a'.repeat(40),
  totalBytes: 4,
  contentHash: 'a'.repeat(64),
  createdAt: identity.now,
  files: [
    {
      relativePath: 'README.md',
      kind: 'text',
      mimeType: 'text/markdown',
      sizeBytes: 4,
      contentHash: 'b'.repeat(64),
      evidencePath: 'README.md',
      textExcerpt: 'rule',
    },
  ],
});
const report = () => ({
  repoKind: 'agent-skill',
  capabilitySummary: '海报',
  rules: [{ domain: 'color', statement: '黑白', mode: 'required', evidencePaths: ['README.md'] }],
  variables: [],
});

describe('cloud compiled document semantics', () => {
  it('assigns runtime identities and a template variable slot instead of model identities', () => {
    const document = buildCloudCompiledDocument(output(), [], identity);
    expect(document).toMatchObject({
      schemeId: identity.schemeId,
      revisionId: identity.revisionId,
      inputs: [{ id: 'topic' }],
      createdBy: 'agent',
      assetIds: [],
    });
    expect(document.promptProgram.map((m) => m.order)).toEqual([0, 1]);
  });
  it.each([
    'missing',
    'duplicate',
    'unbound',
    'unmatched',
    'verified',
    'faithful',
    'missing-style',
    'image-role',
  ])('rejects %s before persistence', (mode) => {
    const raw = output();
    if (mode === 'missing') raw.inputs[0].variable = '';
    if (mode === 'duplicate') raw.inputs.push({ ...raw.inputs[0] });
    if (mode === 'unbound') raw.promptProgram[0].template = '{{other}}';
    if (mode === 'unmatched') raw.promptProgram[0].template = '{{topic';
    if (mode === 'verified' || mode === 'faithful') raw.fidelity = mode;
    if (mode === 'missing-style') raw.promptProgram.pop();
    if (mode === 'image-role') raw.inputs[0].kind = 'image';
    expect(() => buildCloudCompiledDocument(raw, [], identity)).toThrow();
  });
  it('binds only confirmed source evidence and rejects invented paths in either model role', () => {
    expect(validateCloudAnalystReport(report(), snapshot).rules).toHaveLength(1);
    for (const evidencePaths of [[], ['secrets.txt']])
      expect(() =>
        validateCloudAnalystReport(
          { ...report(), rules: [{ ...report().rules[0], evidencePaths }] },
          snapshot,
        ),
      ).toThrow();
    expect(() =>
      validateCloudAnalystReport(
        { ...report(), referenceImages: [{ path: 'fake.png', role: 'style-reference' }] },
        snapshot,
      ),
    ).toThrow();
    const raw = {
      ...output(),
      constraints: [{ ...output().constraints[0], evidencePaths: ['README.md'] }],
    };
    const doc = buildCloudCompiledDocument(raw, [snapshot], identity);
    expect(doc.constraints[0].sourceIds).toEqual(['source_1']);
    expect(doc.sources[0]).toMatchObject({ snapshotId: 'snapshot', commit: 'a'.repeat(40) });
    raw.constraints[0].evidencePaths = ['absent.txt'];
    expect(() => buildCloudCompiledDocument(raw, [snapshot], identity)).toThrow();
  });
});
