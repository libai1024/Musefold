import { describe, expect, it, vi } from 'vitest';
import { createNewApiClient } from '../index';

const row = {
  model_name: 'cloud-image-a',
  quota_type: 1,
  model_price: 0.04,
  enable_groups: ['default', 'vip'],
  supported_endpoint_types: ['image-generation'],
};
function pricing(data: unknown = [row], ratios: unknown = { default: 3, vip: 1 }) {
  return { success: true, data, group_ratio: ratios, pricing_version: 'same-protocol-version' };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('cloud model and pricing transport', () => {
  it('does not invent the default billing group when the upstream account omits it', async () => {
    const client = createNewApiClient('https://account.example.test', {
      fetchImpl: async () =>
        json({ success: true, data: { id: 42, username: 'alice', quota: 100 } }),
    });
    expect((await client.getSelf('fixture-jwt')).group).toBe('');
  });
  it('authenticates pricing with the verified account JWT and retains its group prices', async () => {
    const fetchImpl = vi.fn(async () => json(pricing()));
    const client = createNewApiClient('https://account.example.test', { fetchImpl });
    const result = await client.getPricing('fixture-account-jwt');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://account.example.test/api/pricing',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer fixture-account-jwt' }),
      }),
    );
    expect(result).toEqual({
      version: 'same-protocol-version',
      groupRatio: { default: 3, vip: 1 },
      models: [
        {
          modelName: 'cloud-image-a',
          quotaType: 1,
          modelPrice: 0.04,
          modelRatio: null,
          completionRatio: null,
          enableGroups: ['default', 'vip'],
          supportedEndpointTypes: ['image-generation'],
          billingMode: null,
        },
      ],
    });
  });

  it('does not treat a protocol version as a price cache key or reuse another account price', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(pricing()))
      .mockResolvedValueOnce(json(pricing([{ ...row, model_price: 0.6 }], { vip: 0.5 })));
    const client = createNewApiClient('https://account.example.test', { fetchImpl });
    const first = await client.getPricing('fixture-account-a');
    const second = await client.getPricing('fixture-account-b');
    expect(first.version).toBe(second.version);
    expect(first.models[0]?.modelPrice).toBe(0.04);
    expect(second.models[0]?.modelPrice).toBe(0.6);
    expect(second.groupRatio).toEqual({ vip: 0.5 });
    expect(fetchImpl.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer fixture-account-b');
  });

  it('preserves an explicitly free price and unknown billing metadata without inventing rates', async () => {
    const client = createNewApiClient('https://account.example.test', {
      fetchImpl: async () =>
        json(pricing([{ ...row, model_price: 0, billing_mode: 'tiered_expr' }], { vip: 0 })),
    });
    const result = await client.getPricing();
    expect(result.models[0]).toMatchObject({
      modelPrice: 0,
      billingMode: 'tiered_expr',
      modelRatio: null,
    });
    expect(result.groupRatio).toEqual({ vip: 0 });
  });

  it.each([
    ['missing price', { ...row, model_price: undefined }],
    ['null price', { ...row, model_price: null }],
    ['numeric string', { ...row, model_price: '0.04' }],
    ['negative price', { ...row, model_price: -1 }],
    ['invalid quota type', { ...row, quota_type: 2 }],
    ['missing token ratio', { ...row, quota_type: 0 }],
    ['invalid model name', { ...row, model_name: { secret: 'private-upstream-payload' } }],
    ['invalid group', { ...row, enable_groups: [7] }],
  ])('rejects %s without logging or exposing the upstream payload', async (_name, invalid) => {
    const client = createNewApiClient('https://account.example.test', {
      fetchImpl: async () => json(pricing([invalid])),
    });
    await expect(client.getPricing('fixture-jwt')).rejects.toMatchObject({
      code: 'server',
      message: '账号服务器定价格式无效',
      httpStatus: 200,
    });
  });

  it.each([undefined, null, [], { default: -1 }, { default: '3' }])(
    'rejects invalid group ratios %j',
    async (ratios) => {
      const response = pricing();
      response.group_ratio = ratios;
      const client = createNewApiClient('https://account.example.test', {
        fetchImpl: async () => json(response),
      });
      await expect(client.getPricing()).rejects.toMatchObject({ code: 'server' });
    },
  );

  it('rejects duplicate model prices rather than choosing one arbitrarily', async () => {
    const client = createNewApiClient('https://account.example.test', {
      fetchImpl: async () => json(pricing([row, { ...row, model_price: 0.6 }])),
    });
    await expect(client.getPricing()).rejects.toMatchObject({ code: 'server' });
  });

  it.each([401, 403])(
    'does not fall back to public pricing after an account auth failure (%i)',
    async (status) => {
      const fetchImpl = vi.fn(async () => json({ success: false }, status));
      const client = createNewApiClient('https://account.example.test', { fetchImpl });
      await expect(client.getPricing('fixture-jwt')).rejects.toMatchObject({
        code: 'auth',
        httpStatus: status,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, {}, ['model', {}], ['model', 'model'], ['bad\nmodel'], ['bad\u0000model']])(
    'rejects malformed account model lists %j',
    async (data) => {
      const client = createNewApiClient('https://account.example.test', {
        fetchImpl: async () => json({ success: true, data }),
      });
      await expect(client.listUserModels('fixture-jwt')).rejects.toMatchObject({
        code: 'server',
        message: '账号服务器模型列表格式无效',
      });
    },
  );
});
