import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID } from '@musefold/domain/constants';
import { pickPreset, recommendedPresets } from '../presets';

describe('pickPreset', () => {
  it('returns exact preset by id', () => {
    const p = pickPreset('wukong');
    expect(p.id).toBe('wukong');
    expect(p.model).toBe('image_gptImage2');
    expect(p.modelLabel).toBe('产品 ID');
  });

  it('falls back to default recommended for unknown/empty', () => {
    expect(pickPreset(null).id).toBe(DEFAULT_PRESET_ID);
    expect(pickPreset(undefined).id).toBe(DEFAULT_PRESET_ID);
    expect(pickPreset('no-such').id).toBe(DEFAULT_PRESET_ID);
  });

  it('default is TvT openai-compatible with gpt-image-2', () => {
    const p = pickPreset();
    expect(p.type).toBe('openai-compatible');
    expect(p.model).toBe('gpt-image-2');
    expect(p.recommended).toBe(true);
  });
});

describe('recommendedPresets', () => {
  it('includes at least the default recommended card', () => {
    const list = recommendedPresets();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((p) => p.id === DEFAULT_PRESET_ID)).toBe(true);
  });
});
