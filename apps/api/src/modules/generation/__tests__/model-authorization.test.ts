import { accountModelCatalogSchema, type ExecutionBinding } from '@musefold/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  assertModelAuthorizationIdentity,
  readGenerationModelAuthorization,
} from '../model-authorization.js';

const identity = {
  apiIssuer: 'https://api.example.test',
  principalId: 'principal',
  payer: { issuer: 'https://images.example.test', ownerId: 'owner' },
  credential: { ref: 'credential', version: 1 },
};
const binding: ExecutionBinding = {
  ...identity,
  providerId: 'cloud-default',
  model: 'gpt-image-2',
  capabilities: { image: true, text: false },
};
function catalog() {
  return accountModelCatalogSchema.parse({
    identity,
    group: 'vip',
    checkedAt: new Date().toISOString(),
    models: [
      {
        model: 'gpt-image-2',
        supportedEndpointTypes: ['openai'],
        imageGeneration: true,
        pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 },
      },
    ],
  });
}

describe('cloud model admission boundary', () => {
  it('reads on every new authorization and rejects a now missing cloud price, including for the old default alias', async () => {
    const current = catalog();
    const read = vi.fn(async () => current);
    const authorization = await readGenerationModelAuthorization(read, 'session', binding.model);
    expect(authorization).toEqual({ model: binding.model, identity });
    expect(() => assertModelAuthorizationIdentity(authorization, binding)).not.toThrow();
    current.models[0].pricing = { kind: 'unavailable', reason: 'missing_price' };
    await expect(
      readGenerationModelAuthorization(read, 'session', binding.model),
    ).rejects.toMatchObject({ status: 503 });
    expect(read).toHaveBeenCalledTimes(2);
    current.models[0].model = 'musefold-image-pro';
    await expect(
      readGenerationModelAuthorization(read, 'session', 'musefold-image-pro'),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('does not infer image transport merely from a generic OpenAI endpoint or a client boolean', async () => {
    const current = catalog();
    current.models[0].model = 'chat-model';
    await expect(
      readGenerationModelAuthorization(async () => current, 'session', 'chat-model'),
    ).rejects.toMatchObject({ status: 409 });
    current.models[0].supportedEndpointTypes = ['image-generation'];
    expect(
      (await readGenerationModelAuthorization(async () => current, 'session', 'chat-model')).model,
    ).toBe('chat-model');
  });
  it('fails closed when the catalog dependency is missing and permits only explicitly priced zero', async () => {
    await expect(
      readGenerationModelAuthorization(undefined, 'session', binding.model),
    ).rejects.toMatchObject({ status: 503 });
    const current = catalog();
    current.models[0].pricing = { kind: 'per_call', baseUsd: 0, groupRatio: 1, quotaPerCall: 0 };
    expect(
      (await readGenerationModelAuthorization(async () => current, 'session', binding.model)).model,
    ).toBe(binding.model);
  });
  it('rejects every identity or model change after reading the catalog', () => {
    const authorization = { identity, model: binding.model };
    for (const changed of [
      { ...binding, principalId: 'other' },
      { ...binding, apiIssuer: 'https://other.example.test' },
      { ...binding, payer: { ...binding.payer, issuer: 'https://other.example.test' } },
      { ...binding, payer: { ...binding.payer, ownerId: 'other' } },
      { ...binding, credential: { ...binding.credential, ref: 'other' } },
      { ...binding, credential: { ...binding.credential, version: 2 } },
      { ...binding, model: 'musefold-image' },
    ])
      expect(() => assertModelAuthorizationIdentity(authorization, changed)).toThrow(
        /账号或凭据已变化/,
      );
  });
});
