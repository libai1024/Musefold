import { afterEach, describe, expect, it } from 'vitest';
import { startS3Fixture } from './s3-fixture.js';

describe('scheme S3 storage transport', () => {
  let fixture: Awaited<ReturnType<typeof startS3Fixture>> | undefined;
  afterEach(async () => {
    await fixture?.close();
  });
  it('PUTs actual bytes and reads them through the configured bucket using the AWS SDK', async () => {
    fixture = await startS3Fixture();
    const bytes = Buffer.from('actual-transport-bytes');
    await fixture.storage.put('users/owner/design-scheme-uploads/ref', bytes, 'image/png');
    await expect(fixture.storage.read('users/owner/design-scheme-uploads/ref')).resolves.toEqual(
      bytes,
    );
    expect(fixture.writes).toEqual([
      {
        path: '/test-scheme-assets/users/owner/design-scheme-uploads/ref',
        contentType: 'image/png',
      },
    ]);
  });
  it('fails missing and oversized objects without returning an unbounded body', async () => {
    fixture = await startS3Fixture();
    await expect(fixture.storage.read('missing')).rejects.toThrow();
    await fixture.storage.put('image', new Uint8Array([1]), 'image/png');
    fixture.state.oversizedGet = true;
    await expect(fixture.storage.read('image')).rejects.toThrow('Invalid stored image size');
    fixture.state.oversizedGet = false;
    fixture.state.oversizedStream = true;
    await expect(fixture.storage.read('image')).rejects.toThrow('Stored image exceeds limit');
  });
});
