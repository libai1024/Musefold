import { describe, expect, it } from 'vitest';
import { resolveInheritedGenerationParams } from '../session-store';

describe('resolveInheritedGenerationParams(新会话草稿继承默认、已改草稿不被覆盖)', () => {
  const defaults = {
    defaultAspectRatio: '16:9',
    defaultQuality: 'high' as const,
    defaultCount: 2 as const,
  };

  it('新会话 / 空覆盖继承全局默认', () => {
    expect(resolveInheritedGenerationParams(defaults, {})).toEqual({
      aspectRatio: '16:9',
      quality: 'high',
      count: 2,
    });
  });

  it('已改比例不被默认覆盖,未改质量仍继承', () => {
    expect(resolveInheritedGenerationParams(defaults, { aspectRatio: '1:1' })).toEqual({
      aspectRatio: '1:1',
      quality: 'high',
      count: 2,
    });
  });

  it('已改质量不被默认覆盖,未改比例仍继承', () => {
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '21:9', defaultQuality: 'low', defaultCount: 1 },
        { quality: 'medium' },
      ),
    ).toEqual({
      aspectRatio: '21:9',
      quality: 'medium',
      count: 1,
    });
  });

  it('两个字段都显式改过时默认变更全部不覆盖', () => {
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '21:9', defaultQuality: 'low', defaultCount: 1 },
        { aspectRatio: '1:1', quality: 'medium' },
      ),
    ).toEqual({
      aspectRatio: '1:1',
      quality: 'medium',
      count: 1,
    });
  });

  // 张数(§9-D3)与比例/质量同一套覆盖语义:显式改过就不再跟随默认。
  it('张数:未覆盖跟随默认,显式覆盖后默认变更不生效', () => {
    expect(resolveInheritedGenerationParams(defaults, { count: 4 }).count).toBe(4);
    expect(
      resolveInheritedGenerationParams({ ...defaults, defaultCount: 4 }, { count: 1 }).count,
    ).toBe(1);
  });
});
