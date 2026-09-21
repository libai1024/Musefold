import { expect, it } from 'vitest';
import { toCloudSchemeCreateInput, toCloudSchemeModifyInput } from '../agent-presentation';
import type { SchemeCreateSubmission, SchemeModifySubmission } from '../integration-store';

const submission: SchemeCreateSubmission = {
  kind: 'create',
  executionId: 'create-original',
  createKind: 'idea',
  brief: '水彩海报',
  source: null,
};
it('preserves explicit GitHub ref paths, deduplicates sources and keeps the remaining brief', () => {
  const input = toCloudSchemeCreateInput({
    ...submission,
    brief:
      '保留水彩\nhttps://github.com/owner/repo/tree/topic/ui\nhttps://github.com/owner/repo/tree/topic/ui',
  });
  expect(input.brief).toBe('保留水彩');
  expect(input.sourceUris).toEqual(['https://github.com/owner/repo/tree/topic/ui']);
});
it.each([
  'https://github.com/owner',
  'https://github.com/owner/repo?token=secret',
  'https://github.com/owner/repo#section',
])('rejects an ambiguous GitHub source: %s', (brief) => {
  expect(() => toCloudSchemeCreateInput({ ...submission, brief })).toThrow();
});
it('history contributes only stable identities and an explicit prompt selection', () => {
  const input = toCloudSchemeCreateInput({
    ...submission,
    source: {
      kind: 'history',
      selection: {
        note: '提取画风',
        items: [
          {
            jobId: 'run-1',
            assetId: 'asset-1',
            assetUrl: 'media://private',
            prompt: 'private snapshot',
          },
          {
            jobId: 'run-2',
            assetId: 'asset-2',
            assetUrl: 'https://image.test/private',
            prompt: null,
          },
        ],
      },
    },
  });
  expect(input.historySources).toEqual([
    { runId: 'run-1', assetId: 'asset-1', includePrompt: true },
    { runId: 'run-2', assetId: 'asset-2', includePrompt: false },
  ]);
  expect(JSON.stringify(input)).not.toMatch(/private|media:/);
});
it('uses the edited prompt brief without inventing a separate source or frozen prompt payload', () => {
  expect(
    toCloudSchemeCreateInput({
      ...submission,
      source: { kind: 'prompt', promptId: 'prompt-1', title: '原标题' },
    }).brief,
  ).toBe('水彩海报');
  expect(() => toCloudSchemeCreateInput({ ...submission, brief: ' ' })).toThrow(
    '请描述方案想法或选择来源',
  );
});

const modification: SchemeModifySubmission = {
  kind: 'modify',
  executionId: 'modify-original',
  brief: '  柔和水彩  ',
  attachment: {
    schemeId: 'scheme',
    revisionId: 'working-revision',
    expectedVersion: 7,
    name: '海报',
    summary: '',
    mode: 'modify',
    fidelity: 'adapted',
    sourceLabel: '',
    inputs: [],
    coverAssetId: null,
    hasSuccessfulTrial: false,
  },
};
it('modify maps only the frozen version and instruction, never a client document or display metadata', () => {
  expect(toCloudSchemeModifyInput(modification)).toEqual({
    executionId: 'modify-original',
    schemeId: 'scheme',
    baseRevisionId: 'working-revision',
    expectedVersion: 7,
    instruction: '柔和水彩',
  });
});
it.each([0, -1, 1.5, undefined])(
  'modify cannot invent a missing or invalid frozen version: %s',
  (version) => {
    const input = {
      ...modification,
      attachment: { ...modification.attachment, expectedVersion: version },
    };
    expect(() => toCloudSchemeModifyInput(input as SchemeModifySubmission)).toThrow();
  },
);
it('modify rejects an empty instruction before opening a model offer', () => {
  expect(() => toCloudSchemeModifyInput({ ...modification, brief: ' ' })).toThrow();
});
