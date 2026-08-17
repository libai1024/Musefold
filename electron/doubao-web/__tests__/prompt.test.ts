import { describe, expect, it } from 'vitest';
import type { GenerateImageRequest } from '@shared/types/providers';
import { composeDoubaoWebPrompt } from '../prompt';

function request(patch: Partial<GenerateImageRequest> = {}): GenerateImageRequest {
  return {
    ...patch,
    providerId: patch.providerId ?? 'doubao-web-1',
    prompt: patch.prompt ?? '安静的陶器静物摄影',
    size: patch.size ?? '1024x1024',
    aspectRatio: patch.aspectRatio ?? '1:1',
    quality: patch.quality ?? 'medium',
    n: patch.n ?? 1,
  };
}

describe('composeDoubaoWebPrompt', () => {
  it('keeps the normal generation prompt and options', () => {
    expect(composeDoubaoWebPrompt(request({ negative: '文字、水印' }))).toBe(
      '安静的陶器静物摄影\n\n避免出现：文字、水印\n\n画幅比例：1:1',
    );
  });

  it('sends only the current instruction when refining an image', () => {
    expect(composeDoubaoWebPrompt(request({
      prompt: `# Pasted Skill\n${'很长的规则'.repeat(10_000)}`,
      negative: '首次生成的负面提示词',
      refinementInstruction: '增强晨光，保持陶器造型不变',
      referenceImages: [{
        source: 'history',
        historyId: 'doubao-batch',
        path: '/tmp/doubao-batch-3.png',
      }],
    }))).toBe('增强晨光，保持陶器造型不变');
  });
});
