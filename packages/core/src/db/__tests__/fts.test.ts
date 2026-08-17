import { describe, expect, it } from 'vitest';
import { buildMatchQuery, tokenizeForFts } from '../fts';

describe('FTS tokenization', () => {
  it('indexes Chinese sequences without native tokenizer dependencies', () => {
    const indexed = tokenizeForFts(
      '赛博朋克城市夜景',
      '水彩风景画',
      'cyberpunk city at night, neon lights',
      ['透明背景', 'night mode'],
    ).split(' ');

    expect(indexed).toContain('赛博朋克城市夜景');
    expect(indexed).toContain('赛博');
    expect(indexed).toContain('朋克');
    expect(indexed).toContain('城市');
    expect(indexed).toContain('夜景');
    expect(indexed).toContain('水彩');
    expect(indexed).toContain('风景');
    expect(indexed).toContain('cyberpunk');
    expect(indexed).toContain('night');
    expect(indexed).not.toContain(',');
  });

  it('builds safe MATCH queries with the same Chinese token strategy', () => {
    const chinese = buildMatchQuery('赛博朋克');
    expect(chinese).toContain('"赛博朋克"');
    expect(chinese).toContain('"赛博"');
    expect(chinese).toContain('"朋克"');

    const punctuation = buildMatchQuery('a cat, cinematic');
    expect(punctuation).toContain('"a"');
    expect(punctuation).toContain('"cat"');
    expect(punctuation).toContain('"cinematic"');
    expect(punctuation).not.toContain('cat,');
  });

  it('returns null for punctuation-only searches', () => {
    expect(buildMatchQuery('(( -* :')).toBeNull();
  });
});
