import { describe, expect, it } from 'vitest';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { assertChildProjection, type LocalRunProjection } from '../managed-run-projection';

const source = { label: 'Verified Skill', repositoryUrl: 'https://github.com/fixture/visual' };
const skillRuntime: NonNullable<GenerateImageRequest['skillRuntime']> = {
  ...source,
  executionMode: 'agent',
  trace: [],
};
const request: GenerateImageRequest = {
  jobId: 'job-1',
  providerId: 'cloud',
  model: 'musefold-image-pro',
  prompt: 'Prepared landscape',
  n: 1,
  size: '1024x1024',
  quality: 'auto',
  skillRuntime,
};
const projection: LocalRunProjection = { skillRuntimeSource: source };

describe('managed child local history authority', () => {
  it('preserves the prepared Skill source only for a Skill run', () => {
    expect(() => assertChildProjection(request, 0, projection, 'run_github_skill')).not.toThrow();
    expect(() => assertChildProjection(request, 0, projection, 'run_scheme')).toThrow(
      'MANAGED_INPUT_UNSUPPORTED',
    );
  });
  it('requires the trusted host source even when an otherwise valid snapshot is present', () => {
    expect(() => assertChildProjection(request, 0, undefined, 'run_github_skill')).toThrow(
      'MANAGED_INPUT_UNSUPPORTED',
    );
    expect(() =>
      assertChildProjection(
        { ...request, skillRuntime: undefined },
        0,
        projection,
        'run_github_skill',
      ),
    ).toThrow('MANAGED_INPUT_UNSUPPORTED');
  });
  it.each(['label', 'repositoryUrl'] as const)('rejects a substituted Skill %s', (field) => {
    const changed = {
      ...request,
      skillRuntime: { ...skillRuntime, [field]: 'different' },
    };
    expect(() => assertChildProjection(changed, 0, projection, 'run_github_skill')).toThrow(
      'MANAGED_INPUT_UNSUPPORTED',
    );
  });
  it.each(['promptId', 'parentHistoryId', 'sourceAssetId'] as const)(
    'does not let an authorized Skill inject %s',
    (field) => {
      expect(() =>
        assertChildProjection(
          { ...request, [field]: 'unowned' },
          0,
          projection,
          'run_github_skill',
        ),
      ).toThrow('MANAGED_INPUT_UNSUPPORTED');
    },
  );
  it('retains exact prompt-reference and workbench checks for Skill runs', () => {
    expect(() =>
      assertChildProjection(
        { ...request, promptReferences: [{ id: 'unowned' }] as never },
        0,
        projection,
        'run_github_skill',
      ),
    ).toThrow('MANAGED_INPUT_UNSUPPORTED');
    expect(() =>
      assertChildProjection(
        { ...request, workbench: { resultIndex: 0 } as never },
        0,
        projection,
        'run_github_skill',
      ),
    ).toThrow('MANAGED_INPUT_UNSUPPORTED');
  });
  it('retains ordinary scheme requests without adding Skill history', () => {
    expect(() =>
      assertChildProjection({ ...request, skillRuntime: undefined }, 0, undefined, 'run_scheme'),
    ).not.toThrow();
  });
});
