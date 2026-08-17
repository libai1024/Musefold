import { describe, expect, it } from 'vitest';
import type { PromptDocument } from '@musefold/contracts';
import {
  applyPromptToGeneration,
  getProductCapabilities,
  normalizePromptDraft,
} from '../index';

function promptFixture(): PromptDocument {
  return {
    id: '01K1PROMPT',
    title: 'Field notes',
    description: null,
    content: 'A folded paper landscape',
    negative: 'watermark',
    folderId: null,
    tags: ['paper'],
    modelId: null,
    params: null,
    isPinned: false,
    usageCount: 2,
    version: 1,
    createdAt: '2026-08-17T08:00:00.000Z',
    updatedAt: '2026-08-17T08:00:00.000Z',
    deletedAt: null,
  };
}

describe('surface capabilities', () => {
  it('keeps desktop-only features out of the Web surface', () => {
    const web = getProductCapabilities('web');
    expect(web.generation).toBe(true);
    expect(web.cloudPrompts).toBe(true);
    expect(web.agent).toBe(false);
    expect(web.automation).toBe(false);
    expect(web.byokProviders).toBe(false);
  });
});

describe('prompt application rules', () => {
  it('normalizes optional values and de-duplicates tags', () => {
    expect(normalizePromptDraft({
      title: '  Poster   study ',
      content: '  a quiet image  ',
      tags: ['Paper', 'paper', ' blue '],
    })).toMatchObject({
      title: 'Poster study',
      content: 'a quiet image',
      description: null,
      tags: ['Paper', 'blue'],
      isPinned: false,
    });
  });

  it('maps a cloud prompt without desktop provider or file fields', () => {
    expect(applyPromptToGeneration(promptFixture(), {
      aspectRatio: '16:9',
      quality: 'medium',
    })).toEqual({
      prompt: 'A folded paper landscape',
      negative: 'watermark',
      promptId: '01K1PROMPT',
      size: 'auto',
      aspectRatio: '16:9',
      quality: 'medium',
      count: 1,
    });
  });
});
