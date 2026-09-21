import {
  beginDesignSchemePackageUploadSchema,
  decideDesignSchemePackageStageSchema,
  designSchemePackageStageSchema,
  designSchemePackageRecoveryQuerySchema,
  designSchemePackageRecoverySchema,
  designSchemePackageRecoveryPageSchema,
  opaqueIdSchema,
  DESIGN_SCHEME_PACKAGE_LIMITS,
  type BeginDesignSchemePackageUpload,
  type DecideDesignSchemePackageStage,
} from '@musefold/contracts';
import type { DesignSchemePackageImportGateway } from '@musefold/platform';
import type { ApiHttp } from './http';

/** Web host upload transport. File picking and explicit content review belong to the shared product flow. */
export function createCloudDesignSchemePackageClient(
  http: ApiHttp,
): DesignSchemePackageImportGateway {
  const path = (id: string) =>
    `/design-schemes/packages/${encodeURIComponent(opaqueIdSchema.parse(id))}`;
  return {
    recovery: {
      list: (query) =>
        http.request({
          method: 'GET',
          path: '/design-schemes/packages',
          query: designSchemePackageRecoveryQuerySchema.parse(query),
          response: designSchemePackageRecoveryPageSchema,
        }),
      get: (id) =>
        http.request({
          method: 'GET',
          path: `${path(id)}/recovery`,
          response: designSchemePackageRecoverySchema,
        }),
    },
    begin: (input: BeginDesignSchemePackageUpload) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/packages',
        body: beginDesignSchemePackageUploadSchema.parse(input),
        response: designSchemePackageStageSchema,
      }),
    get: (id: string) =>
      http.request({ method: 'GET', path: path(id), response: designSchemePackageStageSchema }),
    upload: (id: string, bytes: Uint8Array, signal?: AbortSignal) => {
      if (!bytes.byteLength || bytes.byteLength > DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes)
        throw new Error('Invalid package size');
      return http.request({
        method: 'PUT',
        path: `${path(id)}/content`,
        binaryBody: bytes,
        signal,
        response: designSchemePackageStageSchema,
      });
    },
    decide: (id: string, input: DecideDesignSchemePackageStage) =>
      http.request({
        method: 'POST',
        path: `${path(id)}/decision`,
        body: decideDesignSchemePackageStageSchema.parse(input),
        response: designSchemePackageStageSchema,
      }),
    cancel: (id: string) =>
      http.request({ method: 'DELETE', path: path(id), response: designSchemePackageStageSchema }),
  };
}
