import { describe, expect, it } from 'vitest';
import type { PromptDocument } from '@musefold/contracts';
import {
  applyPromptToGeneration,
  canTransitionGeneration,
  composerToGenerationRequest,
  generationRequestToPromptDraft,
  getProductCapabilities,
  normalizePromptDraft,
  titleFromPromptContent,
} from '../index';

function promptFixture(): PromptDocument {
  return {
    id: '01K1PROMPT',
    title: 'Field notes',
    description: null,
    content: 'A folded paper landscape',
    negative: 'watermark',
    folderId: null,
    tags: [{
      id: 'tag-paper',
      name: 'paper',
      group: null,
      color: null,
      version: 1,
      createdAt: '2026-08-17T08:00:00.000Z',
      updatedAt: '2026-08-17T08:00:00.000Z',
      deletedAt: null,
    }],
    modelId: null,
    params: null,
    rating: 3,
    isPinned: false,
    pinOrder: null,
    usageCount: 2,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
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
    expect(web.workbench).toBe(true);
    expect(web.promptSync).toBe(true);
    expect(web.cloudMcpConnections).toBe(true);
    expect(web.cloudPrompts).toBe(true);
    expect(web.agent).toBe(false);
    expect(web.automation).toBe(false);
    expect(web.byokProviders).toBe(false);
  });

  it('exposes the full desktop host surface except cloud prompts', () => {
    const desktop = getProductCapabilities('desktop');
    expect(desktop.localPrompts).toBe(true);
    expect(desktop.designSchemes).toBe(true);
    expect(desktop.generationHistory).toBe(true);
    expect(desktop.agent).toBe(true);
    expect(desktop.automation).toBe(true);
    expect(desktop.byokProviders).toBe(true);
    expect(desktop.cloudMcpConnections).toBe(true);
    expect(desktop.promptSync).toBe(true);
    expect(desktop.cloudPrompts).toBe(false);
  });
});

describe('prompt application rules', () => {
  it('normalizes optional values and de-duplicates tag ids', () => {
    expect(normalizePromptDraft({
      title: '  Poster   study ',
      content: '  a quiet image  ',
      tagIds: ['tag-paper', 'tag-paper', ' tag-blue '],
    })).toMatchObject({
      title: 'Poster study',
      content: 'a quiet image',
      description: null,
      tagIds: ['tag-paper', 'tag-blue'],
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

  it('maps composer fields to a cloud generation request', () => {
    expect(composerToGenerationRequest({
      prompt: '  quiet glass  ',
      promptId: '01K1PROMPT',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'medium',
    })).toEqual({
      prompt: 'quiet glass',
      promptId: '01K1PROMPT',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'medium',
      count: 1,
    });
  });

  it('maps a generation request back to a cloud prompt draft', () => {
    const draft = generationRequestToPromptDraft({
      prompt: '  A quiet glass study under morning light  ',
      negative: 'watermark',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      count: 1,
    });

    expect(draft).toEqual({
      title: 'A quiet glass study under morning light',
      description: null,
      content: 'A quiet glass study under morning light',
      negative: 'watermark',
      folderId: null,
      tagIds: [],
      modelId: null,
      params: {
        size: '1024x1024',
        aspectRatio: '1:1',
        quality: 'high',
        count: 1,
      },
      rating: 0,
      isPinned: false,
      source: 'generation',
      sourceUrl: null,
    });
    expect(titleFromPromptContent('')).toBe('生成提示词');
  });
});

describe('generation state machine', () => {
  it('allows approval and execution transitions but rejects terminal restarts', () => {
    expect(canTransitionGeneration('pending_approval', 'queued')).toBe(true);
    expect(canTransitionGeneration('pending_approval', 'cancelled')).toBe(true);
    expect(canTransitionGeneration('running', 'succeeded')).toBe(true);
    expect(canTransitionGeneration('failed', 'queued')).toBe(false);
  });
});
