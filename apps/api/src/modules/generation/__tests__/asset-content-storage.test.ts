import { afterEach, describe, expect, it } from 'vitest';
import { startAssetS3Fixture } from './asset-s3-fixture.js';

describe('generation asset S3 transport (real local HTTP)', () => {
  let fixture: Awaited<ReturnType<typeof startAssetS3Fixture>> | undefined;
  afterEach(async () => {
    await fixture?.close();
  });

  it('reads only the configured bucket/key without trusting the response MIME', async () => {
    fixture = await startAssetS3Fixture();
    await expect(fixture.signer.readObject('users/owner/generations/run/asset')).resolves.toEqual(
      fixture.state.bytes,
    );
    expect(fixture.requests).toEqual([
      { method: 'GET', path: '/test-generation-assets/users/owner/generations/run/asset' },
    ]);
  });

  it.each(['empty-missing', 'xml-missing'] as const)(
    'classifies %s as a static missing asset',
    async (mode) => {
      fixture = await startAssetS3Fixture();
      fixture.state.mode = mode;
      await expect(fixture.signer.readObject('private-object-key')).rejects.toMatchObject({
        code: 'GENERATION_NOT_FOUND',
        status: 404,
        message: '生成资产不存在或已清理',
      });
      expect(fixture.requests).toHaveLength(1);
    },
  );

  it.each([
    'empty-success',
    'large-header',
    'large-stream',
    'short-declared',
    'disconnect',
    'redirect',
    'forbidden',
  ] as const)(
    'rejects %s, closes the response and never retries or follows redirects',
    async (mode) => {
      fixture = await startAssetS3Fixture();
      fixture.state.mode = mode;
      await expect(fixture.signer.readObject('private-object-key')).rejects.toMatchObject({
        code: 'GENERATION_STORAGE_FAILED',
        status: 503,
        message: '生成资产暂时无法读取，请重试',
      });
      await fixture.closed;
      expect(fixture.requests).toHaveLength(1);
    },
  );

  it.each(['slow-headers', 'hold'] as const)(
    'bounds the complete %s response by one deadline',
    async (mode) => {
      fixture = await startAssetS3Fixture(200);
      fixture.state.mode = mode;
      const started = Date.now();
      await expect(fixture.signer.readObject('private-object-key')).rejects.toMatchObject({
        code: 'GENERATION_STORAGE_FAILED',
        status: 503,
      });
      await fixture.closed;
      expect(Date.now() - started).toBeLessThan(2000);
      expect(fixture.requests).toHaveLength(1);
    },
  );

  it('does not issue an S3 request for an already aborted caller', async () => {
    fixture = await startAssetS3Fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.signer.readObject('asset', controller.signal)).rejects.toMatchObject({
      status: 503,
    });
    expect(fixture.requests).toHaveLength(0);
  });

  it('cancels a partially received body when the caller disconnects', async () => {
    fixture = await startAssetS3Fixture();
    fixture.state.mode = 'hold';
    const controller = new AbortController();
    const result = fixture.signer.readObject('asset', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      code: 'GENERATION_STORAGE_FAILED',
      status: 503,
    });
    await fixture.reached;
    controller.abort();
    await rejected;
    await fixture.closed;
    expect(fixture.requests).toHaveLength(1);
  });
});
