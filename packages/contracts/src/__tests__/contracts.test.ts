import { describe, expect, it } from 'vitest';
import {
  cloudGenerationRequestSchema,
  generationAssetUrlSchema,
  mcpConnectionSchema,
  promptDocumentSchema,
  promptListQuerySchema,
  registerRequestSchema,
  updateMcpConnectionSchema,
  generationHistoryQuerySchema,
} from '../index';

describe('cloud-safe contracts', () => {
  it('applies stable list and generation defaults', () => {
    expect(promptListQuerySchema.parse({})).toMatchObject({
      limit: 20,
      includeDeleted: false,
      sort: 'updated-desc',
    });
    expect(cloudGenerationRequestSchema.parse({ prompt: 'paper collage' })).toMatchObject({
      size: 'auto',
      quality: 'auto',
      count: 1,
    });
  });

  it('keeps providerId but strips undeclared desktop-only fields', () => {
    // providerId 是跨端合法字段(桌面选本地连接,云端忽略);路径类字段不进契约。
    const parsed = cloudGenerationRequestSchema.parse({
      prompt: 'paper collage',
      providerId: 'local-provider',
      imagePath: '/tmp/result.png',
    });
    expect(parsed.providerId).toBe('local-provider');
    expect(parsed).not.toHaveProperty('imagePath');
  });

  it('accepts history filter bounds and keeps list defaults', () => {
    expect(
      generationHistoryQuerySchema.parse({
        status: 'failed',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
        providerModel: 'musefold-image-pro',
        search: '建筑',
      }),
    ).toMatchObject({
      limit: 20,
      includeDeleted: false,
      status: 'failed',
      providerModel: 'musefold-image-pro',
    });
    expect(generationHistoryQuerySchema.safeParse({ status: 'success' }).success).toBe(false);
  });

  it('strips non-contract registration fields', () => {
    expect(
      registerRequestSchema.parse({
        username: 'musefold',
        password: 'secret-password',
        displayName: 'not persisted',
      }),
    ).toEqual({ username: 'musefold', password: 'secret-password' });
  });

  it('requires versioned prompt records with valid timestamps', () => {
    const result = promptDocumentSchema.safeParse({
      id: '01K1TEST',
      title: 'Poster study',
      description: null,
      content: 'A quiet poster',
      negative: null,
      folderId: null,
      tags: [],
      modelId: null,
      params: null,
      isPinned: false,
      usageCount: 0,
      version: 0,
      createdAt: 'not-a-date',
      updatedAt: 'not-a-date',
      deletedAt: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts same-origin assets without allowing executable URLs', () => {
    expect(generationAssetUrlSchema.parse('/Musefold/app/assets/result.png')).toBe(
      '/Musefold/app/assets/result.png',
    );
    expect(generationAssetUrlSchema.parse('https://cdn.example.com/result.png')).toBe(
      'https://cdn.example.com/result.png',
    );
    expect(generationAssetUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(generationAssetUrlSchema.safeParse('//untrusted.example/result.png').success).toBe(
      false,
    );
  });

  it('keeps Cloud MCP spend statistics read-only and validates reauthentication', () => {
    const connection = mcpConnectionSchema.parse({
      id: 'connection-1',
      clientName: 'Codex',
      scopes: ['account:read'],
      mode: 'ask_each_time',
      maxPointsPerGeneration: 1_000,
      maxPointsPerDay: 5_000,
      spentPointsToday: 1_000,
      reservedPointsToday: 2_000,
      status: 'active',
      createdAt: '2026-08-18T00:00:00.000Z',
      lastUsedAt: null,
    });
    expect(connection).toMatchObject({
      spentPointsToday: 1_000,
      reservedPointsToday: 2_000,
    });
    const update = updateMcpConnectionSchema.parse({
      maxPointsPerDay: 8_000,
      scopes: ['account:read', 'prompts:read'],
      reauthPassword: 'current-password',
      spentPointsToday: 0,
    });
    expect(update).toEqual({
      maxPointsPerDay: 8_000,
      scopes: ['account:read', 'prompts:read'],
      reauthPassword: 'current-password',
    });
    expect(updateMcpConnectionSchema.safeParse({ reauthPassword: 'short' }).success).toBe(false);
    // v2：能力可编辑，但至少保留一项，且只接受已知 scope。
    expect(updateMcpConnectionSchema.safeParse({ scopes: [] }).success).toBe(false);
    expect(updateMcpConnectionSchema.safeParse({ scopes: ['prompts:admin'] }).success).toBe(false);
  });
});
