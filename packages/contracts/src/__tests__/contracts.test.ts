import { describe, expect, it } from 'vitest';
import {
  cloudGenerationRequestSchema,
  generationAssetUrlSchema,
  promptDocumentSchema,
  promptListQuerySchema,
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

  it('rejects desktop-only generation fields', () => {
    const parsed = cloudGenerationRequestSchema.parse({
      prompt: 'paper collage',
      providerId: 'local-provider',
      imagePath: '/tmp/result.png',
    });
    expect(parsed).not.toHaveProperty('providerId');
    expect(parsed).not.toHaveProperty('imagePath');
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
    expect(generationAssetUrlSchema.parse('/Musefold/app/assets/result.png')).toBe('/Musefold/app/assets/result.png');
    expect(generationAssetUrlSchema.parse('https://cdn.example.com/result.png')).toBe('https://cdn.example.com/result.png');
    expect(generationAssetUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(generationAssetUrlSchema.safeParse('//untrusted.example/result.png').success).toBe(false);
  });
});
