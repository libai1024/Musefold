import { describe, expect, it } from 'vitest';
import {
  composeGenerationPrompt,
  composePromptWithImageIndexHint,
  composePromptWithRatioConstraint,
  composePromptWithReferences,
  isValidUtf16SliceRange,
  MULTI_IMAGE_INDEX_HINT,
  PROMPT_REFERENCE_HEADER,
  RATIO_CONSTRAINT_PREFIX,
} from '../generation-prompt';
import type { ResolvedPromptReferenceSnapshot } from '@musefold/contracts';

function snapshot(
  promptId: string | null,
  title: string,
  text: string,
  scope: 'full' | 'excerpt' = 'full',
  sourceVersion = 1,
): ResolvedPromptReferenceSnapshot {
  return { promptId, title, text, scope, sourceVersion };
}

describe('generation prompt composition', () => {
  it('accepts UTF-16 ranges around astral characters and rejects split surrogate pairs', () => {
    const content = '前🙂后';

    expect(isValidUtf16SliceRange(content, { start: 1, end: 3 })).toBe(true);
    expect(content.slice(1, 3)).toBe('🙂');
    expect(isValidUtf16SliceRange(content, { start: 2, end: 3 })).toBe(false);
    expect(isValidUtf16SliceRange(content, { start: 1, end: 2 })).toBe(false);
    expect(isValidUtf16SliceRange(content, { start: -1, end: 1 })).toBe(false);
    expect(isValidUtf16SliceRange(content, { start: 0, end: 5 })).toBe(false);
  });

  it('adds preset and custom ratio constraints exactly once', () => {
    const preset = composePromptWithRatioConstraint('海边灯塔', '16:9');
    expect(preset).toContain(`${RATIO_CONSTRAINT_PREFIX}严格按照 16:9 画幅构图`);
    expect(composePromptWithRatioConstraint(preset, '16:9')).toBe(preset);

    expect(composePromptWithRatioConstraint('超宽海报', 'custom:7:3')).toContain(
      `${RATIO_CONSTRAINT_PREFIX}严格按照 7:3 画幅构图`,
    );
    expect(composePromptWithRatioConstraint('自动构图', 'auto')).toBe('自动构图');
  });

  it('preserves canonical plain ratios instead of falling back to 1:1', () => {
    const composed = composePromptWithRatioConstraint('超宽海报', '7:3');
    expect(composed).toContain(`${RATIO_CONSTRAINT_PREFIX}严格按照 7:3 画幅构图`);
    expect(composed).not.toContain(`${RATIO_CONSTRAINT_PREFIX}严格按照 1:1 画幅构图`);
  });

  it('orders references before image and ratio hints in the full pipeline', () => {
    const result = composeGenerationPrompt({
      userPrompt: 'user prompt',
      promptReferences: [snapshot('prompt-a', 'Source', 'reference text')],
      imageCount: 2,
      ratioId: '7:3',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        finalPrompt: `user prompt\n\n${PROMPT_REFERENCE_HEADER}\n【Source｜整条】\nreference text\n\n${MULTI_IMAGE_INDEX_HINT}\n\n${RATIO_CONSTRAINT_PREFIX}严格按照 7:3 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`,
        promptReferences: [snapshot('prompt-a', 'Source', 'reference text')],
      },
    });
    if (result.ok) {
      expect(result.data.finalPrompt.indexOf(PROMPT_REFERENCE_HEADER)).toBeLessThan(
        result.data.finalPrompt.indexOf(MULTI_IMAGE_INDEX_HINT),
      );
      expect(result.data.finalPrompt.indexOf(MULTI_IMAGE_INDEX_HINT)).toBeLessThan(
        result.data.finalPrompt.indexOf(RATIO_CONSTRAINT_PREFIX),
      );
    }
  });

  it('checks the final length after image and ratio stages', () => {
    const result = composeGenerationPrompt({
      userPrompt: 'x'.repeat(7_990),
      promptReferences: [],
      imageCount: 2,
      ratioId: '7:3',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROMPT_TOO_LONG');
  });

  it('accepts exactly 8000 final code units and rejects 8001 after all stages', () => {
    const ratioConstraint = `${RATIO_CONSTRAINT_PREFIX}严格按照 7:3 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`;
    const suffixLength = 2 + MULTI_IMAGE_INDEX_HINT.length + 2 + ratioConstraint.length;
    const exactUserPrompt = 'x'.repeat(8_000 - suffixLength);
    const exact = composeGenerationPrompt({
      userPrompt: exactUserPrompt,
      promptReferences: [],
      imageCount: 2,
      ratioId: '7:3',
    });
    expect(exact).toMatchObject({ ok: true });
    if (exact.ok) expect(exact.data.finalPrompt).toHaveLength(8_000);

    const over = composeGenerationPrompt({
      userPrompt: `${exactUserPrompt}x`,
      promptReferences: [],
      imageCount: 2,
      ratioId: '7:3',
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('PROMPT_TOO_LONG');
  });

  it('numbers two or more reference images and preserves single-image prompts', () => {
    expect(composePromptWithImageIndexHint('参考配色', 1)).toBe('参考配色');
    expect(composePromptWithImageIndexHint('图 1 用构图，图 2 用配色', 2)).toBe(
      `${MULTI_IMAGE_INDEX_HINT}\n\n图 1 用构图，图 2 用配色`,
    );
  });

  it('composes trimmed user text and ordered immutable reference blocks exactly', () => {
    const references = [
      snapshot('prompt-a', '构图', '  wide composition  ', 'full', 2),
      snapshot(null, '色彩', 'muted blue', 'excerpt', 4),
    ];
    const result = composePromptWithReferences('  一张海报  ', references);

    expect(result).toEqual({
      ok: true,
      data: {
        finalPrompt:
          '一张海报\n\n参考提示词：\n【构图｜整条】\nwide composition\n\n【色彩｜选中片段】\nmuted blue',
        promptReferences: [
          snapshot('prompt-a', '构图', 'wide composition', 'full', 2),
          snapshot(null, '色彩', 'muted blue', 'excerpt', 4),
        ],
      },
    });
    expect(PROMPT_REFERENCE_HEADER).toBe('参考提示词：');
  });

  it('supports reference-only composition and deduplicates by id and trimmed text', () => {
    const first = snapshot('prompt-a', '第一标题', 'text', 'full', 1);
    const duplicate = snapshot('prompt-a', '第二标题', ' text ', 'excerpt', 9);
    const other = snapshot('prompt-b', '第二条', 'text', 'excerpt', 2);
    const result = composePromptWithReferences('   ', [first, duplicate, other]);

    expect(result).toEqual({
      ok: true,
      data: {
        finalPrompt: '参考提示词：\n【第一标题｜整条】\ntext\n\n【第二条｜选中片段】\ntext',
        promptReferences: [first, other],
      },
    });
  });

  it('accepts the 4000-character reference boundary and rejects 4001', () => {
    expect(composePromptWithReferences('', [snapshot('p', 't', 'x'.repeat(4_000))]).ok).toBe(true);
    const result = composePromptWithReferences('', [snapshot('p', 't', 'x'.repeat(4_001))]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROMPT_TOO_LONG');
  });

  it('accepts the 8000-character final boundary and rejects 8001', () => {
    const noReferences = composePromptWithReferences('x'.repeat(8_000), []);
    expect(noReferences).toEqual({
      ok: true,
      data: { finalPrompt: 'x'.repeat(8_000), promptReferences: [] },
    });

    const overLimit = composePromptWithReferences('x'.repeat(8_001), []);
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.error.code).toBe('PROMPT_TOO_LONG');
  });

  it('returns structured failures for empty input and too many references', () => {
    const empty = composePromptWithReferences(' \n\t ', []);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('REQUIRED');

    const references = Array.from({ length: 7 }, (_, index) =>
      snapshot(`prompt-${index}`, `title-${index}`, 'text'),
    );
    const tooMany = composePromptWithReferences('', references);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe('TOO_MANY_ITEMS');
  });

  it('checks final composed length after adding reference formatting', () => {
    const result = composePromptWithReferences('x'.repeat(7_990), [snapshot('p', 't', 'x')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROMPT_TOO_LONG');
  });
});
