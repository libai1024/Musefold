import { describe, expect, it } from 'vitest';
import { isProviderType, PROVIDER_TYPES } from '../enums';

describe('ProviderType', () => {
  it('contains only supported runtime providers', () => {
    expect(PROVIDER_TYPES).toEqual(['openai', 'openai-compatible', 'doubao-web']);
    expect(isProviderType('openai-compatible')).toBe(true);
    expect(isProviderType('wukong-studio')).toBe(false);
    expect(isProviderType('unknown')).toBe(false);
  });
});
