import { expect, it } from 'vitest';
import { startS3Fixture } from '../../design-scheme-assets/__tests__/s3-fixture.js';
it('uses the package storage budget instead of silently imposing the 20MiB image limit', async () => {
  const fixture = await startS3Fixture(256 * 1024 * 1024);
  try {
    const bytes = Buffer.alloc(21 * 1024 * 1024, 1);
    await fixture.storage.put('package', bytes, 'application/octet-stream');
    const result = await fixture.storage.read('package');
    expect(result.length).toBe(bytes.length);
    expect(Buffer.compare(result, bytes)).toBe(0);
  } finally {
    fixture.storage.destroy();
    await fixture.close();
  }
});
it('still rejects an excessive storage stream under an explicit smaller test budget', async () => {
  const fixture = await startS3Fixture(1024);
  try {
    await fixture.storage.put('package', Buffer.alloc(1025), 'application/octet-stream');
    await expect(fixture.storage.read('package')).rejects.toThrow();
  } finally {
    fixture.storage.destroy();
    await fixture.close();
  }
});
