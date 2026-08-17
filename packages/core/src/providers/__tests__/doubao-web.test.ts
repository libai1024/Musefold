import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateImageRequest } from '@shared/types/providers';
import { configureTestCoreRuntime } from '../../testing';
import { DoubaoWebProvider } from '../doubao-web';

const runtime = {
  validate: vi.fn(),
  generateImage: vi.fn(),
};

const request: GenerateImageRequest = {
  jobId: 'doubao-web-test-job',
  providerId: 'doubao-web-1',
  prompt: '一张测试图片',
  size: '1024x1024',
  aspectRatio: '1:1',
  quality: 'auto',
  n: 1,
};

configureTestCoreRuntime('/tmp/musefold-doubao-web-test', { doubaoWeb: runtime });

describe('DoubaoWebProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the web image model without requiring an API key', async () => {
    const provider = new DoubaoWebProvider(
      'doubao-web-1',
      'https://www.doubao.com/chat/create-image',
      'seedream-4.5',
      '豆包网页版',
    );

    await expect(provider.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'seedream-4.5', name: 'Seedream 4.5' }),
    ]);
  });

  it('delegates validation and generation to the desktop web runtime', async () => {
    runtime.validate.mockResolvedValue({ ok: true, message: '已登录' });
    runtime.generateImage.mockResolvedValue({
      historyId: request.jobId,
      status: 'success',
      imagePath: '/tmp/doubao.webp',
    });
    const provider = new DoubaoWebProvider(
      'doubao-web-1',
      'https://www.doubao.com/chat/create-image',
      'seedream-4.5',
      '豆包网页版',
    );

    await expect(provider.validateConnection()).resolves.toEqual({ ok: true, message: '已登录' });
    await expect(provider.generateImage(request)).resolves.toMatchObject({
      historyId: request.jobId,
      status: 'success',
    });
    expect(runtime.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'seedream-4.5', prompt: request.prompt }),
      undefined,
    );
  });
});
