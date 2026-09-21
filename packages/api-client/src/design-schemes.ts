import {
  type CancelDesignSchemeInput,
  type ConfirmDesignSchemeInstallInput,
  type CheckDesignSchemeUpdateInput,
  type CreateDesignSchemeInput,
  type DesignSchemeListQuery,
  type DesignSchemeDetailRevisionSelector,
  type DesignSchemeRunInput,
  type PrepareDesignSchemeRunInput,
  type DesignSchemeEvent,
  designSchemeRunEventPageSchema,
  prepareDesignSchemeRunResultSchema,
  type ExportDesignSchemeInput,
  type FormalizeDesignSchemeInput,
  type ImportDesignSchemeInput,
  type MarketSearchQuery,
  type ModifyDesignSchemeInput,
  type PromoteWorkingDraftInput,
  type PrepareDesignSchemeImportPackageInput,
  type RemoveDesignSchemeInput,
  type PurgeDesignSchemeInput,
  purgeDesignSchemeResultSchema,
  type RenameDesignSchemeInput,
  type SelectCoverInput,
  type UpdateDesignSchemeInput,
  cancelDesignSchemeResultSchema,
  confirmDesignSchemeInstallResultSchema,
  checkDesignSchemeUpdateResultSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  designSchemePageSchema,
  exportDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
  importDesignSchemeResultSchema,
  marketSearchResultSchema,
  modifyDesignSchemeResultSchema,
  prepareDesignSchemeImportPackageResultSchema,
  promoteWorkingDraftResultSchema,
  removeDesignSchemeResultSchema,
  renameDesignSchemeResultSchema,
  runResultSchema,
  selectCoverResultSchema,
  updateDesignSchemeResultSchema,
} from '@musefold/contracts';
import type { DesignSchemesGateway } from '@musefold/platform';
import { createCloudDesignSchemePackageClient } from './design-scheme-packages';
import { createCloudDesignSchemeAgentClient } from './design-scheme-agent';
import { type ApiHttp, ApiRequestError } from './http';

type CloudUnavailableOperation =
  | 'searchMarket'
  | 'create'
  | 'modify'
  | 'cancel'
  | 'confirmInstall'
  | 'checkUpdate'
  | 'prepareImportPackage'
  | 'importPackage'
  | 'exportPackage'
  | 'run'
  | 'subscribeEvents';

const unavailableCodeByOperation: Record<CloudUnavailableOperation, string> = {
  searchMarket: 'DESIGN_SCHEME_CLOUD_MARKET_UNAVAILABLE',
  create: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
  modify: 'DESIGN_SCHEME_CLOUD_AGENT_MODIFY_UNAVAILABLE',
  cancel: 'DESIGN_SCHEME_CLOUD_RUN_CANCEL_UNAVAILABLE',
  confirmInstall: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
  checkUpdate: 'DESIGN_SCHEME_CLOUD_CHECK_UPDATE_UNAVAILABLE',
  prepareImportPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  importPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  exportPackage: 'DESIGN_SCHEME_CLOUD_EXPORT_STAGING_UNAVAILABLE',
  run: 'DESIGN_SCHEME_CLOUD_RUN_UNAVAILABLE',
  subscribeEvents: 'DESIGN_SCHEME_CLOUD_EVENTS_UNAVAILABLE',
};

const unavailableCodes = new Set([
  ...Object.values(unavailableCodeByOperation),
  'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
]);

export class CloudDesignSchemeUnavailableError extends Error {
  readonly status = 501;
  readonly retryable = false;
  readonly code: string;

  constructor(
    readonly operation: CloudUnavailableOperation,
    message: string,
    code: string = unavailableCodeByOperation[operation],
  ) {
    super(message);
    this.name = 'CloudDesignSchemeUnavailableError';
    this.code = code;
  }
}

function mapUnavailable<T>(operation: CloudUnavailableOperation, request: Promise<T>): Promise<T> {
  return request.catch((error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 501) {
      const nested = error.details.designSchemeError;
      const nestedCode =
        nested && typeof nested === 'object' && 'code' in nested && typeof nested.code === 'string'
          ? nested.code
          : undefined;
      const code =
        nestedCode && unavailableCodes.has(nestedCode)
          ? nestedCode
          : unavailableCodeByOperation[operation];
      throw new CloudDesignSchemeUnavailableError(operation, error.message, code);
    }
    throw error;
  });
}

