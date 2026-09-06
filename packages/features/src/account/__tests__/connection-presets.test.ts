import { describe, expect, it } from 'vitest';
import { AGENT_CONNECTION_PRESETS, IMAGE_CONNECTION_PRESETS } from '../connection-presets';

describe('connection presets', () => {
  it('keeps real v2.1 image presets and a custom entry, without doubao-web', () => {
    expect(IMAGE_CONNECTION_PRESETS.map((preset) => preset.id)).toEqual(['tvt', 'custom']);
    expect(IMAGE_CONNECTION_PRESETS.some((preset) => preset.id === 'doubao-web')).toBe(false);
    expect(IMAGE_CONNECTION_PRESETS.find((preset) => preset.id === 'tvt')?.baseUrl).toBe(
      'https://ai.tvt.wiki/v1',
    );
  });

  it('keeps the v2.1 Agent preset catalog including 自定义', () => {
    expect(AGENT_CONNECTION_PRESETS.map((preset) => preset.id)).toEqual([
      'tvt',
      'deepseek',
      'kimi',
      'glm',
      'minimax',
      'litellm',
      'new-api',
      'custom',
    ]);
    expect(AGENT_CONNECTION_PRESETS.at(-1)?.name).toContain('自定义');
  });
});
