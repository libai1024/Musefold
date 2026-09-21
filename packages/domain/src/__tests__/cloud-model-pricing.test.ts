import { describe, expect, it } from 'vitest';
import type { RelayPricing } from '@musefold/contracts';
import { projectAccountModelPrices } from '../cloud-model-pricing';

function prices(): RelayPricing {
  return {
    version: 'protocol-v1',
    groupRatio: { default: 3, vip: 1 },
    models: [
      {
        modelName: 'image-a',
        quotaType: 1,
        modelPrice: 0.04,
        modelRatio: null,
        completionRatio: null,
        enableGroups: ['default', 'vip'],
      },
      {
        modelName: 'image-b',
        quotaType: 1,
        modelPrice: 0.6,
        modelRatio: null,
        completionRatio: null,
        enableGroups: ['all'],
      },
      {
        modelName: 'text',
        quotaType: 0,
        modelPrice: null,
        modelRatio: 2.5,
        completionRatio: 4,
        enableGroups: ['default', 'vip'],
      },
    ],
  };
}
describe('account-scoped cloud price projection', () => {
  it('exposes explicit image endpoints and known deployed aliases, not arbitrary chat models', () => {
    const p = prices();
    const first = p.models[0];
    if (!first) throw new Error('Missing test model');
    for (const name of ['musefold-image-pro', 'musefold-image', 'gpt-image-2', 'chat-only']) {
      p.models.push({ ...first, modelName: name, supportedEndpointTypes: ['openai'] });
    }
    first.supportedEndpointTypes = ['image-generation'];
    const rows = projectAccountModelPrices(
      ['image-a', 'image-b', 'musefold-image-pro', 'musefold-image', 'gpt-image-2', 'chat-only'],
      p,
      'vip',
    );
    expect(rows.map((row) => row.imageGeneration)).toEqual([true, false, true, true, true, false]);
    expect(rows[0]?.pricing).toMatchObject({ quotaPerCall: 20000 });
  });
  it('applies the current account group without admitting unlisted models or inventing capability', () => {
    const p = prices();
    const result = projectAccountModelPrices(['image-b', 'image-a'], p, 'default');
    expect(result.map((row) => row.model)).toEqual(['image-b', 'image-a']);
    expect(result.map((row) => row.pricing)).toEqual([
      { kind: 'per_call', baseUsd: 0.6, groupRatio: 3, quotaPerCall: 900000 },
      { kind: 'per_call', baseUsd: 0.04, groupRatio: 3, quotaPerCall: 60000 },
    ]);
    expect(result.every((row) => row.supportedEndpointTypes.length === 0)).toBe(true);
    expect(projectAccountModelPrices(['image-a'], p, 'vip')[0]?.pricing).toMatchObject({
      quotaPerCall: 20000,
    });
  });
  it('keeps token pricing separate and preserves explicit free prices', () => {
    const p = prices();
    expect(projectAccountModelPrices(['text'], p, 'default')[0]?.pricing).toEqual({
      kind: 'usage',
      groupRatio: 3,
      inputQuotaPerToken: 7.5,
      outputQuotaPerToken: 30,
    });
    p.groupRatio.vip = 0;
    expect(projectAccountModelPrices(['image-a'], p, 'vip')[0]?.pricing).toMatchObject({
      kind: 'per_call',
      quotaPerCall: 0,
    });
    const first = p.models[0];
    if (!first) throw new Error('Missing test model');
    first.modelPrice = 0;
    expect(projectAccountModelPrices(['image-a'], p, 'default')[0]?.pricing).toMatchObject({
      kind: 'per_call',
      quotaPerCall: 0,
    });
  });
  it('does not silently select another group, use inherited properties or default the price', () => {
    const p = prices();
    expect(projectAccountModelPrices(['missing'], p, 'vip')[0]?.pricing).toEqual({
      kind: 'unavailable',
      reason: 'missing_price',
    });
    expect(projectAccountModelPrices(['image-a'], p, 'other')[0]?.pricing).toEqual({
      kind: 'unavailable',
      reason: 'group_not_enabled',
    });
    expect(projectAccountModelPrices(['image-b'], p, 'constructor')[0]?.pricing).toEqual({
      kind: 'unavailable',
      reason: 'missing_group_ratio',
    });
  });
  it.each([NaN, Infinity, -1, Number.MAX_VALUE])(
    'rejects invalid or overflowing cloud rates %s',
    (rate) => {
      const p = prices();
      p.groupRatio.default = rate;
      expect(projectAccountModelPrices(['image-a'], p, 'default')[0]?.pricing.kind).toBe(
        'unavailable',
      );
    },
  );
  it('does not apply flat prices to unknown or tiered billing rules', () => {
    const p = prices();
    const first = p.models[0];
    if (!first) throw new Error('Missing test model');
    first.billingMode = 'tiered_expr';
    expect(projectAccountModelPrices(['image-a'], p, 'default')[0]?.pricing).toEqual({
      kind: 'unavailable',
      reason: 'unsupported_billing',
    });
  });
});
