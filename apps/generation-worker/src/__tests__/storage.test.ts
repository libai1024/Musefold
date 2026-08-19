import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ensureStorageBucket } from '../storage.js';

const baseConfig = {
  S3_BUCKET: 'musefold-test',
  S3_REGION: 'us-east-1',
  S3_AUTO_CREATE_BUCKET: true,
};

describe('generation object storage bootstrap', () => {
  it('leaves an existing bucket unchanged', async () => {
    const send = vi.fn().mockResolvedValue({});

    await expect(
      ensureStorageBucket({ send } as never, baseConfig),
    ).resolves.toBe('existing');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it('creates a missing bucket when bootstrap is enabled', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      })
      .mockResolvedValueOnce({});

    await expect(
      ensureStorageBucket({ send } as never, baseConfig),
    ).resolves.toBe('created');
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateBucketCommand);
  });

  it('fails closed when bucket bootstrap is disabled', async () => {
    const send = vi.fn().mockRejectedValue({
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

    await expect(
      ensureStorageBucket({ send } as never, {
        ...baseConfig,
        S3_AUTO_CREATE_BUCKET: false,
      }),
    ).rejects.toThrow('automatic creation is disabled');
  });
});
