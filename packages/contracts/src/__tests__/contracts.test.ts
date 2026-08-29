import { describe, expect, it } from 'vitest';
import {
  appPreferencesSchema,
  cloudGenerationRequestSchema,
  generationAssetUrlSchema,
  generationReferenceImageSchema,
  mcpConnectionSchema,
  promptDocumentSchema,
  promptListQuerySchema,
  registerRequestSchema,
  saveAssetInputSchema,
  saveAssetResultSchema,
  updateMcpConnectionSchema,
  uploadReferenceImageInputSchema,
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

  it('upgrades legacy boolean reducedMotion archives to three-level motion', () => {
    const base = { theme: 'system', language: 'zh-CN' } as const;
    // v2.5 早期布尔存档:false(不减少)→ system,true(减少)→ on;缺字段 → system。
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: false }).reducedMotion).toBe(
      'system',
    );
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: true }).reducedMotion).toBe('on');
    expect(appPreferencesSchema.parse(base).reducedMotion).toBe('system');
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: 'off' }).reducedMotion).toBe('off');
    expect(appPreferencesSchema.safeParse({ ...base, reducedMotion: 'fast' }).success).toBe(false);
  });

  it('defaults referenceImages and bounds reference uploads', () => {
    // 旧存量请求(无字段)解析后补空数组,wire 无损兼容。
    expect(cloudGenerationRequestSchema.parse({ prompt: 'paper collage' }).referenceImages).toEqual(
      [],
    );
    const reference = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      url: 'media://local/?p=%2Ftmp%2Fref.png',
      name: 'ref.png',
      mimeType: 'image/png',
      byteSize: 1024,
    };
    expect(
      cloudGenerationRequestSchema.parse({ prompt: 'p', referenceImages: [reference] })
        .referenceImages,
    ).toHaveLength(1);
    // id 是宿主内定位符,不允许路径分隔符等自由字符。
    expect(
      generationReferenceImageSchema.safeParse({ ...reference, id: '../escape' }).success,
    ).toBe(false);
    expect(
      cloudGenerationRequestSchema.safeParse({
        prompt: 'p',
        referenceImages: Array.from({ length: 17 }, () => reference),
      }).success,
    ).toBe(false);
    // 上传入参:空字节与超限字节都拒绝。
    expect(
      uploadReferenceImageInputSchema.safeParse({ name: 'a.png', bytes: new Uint8Array(0) })
        .success,
    ).toBe(false);
    expect(
      uploadReferenceImageInputSchema.safeParse({ name: 'a.png', bytes: new Uint8Array(8) })
        .success,
    ).toBe(true);
  });

  it('validates save-asset input and result', () => {
    expect(
      saveAssetInputSchema.safeParse({
        url: 'media://local/?p=%2Fpics%2Fa.png',
        name: 'musefold-a.png',
      }).success,
    ).toBe(true);
    // 空文件名拒绝。
    expect(
      saveAssetInputSchema.safeParse({ url: 'https://cdn.test/a.png', name: '  ' }).success,
    ).toBe(false);
    expect(saveAssetResultSchema.parse('cancelled')).toBe('cancelled');
    expect(saveAssetResultSchema.safeParse('done').success).toBe(false);
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
