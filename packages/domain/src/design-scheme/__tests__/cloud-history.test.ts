import { describe, expect, it } from 'vitest';
import { analystReportSchema } from '@musefold/contracts';
import { buildCompilerPrompt } from '../compiler-prompt';
import { buildCloudCompiledDocument } from '../cloud-compiler';
import { buildCloudRevisedDocument } from '../cloud-reviser';
import { sourceSnapshotSchema } from '@musefold/contracts';
const item = {
  selection: { runId: 'run', assetId: 'original', includePrompt: true },
  imageAssetId: 'copy',
  imagePath: 'history/copy.png',
  promptPath: 'history/copy.txt',
  prompt: 'Use blue lettering',
};
const files = [
  {
    relativePath: item.imagePath,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 4,
    contentHash: 'a'.repeat(64),
    evidencePath: item.imagePath,
    textExcerpt: null,
  },
  {
    relativePath: item.promptPath,
    kind: 'text',
    mimeType: 'text/plain',
    sizeBytes: 18,
    contentHash: 'b'.repeat(64),
    evidencePath: item.promptPath,
    textExcerpt: null,
  },
];
const snapshot = sourceSnapshotSchema.parse({
  id: 'history-snapshot',
  packageId: 'history-package',
  kind: 'history',
  resolvedRef: 'history',
  files,
  totalBytes: 22,
  createdAt: '2026-09-09T00:00:00Z',
  historyItems: [item],
});
const raw = {
  name: 'Poster',
  summary: 'Poster',
  fidelity: 'adapted',
  inputs: [{ label: 'Topic', kind: 'text', variable: 'topic', required: true }],
  constraints: [
    {
      domain: 'color',
      statement: 'blue lettering',
      mode: 'required',
      userOverridable: false,
      evidencePaths: [item.promptPath],
    },
  ],
  promptProgram: [
    { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
    { kind: 'style-rule', template: 'blue lettering', variables: [] },
  ],
  creationSummary: 'Try first',
};
const identity = {
  schemeId: 'scheme',
  revisionId: 'revision',
  now: '2026-09-09T00:00:00Z',
  model: 'text',
  brief: 'Create poster',
};
describe('mixed history compilation', () => {
  it('includes the selected prompt and its evidence path alongside repository reports', () => {
    const prompt = buildCompilerPrompt({
      brief: 'Poster',
      analystReport: analystReportSchema.parse({
        repoKind: 'agent-skill',
        capabilitySummary: 'REPO_CAPABILITY',
        rules: [],
        variables: [],
      }),
      historyContext: { imageCount: 1, prompts: [item.prompt], evidencePaths: [item.promptPath] },
      uploadedImageCount: 1,
    });
    expect(prompt.user).toContain('REPO_CAPABILITY');
    expect(prompt.user).toContain(item.prompt);
    expect(prompt.user).toContain(item.promptPath);
    expect(prompt.user).toContain('未接收历史图片像素');
    expect(prompt.user).toContain('已保存 1 张图片');
  });
  it('binds history as history and keeps its assets/provenance/warning through revision', () => {
    const document = buildCloudCompiledDocument(raw, [snapshot], identity);
    expect(document.sources[0]).toMatchObject({
      kind: 'history-image',
      role: 'example',
      snapshotId: snapshot.id,
    });
    expect(document.constraints[0].sourceIds).toEqual([document.sources[0].id]);
    const base = { ...document, assetIds: ['copy'] };
    const revised = buildCloudRevisedDocument(raw, base, [snapshot], {
      revisionId: 'next',
      now: identity.now,
      model: 'text',
      instruction: 'more whitespace',
    });
    expect(revised.sources).toEqual(base.sources);
    expect(revised.assetIds).toEqual(['copy']);
    expect(revised.fidelity).toBe('adapted');
    expect(revised.compilation.warnings.join(' ')).toContain('未做图片视觉解析');
  });
});
