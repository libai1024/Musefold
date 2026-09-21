import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ensureStorageBucket } from '../storage-bootstrap.js';

const env = { S3_BUCKET: 'synthetic-bucket', S3_REGION: 'us-east-1', S3_AUTO_CREATE_BUCKET: true };
describe('storage bootstrap', () => {
  it.each([true, false])('does not create an existing bucket (autoCreate=%s)', async (enabled) => {
    const send = vi.fn().mockResolvedValue({});
    expect(await ensureStorageBucket({ send }, { ...env, S3_AUTO_CREATE_BUCKET: enabled })).toBe(
      'existing',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
  });
  it.each([
    { $metadata: { httpStatusCode: 404 } },
    { name: 'NotFound' },
    { name: 'NoSuchBucket' },
    { Code: 'NoSuchBucket' },
  ])('creates only a confirmed missing bucket: %j', async (error) => {
    const send = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({});
    expect(await ensureStorageBucket({ send }, env)).toBe('created');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    expect(send.mock.calls[1][0].input).toEqual({ Bucket: env.S3_BUCKET });
  });
  it.each(['eu-west-1', 'auto'])('preserves the configured creation region %s', async (region) => {
    const send = vi.fn().mockRejectedValueOnce({ name: 'NotFound' }).mockResolvedValue({});
    await ensureStorageBucket({ send }, { ...env, S3_REGION: region });
    expect(send.mock.calls[1][0].input).toEqual({
      Bucket: env.S3_BUCKET,
      CreateBucketConfiguration: { LocationConstraint: region },
    });
  });
  it('honors disabled creation even for a real missing bucket', async () => {
    const send = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    await expect(
      ensureStorageBucket({ send }, { ...env, S3_AUTO_CREATE_BUCKET: false }),
    ).rejects.toThrow('creation is disabled');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { $metadata: { httpStatusCode: 403 } },
    { $metadata: { httpStatusCode: 500 } },
    { name: 'NoSuchBucket', $metadata: { httpStatusCode: 403 } },
    { name: 'AccessDenied' },
    { code: 'ECONNREFUSED' },
    new Error('synthetic-network-failure'),
    null,
    'unexpected upstream result',
  ])('never attempts creation after an unclassified/access/network failure: %j', async (error) => {
    const send = vi.fn().mockRejectedValue(error);
    await expect(ensureStorageBucket({ send }, env)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('propagates failed creation instead of declaring storage ready', async () => {
    const error = new Error('synthetic-create-failure');
    const send = vi.fn().mockRejectedValueOnce({ name: 'NotFound' }).mockRejectedValueOnce(error);
    await expect(ensureStorageBucket({ send }, env)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
