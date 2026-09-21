import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiHttp, ApiRequestError } from '../http';
import { createCloudDesignSchemePackageExportClient } from '../design-scheme-package-exports';
const payload = new TextEncoder().encode('complete package bytes');
const ready = {
  exportId: 'export',
  requestId: 'request',
  schemeId: 'scheme',
  revisionId: 'revision',
  formatVersion: 2 as const,
  status: 'ready' as const,
  packageHash: createHash('sha256').update(payload).digest('hex'),
  sizeBytes: payload.length,
  expiresAt: '2026-09-09T10:00:00.000Z',
};
const body = (value = payload, headers: Record<string, string> = {}) =>
  new Response(value, { headers: { 'content-type': 'application/octet-stream', ...headers } });
describe('cloud package export transport', () => {
  it('verifies full bytes/hash and uses same API credentials without following redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(body());
    const client = createCloudDesignSchemePackageExportClient(
      new ApiHttp({ baseUrl: 'https://api.example.test', fetch }),
    );
    expect(await client.download(ready)).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/design-schemes/package-exports/export/content',
      expect.objectContaining({ credentials: 'include', redirect: 'error' }),
    );
  });
  it.each(['truncated', 'oversized', 'length', 'mime', 'hash'] as const)(
    'rejects %s download without a success result',
    async (mode) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          mode === 'truncated'
            ? body(payload.slice(1))
            : mode === 'oversized'
              ? body(new Uint8Array(payload.length + 1))
              : mode === 'length'
                ? body(payload, { 'content-length': '1' })
                : mode === 'mime'
                  ? body(payload, { 'content-type': 'text/html' })
                  : body(new Uint8Array(payload.length)),
        );
      await expect(
        createCloudDesignSchemePackageExportClient(new ApiHttp({ baseUrl: '', fetch })).download(
          ready,
        ),
      ).rejects.toThrow();
    },
  );
  it('preserves structured authorization errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'AUTH_REQUIRED',
            message: 'login',
            retryable: false,
            requestId: 'fixture',
          },
        }),
        { status: 401 },
      ),
    );
    await expect(
      createCloudDesignSchemePackageExportClient(new ApiHttp({ baseUrl: '', fetch })).download(
        ready,
      ),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
  it('rejects cancellation and non-ready DTO before returning bytes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(body());
    const client = createCloudDesignSchemePackageExportClient(new ApiHttp({ baseUrl: '', fetch }));
    await expect(client.download({ ...ready, status: 'preparing' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const signal = AbortSignal.abort();
    await expect(client.download(ready, signal)).rejects.toThrow();
  });
  it('routes begin/get/cancel through schema-validated metadata without claiming delivery', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json(ready));
    const client = createCloudDesignSchemePackageExportClient(new ApiHttp({ baseUrl: '', fetch }));
    expect(
      await client.begin({
        requestId: 'request',
        schemeId: 'scheme',
        revisionId: 'revision',
        expectedVersion: 1,
        formatVersion: 2,
      }),
    ).toEqual(ready);
    await client.get('export');
    await client.cancel('export');
    expect(fetch.mock.calls.map((c) => c[1]?.method)).toEqual(['POST', 'GET', 'DELETE']);
  });
});

it('discovers and rechecks original exports using bounded credentialed GETs only', async () => {
  const record = {
    export: ready,
    expectedVersion: 4,
    createdAt: '2026-09-09T00:00:00.000Z',
    schemeName: '方案',
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ items: [record], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ ...record, canDownload: true, blockedReason: null }))
    .mockResolvedValueOnce(
      Response.json({ ...record, canDownload: true, blockedReason: null, objectKey: 'private' }),
    );
  const client = createCloudDesignSchemePackageExportClient(new ApiHttp({ baseUrl: '', fetch }));
  expect((await client.recovery.list({ limit: 20 })).items[0].export.exportId).toBe('export');
  expect((await client.recovery.get('export')).canDownload).toBe(true);
  await expect(client.recovery.get('export')).rejects.toThrow();
  expect(fetch.mock.calls.map((c) => c[1]?.method)).toEqual(['GET', 'GET', 'GET']);
  expect(fetch.mock.calls.every((c) => c[1]?.credentials === 'include')).toBe(true);
  expect(String(fetch.mock.calls[0][0])).toContain('package-exports?limit=20');
});
