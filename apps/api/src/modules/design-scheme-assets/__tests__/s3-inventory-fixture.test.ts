import { createHash } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { expect, it } from 'vitest';
import { startS3Fixture } from './s3-fixture.js';

it('lists owned objects with pagination and metadata without consuming an object GET barrier', async () => {
  const fixture = await startS3Fixture();
  const client = new S3Client({
    endpoint: fixture.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'fixture-key', secretAccessKey: 'fixture-secret' },
  });
  const Bucket = 'test-scheme-assets';
  try {
    fixture.objects.set('users/a&b', Buffer.from('first'));
    fixture.objects.set('users/第二', Buffer.from('second'));
    fixture.objects.set('scheme-exports/other', Buffer.from('excluded'));
    fixture.holdNext('GET');
    const first = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix: 'users/', MaxKeys: 1 }),
    );
    expect(first.IsTruncated).toBe(true);
    expect(first.NextContinuationToken).toEqual(expect.any(String));
    expect(first.Contents).toEqual([
      expect.objectContaining({
        Key: 'users/a&b',
        Size: 5,
        ETag: `"${createHash('md5').update('first').digest('hex')}"`,
        LastModified: expect.any(Date),
      }),
    ]);
    const second = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: 'users/',
        MaxKeys: 1,
        ContinuationToken: first.NextContinuationToken,
      }),
    );
    expect(second.IsTruncated).toBe(false);
    expect(second.NextContinuationToken).toBeUndefined();
    expect(second.Contents?.map((object) => object.Key)).toEqual(['users/第二']);
    expect(fixture.barriers).toEqual([]);
    const reading = client.send(new GetObjectCommand({ Bucket, Key: 'users/a&b' }));
    try {
      await expect.poll(() => fixture.barriers.length).toBe(1);
      expect(fixture.barriers[0].released).toBe(false);
    } finally {
      fixture.releaseHolds();
      expect(await (await reading).Body?.transformToString()).toBe('first');
    }
    expect(fixture.objects.size).toBe(3);
    expect(fixture.deleted).toEqual([]);
  } finally {
    client.destroy();
    await fixture.close();
  }
});
