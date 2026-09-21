import { expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';
import { ApiHttp } from '../http';
import { createCloudDesignSchemePackageClient } from '../design-scheme-packages';
const result = {
  stagedPackageId: 'stage_1',
  requestId: 'request_1',
  packageHash: 'a'.repeat(64),
  sizeBytes: 3,
  formatVersion: 2,
  parserVersion: 1,
  status: 'awaiting_upload',
  preview: null,
  confirmationHash: null,
  expiresAt: '2026-10-01T00:00:00.000Z',
};
it('transmits exact binary bytes with credentials and abort signal, then parses the stage', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
  const client = createCloudDesignSchemePackageClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  const bytes = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
  const signal = new AbortController().signal;
  expect(await client.upload('stage_1', bytes, signal)).toEqual(result);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/design-schemes/packages/stage_1/content',
    expect.objectContaining({
      method: 'PUT',
      body: expect.any(Blob),
      signal,
      credentials: 'include',
      headers: { 'content-type': 'application/octet-stream' },
    }),
  );
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (!(body instanceof Blob)) throw new Error('Missing binary upload body');
  bytes[0] = 99;
  expect(new Uint8Array(await body.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});
it('refuses client paths and empty uploads before making a request', () => {
  const fetcher = vi.fn();
  const client = createCloudDesignSchemePackageClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  expect(() => client.get('../foreign')).toThrow();
  expect(() => client.upload('stage_1', new Uint8Array())).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects ambiguous raw plus JSON input rather than silently changing payload semantics', async () => {
  const fetcher = vi.fn();
  const http = new ApiHttp({ baseUrl: '', fetch: fetcher });
  const { designSchemePackageStageSchema } = await import('@musefold/contracts');
  await expect(
    http.request({
      method: 'PUT',
      path: '/test',
      binaryBody: new Uint8Array([1]),
      body: {},
      response: designSchemePackageStageSchema,
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('exposes the durable package workflow through the actual cloud gateway', async () => {
  const fetcher = vi.fn(async () => Response.json(result));
  const gateway = createCloudDataGateway({ baseUrl: '', fetch: fetcher });
  const packages = gateway.designSchemes?.packageImport;
  expect(packages).toBeDefined();
  await packages?.begin({
    requestId: 'request_1',
    packageHash: result.packageHash,
    sizeBytes: 3,
    formatVersion: 2,
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/design-schemes/packages',
    expect.objectContaining({ method: 'POST', credentials: 'include' }),
  );
});

it('recovers only through bounded credentialed GETs and rejects private response fields', async () => {
  const item = {
    stage: result,
    createdAt: result.expiresAt,
    execution: 'not_started',
    receipt: null,
    canContinue: true,
    blockedReason: null,
  };
  const fetcher = vi.fn(async () => Response.json({ items: [item], nextCursor: 'stage_1' }));
  const gateway = createCloudDataGateway({ baseUrl: '', fetch: fetcher });
  const recovery = gateway.designSchemes?.packageImport?.recovery;
  if (!recovery) throw new Error('Missing recovery transport');
  expect((await recovery.list({ limit: 2, cursor: 'stage_2' })).items).toEqual([item]);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/v1/design-schemes/packages?cursor=stage_2&limit=2',
    expect.objectContaining({ method: 'GET', credentials: 'include' }),
  );
  fetcher.mockImplementationOnce(async () => Response.json(item));
  expect(await recovery.get('stage_1')).toEqual(item);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/v1/design-schemes/packages/stage_1/recovery',
    expect.objectContaining({ method: 'GET', credentials: 'include' }),
  );
  fetcher.mockImplementationOnce(async () =>
    Response.json({ ...item, authorityHash: 'must-not-leak' }),
  );
  await expect(recovery.get('stage_1')).rejects.toThrow();
  expect(() => recovery.list({ limit: 51 })).toThrow();
  expect(() => recovery.get('../foreign')).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
