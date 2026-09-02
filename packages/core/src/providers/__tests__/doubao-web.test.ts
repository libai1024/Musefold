import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
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
    expect(runtime.generateImage.mock.calls[0]?.[0]).not.toHaveProperty('aspectRatio');
  });

  it('sanitizes bridge error messages in validation failures', async () => {
    runtime.validate.mockRejectedValue(
      Object.assign(
        new Error(
          '会话失效，请通过 https://www.doubao.com/passport/login?token=abcdefghij1234567890abcd 重新登录',
        ),
        { code: 'AUTH' },
      ),
    );
    const provider = new DoubaoWebProvider(
      'doubao-web-1',
      'https://www.doubao.com/chat/create-image',
      'seedream-4.5',
      '豆包网页版',
    );

    const result = await provider.validateConnection();

    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTH');
    expect(result.message).not.toContain('token=');
    expect(result.message).not.toContain('passport/login');
    expect(result.message).toContain('[链接已隐藏]');
  });

  it('sanitizes failed generation results while preserving the error code', async () => {
    runtime.generateImage.mockResolvedValue({
      historyId: request.jobId,
      status: 'failed',
      error: {
        code: 'DOUBAO_DAILY_LIMIT',
        message:
          '下载图片失败 https://lf-cdn.example.com/aigc/out.png?X-Amz-Signature=deadbeefcafe1234deadbeefcafe1234 与本机 /Users/wangwei/Library/Application Support/musefold/x.png',
      },
    });
    const provider = new DoubaoWebProvider(
      'doubao-web-1',
      'https://www.doubao.com/chat/create-image',
      'seedream-4.5',
      '豆包网页版',
    );

    const result = await provider.generateImage(request);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('DOUBAO_DAILY_LIMIT');
    expect(result.error?.message).not.toContain('X-Amz-Signature');
    expect(result.error?.message).not.toContain('/Users/wangwei');
    expect(result.error?.message).toContain('[本地路径]');
    expect(result.error?.message?.length).toBeLessThanOrEqual(500);
  });
});
