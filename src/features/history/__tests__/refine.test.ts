import { describe, expect, it } from 'vitest';
import type { PromptParams } from '@shared/types/models';
import { historyParamsToRefineParams } from '../refine';

const params = (patch: Partial<PromptParams>): PromptParams => ({
  schemaVersion: 1,
  ...patch,
});

describe('historyParamsToRefineParams', () => {
  it('prefers aspectRatio over the coarse pixel size', () => {
    expect(
      historyParamsToRefineParams(
        params({ size: '1536x1024', aspectRatio: '16:9', quality: 'high', n: 6 }),
      ),
    ).toMatchObject({ ratioId: '16:9', quality: 'high', n: 6 });
  });

  it('falls back to size when no aspectRatio snapshot exists', () => {
    expect(historyParamsToRefineParams(params({ size: '1024x1536' }))).toMatchObject({
      ratioId: '2:3',
    });
    expect(historyParamsToRefineParams(params({ size: 'auto' }))).toMatchObject({
      ratioId: 'auto',
    });
  });

  it('carries supported advanced options', () => {
    expect(
      historyParamsToRefineParams(
        params({
          size: '1024x1024',
          quality: 'auto',
          n: 4,
          background: 'transparent',
          moderation: 'low',
        }),
      ),
    ).toEqual({
      ratioId: '1:1',
      quality: 'auto',
      n: 4,
      background: 'transparent',
      moderation: 'low',
    });
  });

  it('defaults invalid or missing values without throwing', () => {
    expect(historyParamsToRefineParams(null)).toBeUndefined();
    expect(
      historyParamsToRefineParams(
        params({
          size: '2048x9999' as PromptParams['size'],
          quality: 'ultra' as PromptParams['quality'],
          n: 99,
          background: 'glass' as PromptParams['background'],
          moderation: 'strict' as PromptParams['moderation'],
        }),
      ),
    ).toEqual({ ratioId: '1:1', n: 1 });
  });
});
