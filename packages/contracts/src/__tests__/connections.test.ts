import { describe, expect, it } from 'vitest';
import {
  aiProviderDraftListModelsSchema,
  aiProviderListModelsInputSchema,
  aiProviderModelListSchema,
  aiProviderTestInputSchema,
  aiProviderTestResultSchema,
} from '../connections';

describe('aiProviderTestInputSchema', () => {
  it('accepts a saved connection id', () => {
    expect(aiProviderTestInputSchema.parse({ id: 'prov_1' })).toEqual({ id: 'prov_1' });
  });

  it('accepts a draft probe with required apiKey and optional model', () => {
    expect(
      aiProviderTestInputSchema.parse({
        baseUrl: 'https://gw.example/v1',
        apiKey: 'sk-draft',
        model: 'gpt-image-2',
      }),
    ).toEqual({
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-draft',
      model: 'gpt-image-2',
    });
    expect(
      aiProviderTestInputSchema.parse({
        baseUrl: 'https://gw.example/v1',
        apiKey: 'sk-draft',
      }),
    ).toEqual({
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-draft',
    });
  });

  it('rejects a draft without apiKey and mixed saved+draft shapes', () => {
    expect(
      aiProviderTestInputSchema.safeParse({
        baseUrl: 'https://gw.example/v1',
      }).success,
    ).toBe(false);
    expect(
      aiProviderTestInputSchema.safeParse({
        id: 'prov_1',
        baseUrl: 'https://gw.example/v1',
        apiKey: 'sk-mixed',
      }).success,
    ).toBe(false);
  });
});

describe('aiProviderListModelsInputSchema', () => {
  it('accepts a saved id or a draft with optional apiKey/protocol', () => {
    expect(aiProviderListModelsInputSchema.parse({ id: 'prov_1' })).toEqual({ id: 'prov_1' });
    expect(
      aiProviderListModelsInputSchema.parse({
        baseUrl: 'https://gw.example/v1',
      }),
    ).toEqual({ baseUrl: 'https://gw.example/v1' });
    expect(
      aiProviderDraftListModelsSchema.parse({
        baseUrl: 'https://gw.example/v1',
        apiKey: 'sk-draft',
        protocol: 'openai-compatible',
      }),
    ).toEqual({
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-draft',
      protocol: 'openai-compatible',
    });
  });

  it('rejects an invalid baseUrl', () => {
    expect(aiProviderListModelsInputSchema.safeParse({ baseUrl: 'not-a-url' }).success).toBe(false);
  });
});

describe('aiProviderModelListSchema', () => {
  it('accepts models with optional labels', () => {
    expect(
      aiProviderModelListSchema.parse({
        models: [{ id: 'gpt-image-2' }, { id: 'flux', label: 'Flux Schnell' }],
      }),
    ).toEqual({
      models: [{ id: 'gpt-image-2' }, { id: 'flux', label: 'Flux Schnell' }],
    });
  });

  it('rejects empty model ids', () => {
    expect(aiProviderModelListSchema.safeParse({ models: [{ id: '' }] }).success).toBe(false);
  });
});

describe('aiProviderTestResultSchema', () => {
  it('keeps latency nullable on failure', () => {
    expect(
      aiProviderTestResultSchema.parse({
        ok: false,
        message: 'API Key 无效或无权限',
        latencyMs: null,
      }),
    ).toMatchObject({ ok: false, latencyMs: null });
  });
});
