import { describe, expect, it } from 'vitest';
import {
  appPreferencesPatchSchema,
  appPreferencesSchema,
  cloudGenerationRequestSchema,
  defaultAppPreferences,
  generationCountSchema,
  releaseReferenceImageInputSchema,
} from '../index';

/**
 * 单次生成张数(§9-D3 解锁,ui-parity 03 §2 / 07-03 §2)。
 * 目录只有 1/2/4 三档:上游 `n`、资产 position 与 UI radio 组共用同一枚举,
 * 目录外的值(3/0/8…)必须在契约层拒绝,避免落库后 UI 无法复原。
 */
describe('generationCountSchema', () => {
  it('只收 1 / 2 / 4 三档,目录外与非整数一律拒绝', () => {
    expect(generationCountSchema.parse(1)).toBe(1);
    expect(generationCountSchema.parse(2)).toBe(2);
    expect(generationCountSchema.parse(4)).toBe(4);

    for (const invalid of [0, 3, 5, 8, -1, 1.5, '2', null, undefined]) {
      expect(generationCountSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('生成请求缺省 count → 1,2 / 4 原样透传,3 被拒', () => {
    expect(cloudGenerationRequestSchema.parse({ prompt: 'paper collage' }).count).toBe(1);
    expect(cloudGenerationRequestSchema.parse({ prompt: 'p', count: 2 }).count).toBe(2);
    expect(cloudGenerationRequestSchema.parse({ prompt: 'p', count: 4 }).count).toBe(4);
    expect(cloudGenerationRequestSchema.safeParse({ prompt: 'p', count: 3 }).success).toBe(false);
  });

  it('偏好 defaultCount 缺省 1,patch 不回填 default 也不放过目录外值', () => {
    expect(defaultAppPreferences.defaultCount).toBe(1);
    expect(appPreferencesSchema.parse({ theme: 'system', language: 'zh-CN' }).defaultCount).toBe(1);
    expect(
      appPreferencesSchema.parse({ theme: 'system', language: 'zh-CN', defaultCount: 4 }),
    ).toMatchObject({ defaultCount: 4 });
    expect(
      appPreferencesSchema.safeParse({ theme: 'system', language: 'zh-CN', defaultCount: 3 })
        .success,
    ).toBe(false);

    // 单字段 patch 不能把 defaultCount 打回 1(withoutDefaults 纪律)。
    expect(appPreferencesPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(appPreferencesPatchSchema.parse({ defaultCount: 2 })).toEqual({ defaultCount: 2 });
    expect(appPreferencesPatchSchema.safeParse({ defaultCount: 3 }).success).toBe(false);
  });
});

it('reference release accepts only an upload id, never caller-controlled paths or ownership', () => {
  expect(releaseReferenceImageInputSchema.parse({ id: 'reference-123' })).toEqual({
    id: 'reference-123',
  });
  for (const input of [
    {},
    { id: '../secret' },
    { id: 'short' },
    { id: 'x'.repeat(65) },
    { id: 'reference-123', path: '/private' },
    { id: 'reference-123', userId: 'other' },
    { id: 'reference-123', senderId: 42 },
  ]) {
    expect(releaseReferenceImageInputSchema.safeParse(input).success).toBe(false);
  }
});