/** Web adapter for the deployed Design Schemes surface and optional lifecycle seams. */
export function createCloudDesignSchemesGateway(http: ApiHttp): DesignSchemesGateway {
  const listeners = new Set<(event: DesignSchemeEvent) => void>();
  const terminal = new Set(['completed', 'blocked', 'failed', 'cancelled']);
  async function run(input: DesignSchemeRunInput) {
    let result = await mapUnavailable(
      'run',
      http.request({
        method: 'POST',
        path: '/design-schemes/run',
        body: input,
        response: runResultSchema,
      }),
    );
    let afterSeq = 0;
    while (true) {
      // The server retains events and execution identity: retrying this input resumes the same run.
      if (listeners.size) {
        while (true) {
          const page = await http.request({
            method: 'GET',
            path: `/design-schemes/runs/${result.runId}/events`,
            query: { afterSeq },
            response: designSchemeRunEventPageSchema,
          });
          for (const item of page.events) {
            for (const listener of listeners) {
              try {
                listener(item.event);
              } catch {
                // An observer cannot turn an already authorized run into a transport failure.
              }
            }
          }
          if (page.nextSeq <= afterSeq || page.events.length < 100) {
            afterSeq = page.nextSeq;
            break;
          }
          afterSeq = page.nextSeq;
        }
      }
      if (terminal.has(result.status)) return result;
      // Each cycle reads status and events through fresh account authorization.
      // This is one part of the aggregate budget; ledger polls and event refreshes are batched
      // by features. ApiHttp backs off limited reads without re-posting this execution.
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
      result = await http.request({
        method: 'GET',
        path: `/design-schemes/runs/${result.runId}`,
        response: runResultSchema,
      });
    }
  }
  return {
    agent: createCloudDesignSchemeAgentClient(http),
    packageImport: createCloudDesignSchemePackageClient(http),
    list: (query: DesignSchemeListQuery) =>
      http.request({
        method: 'GET',
        path: '/design-schemes',
        query: { ...query },
        response: designSchemePageSchema,
      }),
    get: (id: string, revision: DesignSchemeDetailRevisionSelector = { kind: 'current' }) =>
      http.request({
        method: 'GET',
        path: `/design-schemes/${id}`,
        query:
          revision.kind === 'working-draft'
            ? { revisionKind: revision.kind, revisionId: revision.revisionId }
            : {},
        response: designSchemeDetailSchema,
      }),
    searchMarket: (query: MarketSearchQuery) =>
      mapUnavailable(
        'searchMarket',
        http.request({
          method: 'GET',
          path: '/design-schemes/market',
          query: { ...query },
          retryRateLimit: false,
          response: marketSearchResultSchema,
        }),
      ),
    create: (input: CreateDesignSchemeInput) =>
      mapUnavailable(
        'create',
        http.request({
          method: 'POST',
          path: '/design-schemes',
          body: input,
          response: createDesignSchemeResultSchema,
        }),
      ),
    update: (input: UpdateDesignSchemeInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/update',
        body: input,
        response: updateDesignSchemeResultSchema,
      }),
    modify: (input: ModifyDesignSchemeInput) =>
      mapUnavailable(
        'modify',
        http.request({
          method: 'POST',
          path: '/design-schemes/modify',
          body: input,
          response: modifyDesignSchemeResultSchema,
        }),
      ),
    cancel: (input: CancelDesignSchemeInput) =>
      mapUnavailable(
        'cancel',
        http.request({
          method: 'POST',
          path: '/design-schemes/cancel',
          body: input,
          response: cancelDesignSchemeResultSchema,
        }),
      ),
    confirmInstall: (input: ConfirmDesignSchemeInstallInput) =>
      mapUnavailable(
        'confirmInstall',
        http.request({
          method: 'POST',
          path: '/design-schemes/confirm-install',
          body: input,
          response: confirmDesignSchemeInstallResultSchema,
        }),
      ),
    selectCover: (input: SelectCoverInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/select-cover',
        body: input,
        response: selectCoverResultSchema,
      }),
    formalize: (input: FormalizeDesignSchemeInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/formalize',
        body: input,
        response: formalizeDesignSchemeResultSchema,
      }),
    promoteWorkingDraft: (input: PromoteWorkingDraftInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/promote-working-draft',
        body: input,
        response: promoteWorkingDraftResultSchema,
      }),
    rename: (input: RenameDesignSchemeInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/rename',
        body: input,
        response: renameDesignSchemeResultSchema,
      }),
    remove: (input: RemoveDesignSchemeInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/remove',
        body: input,
        response: removeDesignSchemeResultSchema,
      }),
    purge: (input: PurgeDesignSchemeInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/purge',
        body: input,
        response: purgeDesignSchemeResultSchema,
      }),
    checkUpdate: (input: CheckDesignSchemeUpdateInput) =>
      mapUnavailable(
        'checkUpdate',
        http.request({
          method: 'POST',
          path: '/design-schemes/check-update',
          body: input,
          response: checkDesignSchemeUpdateResultSchema,
        }),
      ),
    prepareImportPackage: (input: PrepareDesignSchemeImportPackageInput) =>
      mapUnavailable(
        'prepareImportPackage',
        http.request({
          method: 'POST',
          path: '/design-schemes/prepare-import-package',
          body: input,
          response: prepareDesignSchemeImportPackageResultSchema,
        }),
      ),
    importPackage: (input: ImportDesignSchemeInput) =>
      mapUnavailable(
        'importPackage',
        http.request({
          method: 'POST',
          path: '/design-schemes/import-package',
          body: input,
          response: importDesignSchemeResultSchema,
        }),
      ),
    exportPackage: (input: ExportDesignSchemeInput) =>
      mapUnavailable(
        'exportPackage',
        http.request({
          method: 'POST',
          path: '/design-schemes/export-package',
          body: input,
          response: exportDesignSchemeResultSchema,
        }),
      ),
    prepareRun: (input: PrepareDesignSchemeRunInput) =>
      http.request({
        method: 'POST',
        path: '/design-schemes/prepare-run',
        body: input,
        response: prepareDesignSchemeRunResultSchema,
      }),
    run,
    subscribeEvents: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
