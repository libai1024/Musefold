import {
  beginDesignSchemePackageExportSchema,
  designSchemePackageExportSchema,
  opaqueIdSchema,
  designSchemePackageExportHistoryQuerySchema,
  designSchemePackageExportHistorySchema,
  designSchemePackageExportRecoverySchema,
  type DesignSchemePackageExportHistoryQuery,
  type BeginDesignSchemePackageExport,
  type DesignSchemePackageExport,
} from '@musefold/contracts';
import type { ApiHttp } from './http';

/** Host transport only. Receiving bytes is not proof that a save dialog/download completed. */
export function createCloudDesignSchemePackageExportClient(http: ApiHttp) {
  const path = (id: string) =>
    `/design-schemes/package-exports/${encodeURIComponent(opaqueIdSchema.parse(id))}`;
  return {
    recovery: {
      list: (raw: DesignSchemePackageExportHistoryQuery) =>
        http.request({
          method: 'GET',
          path: '/design-schemes/package-exports',
          query: designSchemePackageExportHistoryQuerySchema.parse(raw),
          response: designSchemePackageExportHistorySchema,
        }),
      get: (id: string) =>
        http.request({
          method: 'GET',
          path: `${path(id)}/recovery`,
          response: designSchemePackageExportRecoverySchema,
        }),
    },
    begin: (input: BeginDesignSchemePackageExport, signal?: AbortSignal) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/package-exports',
        body: beginDesignSchemePackageExportSchema.parse(input),
        response: designSchemePackageExportSchema,
        signal,
      }),
    get: (id: string) =>
      http.request({ method: 'GET', path: path(id), response: designSchemePackageExportSchema }),
    cancel: (id: string) =>
      http.request({ method: 'DELETE', path: path(id), response: designSchemePackageExportSchema }),
    async download(raw: DesignSchemePackageExport, signal?: AbortSignal) {
      const ready = designSchemePackageExportSchema.parse(raw);
      if (ready.status !== 'ready' || !ready.sizeBytes || !ready.packageHash)
        throw new Error('Export is not ready');
      const bytes = await http.downloadBytes(
        `${path(ready.exportId)}/content`,
        ready.sizeBytes,
        signal,
      );
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
      const hash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
      if (hash !== ready.packageHash.toLowerCase().replace(/^sha256:/, ''))
        throw new Error('Download hash mismatch');
      if (signal?.aborted) throw new Error('Download cancelled');
      return bytes;
    },
  };
}
