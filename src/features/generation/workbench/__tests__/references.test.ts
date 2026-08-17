import { describe, expect, it } from 'vitest';
import type { PromptReference } from '@shared/types/providers';
import {
  composePromptWithReferences,
  extractUserPromptFromComposed,
  isDuplicateReference,
} from '../references';

const full: PromptReference = {
  promptId: 'prompt-1',
  title: '电影感人像',
  text: '柔和侧光，浅景深，真实肤质',
  scope: 'full',
};
const excerpt: PromptReference = {
  promptId: 'prompt-2',
  title: '自然光影',
  text: '阴天漫射光',
  scope: 'excerpt',
};

describe('composePromptWithReferences', () => {
  it('returns the trimmed user prompt when there are no references', () => {
    expect(composePromptWithReferences('  一张海报  ', [])).toBe('一张海报');
  });

  it('composes full and excerpt references in their original order', () => {
    expect(composePromptWithReferences('一张海报', [full, excerpt])).toBe(
      '一张海报\n\n参考提示词：\n\n【电影感人像｜整条】\n柔和侧光，浅景深，真实肤质\n\n【自然光影｜选中片段】\n阴天漫射光',
    );
  });

  it('supports reference-only submissions and restores the empty user prompt', () => {
    const composed = composePromptWithReferences('', [full]);
    expect(composed).toBe('参考提示词：\n\n【电影感人像｜整条】\n柔和侧光，浅景深，真实肤质');
    expect(extractUserPromptFromComposed(composed, [full])).toBe('');
  });

  it('restores user text only when the deterministic suffix matches', () => {
    const composed = composePromptWithReferences('原始正文', [full, excerpt]);
    expect(extractUserPromptFromComposed(composed, [full, excerpt])).toBe('原始正文');
    expect(extractUserPromptFromComposed('外部格式', [full])).toBe('外部格式');
  });

  it('detects duplicates by prompt id and normalized text', () => {
    expect(isDuplicateReference([full], { ...full, text: ` ${full.text} ` })).toBe(true);
    expect(isDuplicateReference([full], { ...full, promptId: 'other' })).toBe(false);
  });
});
