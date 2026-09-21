import { describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';

const result = {
  identity: {
    apiIssuer: 'https://api.example.test',
    principalId: 'principal-a',
    payer: { issuer: 'https://account.example.test', ownerId: '42' },
    credential: { ref: 'credential-a', version: 1 },
  },
  group: 'vip',
  checkedAt: '2026-09-20T00:00:00.000Z',
  models: [
    {
      model: 'image-a',
      supportedEndpointTypes: ['image-generation'],
      imageGeneration: true,
      pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 },
    },
  ],
};
describe('cloud account model catalog gateway', () => {
  it('uses the authenticated read endpoint and validates the complete pricing shape', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(result)));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch });
    await expect(gateway.account.getModelCatalog?.()).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/account/models',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
  it('does not silently turn an invalid returned price into zero', async () => {
    const invalid = structuredClone(result);
    Reflect.deleteProperty(invalid.models[0]?.pricing ?? {}, 'quotaPerCall');
    const gateway = createCloudDataGateway({
      baseUrl: 'https://api.example.test',
      fetch: async () => new Response(JSON.stringify(invalid)),
    });
    await expect(gateway.account.getModelCatalog?.()).rejects.toThrow();
  });
});
