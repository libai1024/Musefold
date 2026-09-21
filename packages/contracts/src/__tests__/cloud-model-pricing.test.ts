import { describe, expect, it } from 'vitest';
import { cloudModelNamesSchema, newApiPricingResponseSchema } from '../cloud-model-pricing';

describe('cloud model pricing contracts', () => {
  it('accepts multiple image names without a fixed model alias', () => {
    expect(
      cloudModelNamesSchema.parse(['musefold-image-pro', 'gpt-image-2', 'musefold-image']),
    ).toHaveLength(3);
  });
  it('retains explicit zero and requires the relevant pricing field', () => {
    const value = {
      data: [{ model_name: 'image-a', quota_type: 1, model_price: 0, enable_groups: ['vip'] }],
      group_ratio: { vip: 0 },
    };
    expect(newApiPricingResponseSchema.parse(value).data[0]?.model_price).toBe(0);
    expect(
      newApiPricingResponseSchema.safeParse({
        ...value,
        data: [{ ...value.data[0], model_price: undefined }],
      }).success,
    ).toBe(false);
  });
  it('does not reinterpret token pricing as a free per-image price', () => {
    const value = newApiPricingResponseSchema.parse({
      data: [
        {
          model_name: 'token-model',
          quota_type: 0,
          model_ratio: 2.5,
          completion_ratio: 4,
          enable_groups: ['default'],
        },
      ],
      group_ratio: { default: 3 },
    });
    expect(value.data[0]?.model_price).toBeUndefined();
    expect(value.data[0]?.model_ratio).toBe(2.5);
  });
});
