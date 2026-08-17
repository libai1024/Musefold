import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  loadApiKey: vi.fn(() => 'sk-wukong-unit-test'),
}));

vi.mock('fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));

import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { WukongStudioProvider } from '../wukong-studio';

configureTestCoreRuntime('/tmp/musefold-test', { loadApiKey: mocks.loadApiKey });

const REQUEST = {
  jobId: 'history-wukong-unit-test',
  providerId: 'wk-1',
  prompt: 'unit test image',
  size: '1024x1024' as const,
  aspectRatio: '16:9',
  quality: 'auto' as const,
  n: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WukongStudioProvider retry integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries transient submit and poll failures before saving the image', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'submit unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ task_id: 'task-1', billing: { yuan: 0.12 } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'poll unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'succeeded', url: 'https://image.test/result.png' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();
    const provider = new WukongStudioProvider('wk-1', 'https://wk.test/api/v1/studio', 'image_gptImage2', 'Wukong');

    const pending = provider.generateImage(REQUEST, undefined, progress);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toMatchObject({ historyId: REQUEST.jobId, status: 'success', cost: 1.2, costUnit: 'point' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ phase: 'retrying', attempt: 1, status: 503 }),
      expect.objectContaining({ phase: 'retrying', attempt: 1, status: 503 }),
    ]);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    const [imagePath, imageData] = mocks.writeFile.mock.calls[0];
    expect(imagePath).toBe(join(testCorePaths('/tmp/musefold-test').pictures, `${REQUEST.jobId}.png`));
    expect(Array.from(imageData as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'invalid key' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new WukongStudioProvider('wk-1', 'https://wk.test/api/v1/studio', 'image_gptImage2', 'Wukong');

    await expect(provider.generateImage(REQUEST)).rejects.toMatchObject({ code: 'AUTH', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
