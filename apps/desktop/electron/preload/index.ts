// electron/preload/index.ts
// contextBridge 暴露 window.api —— 类型来自 @musefold/desktop-contracts/ipc
// 只做转发，无业务逻辑。详见 docs/01-architecture.md §2、docs/07-ipc-contracts.md §4

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type { DiagnosticReport } from "@musefold/desktop-contracts/diagnostics";
import type { AccountErrorPayload } from "@musefold/desktop-contracts/account";
import {
  runPreloadOriginMigration,
  type LocalStorageLike,
} from "../main/prefs-origin-migration-logic";

try {
  const storage = (globalThis as unknown as { localStorage?: LocalStorageLike })
    .localStorage;
  runPreloadOriginMigration({
    argv: process.argv,
    sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
    storage,
  });
} catch {
  // Preload must never throw: an exception here makes the whole app unusable.
}

// 诊断弹窗只接收主进程主动推送的未捕获异常。
// invoke 的拒绝会原样抛给调用方：已处理的错误由调用方呈现（toast/行内），
// 未处理的会落到 window 的 unhandledrejection 全局兜底，不在这里重复上报。
function onDiagnosticError(cb: (report: DiagnosticReport) => void): () => void {
  const listener = (_event: unknown, report: DiagnosticReport) => cb(report);
  ipcRenderer.on(IPC.DIAGNOSTICS_ERROR, listener);
  return () => {
    ipcRenderer.removeListener(IPC.DIAGNOSTICS_ERROR, listener);
  };
}

const ACCOUNT_ERROR_PREFIX = "ACCOUNT_ERR::";

/** Electron invoke 只保留 Error.message；把主进程结构化前缀还原成渲染层可判定的 code/stage。 */
async function invokeAccount<T>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const index = raw.indexOf(ACCOUNT_ERROR_PREFIX);
    if (index !== -1) {
      try {
        const payload = JSON.parse(
          raw.slice(index + ACCOUNT_ERROR_PREFIX.length),
        ) as AccountErrorPayload;
        const restored = new Error(payload.message) as Error &
          AccountErrorPayload;
        restored.code = payload.code;
        restored.stage = payload.stage;
        throw restored;
      } catch (parsed) {
        if (parsed instanceof Error && "code" in parsed) throw parsed;
      }
    }
    throw error;
  }
}

const api = {
  diagnostics: {
    onError: onDiagnosticError,
  },
  prompt: {
    list: (
      q?: Parameters<import("@musefold/desktop-contracts/ipc").Api["prompt"]["list"]>[0],
    ) => ipcRenderer.invoke(IPC.PROMPTS_LIST, q),
    get: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_GET, id),
    create: (p: import("@musefold/desktop-contracts/models").NewPrompt) =>
      ipcRenderer.invoke(IPC.PROMPTS_CREATE, p),
    update: (
      id: string,
      patch: import("@musefold/desktop-contracts/ipc").UpdatePromptPatch,
    ) => ipcRenderer.invoke(IPC.PROMPTS_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_DELETE, id),
    batchAddTags: (ids: string[], tagIds: string[]) =>
      ipcRenderer.invoke(IPC.PROMPTS_BATCH_ADD_TAGS, ids, tagIds),
    batchMove: (ids: string[], folderId: string | null) =>
      ipcRenderer.invoke(IPC.PROMPTS_BATCH_MOVE, ids, folderId),
    batchSetPin: (ids: string[], pinned: boolean) =>
      ipcRenderer.invoke(IPC.PROMPTS_BATCH_SET_PIN, ids, pinned),
    batchDelete: (ids: string[]) =>
      ipcRenderer.invoke(IPC.PROMPTS_BATCH_DELETE, ids),
    togglePin: (id: string, pinned: boolean) =>
      ipcRenderer.invoke(IPC.PROMPTS_TOGGLE_PIN, id, pinned),
    reorderPins: (ids: string[]) =>
      ipcRenderer.invoke(IPC.PROMPTS_REORDER_PINS, ids),
    incrementUsage: (
      id: string,
      action?: 'copy' | 'apply' | 'generate',
    ) => ipcRenderer.invoke(IPC.PROMPTS_INCREMENT_USAGE, id, action),
    listDeleted: () => ipcRenderer.invoke(IPC.PROMPTS_LIST_DELETED),
    restore: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_RESTORE, id),
    purge: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_PURGE, id),
    purgeAll: () => ipcRenderer.invoke(IPC.PROMPTS_PURGE_ALL),
    stats: () => ipcRenderer.invoke(IPC.PROMPTS_STATS),
  },
  smartSet: {
    list: () => ipcRenderer.invoke(IPC.SMART_SETS_LIST),
    create: (s: import("@musefold/desktop-contracts/models").NewSmartSet) =>
      ipcRenderer.invoke(IPC.SMART_SETS_CREATE, s),
    update: (
      id: string,
      patch: import("@musefold/desktop-contracts/ipc").UpdateSmartSetPatch,
    ) => ipcRenderer.invoke(IPC.SMART_SETS_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.SMART_SETS_DELETE, id),
  },
  searchHistory: {
    list: (limit?: number) =>
      ipcRenderer.invoke(IPC.SEARCH_HISTORY_LIST, limit),
    add: (term: string) => ipcRenderer.invoke(IPC.SEARCH_HISTORY_ADD, term),
    clear: () => ipcRenderer.invoke(IPC.SEARCH_HISTORY_CLEAR),
  },
  folder: {
    list: (parentId?: string) => ipcRenderer.invoke(IPC.FOLDERS_LIST, parentId),
    create: (f: import("@musefold/desktop-contracts/models").NewFolder) =>
      ipcRenderer.invoke(IPC.FOLDERS_CREATE, f),
    update: (id: string, patch: import("@musefold/desktop-contracts/models").Folder) =>
      ipcRenderer.invoke(IPC.FOLDERS_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.FOLDERS_DELETE, id),
    reorder: (ids: string[]) => ipcRenderer.invoke(IPC.FOLDERS_REORDER, ids),
  },
  tag: {
    list: (group?: import("@musefold/desktop-contracts/models").Tag["tagGroup"]) =>
      ipcRenderer.invoke(IPC.TAGS_LIST, group),
    create: (t: import("@musefold/desktop-contracts/models").NewTag) =>
      ipcRenderer.invoke(IPC.TAGS_CREATE, t),
    update: (id: string, patch: import("@musefold/desktop-contracts/models").Tag) =>
      ipcRenderer.invoke(IPC.TAGS_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.TAGS_DELETE, id),
    assignToPrompt: (promptId: string, tagIds: string[]) =>
      ipcRenderer.invoke(IPC.TAGS_ASSIGN, promptId, tagIds),
  },
  skillRuntime: {
    prepareGithub: (
      request: import("@musefold/desktop-contracts/skill-runtime").PrepareGithubSkillRuntimeRequest,
    ) => ipcRenderer.invoke(IPC.SKILL_RUNTIME_PREPARE_GITHUB, request),
    execute: (
      request: import("@musefold/desktop-contracts/skill-runtime").ExecuteSkillRuntimeRequest,
    ) => ipcRenderer.invoke(IPC.SKILL_RUNTIME_EXECUTE, request),
    cancel: (executionId: string) =>
      ipcRenderer.invoke(IPC.SKILL_RUNTIME_CANCEL, executionId),
    release: (runtimeId: string) =>
      ipcRenderer.invoke(IPC.SKILL_RUNTIME_RELEASE, runtimeId),
    onEvent: (
      cb: (
        event: import("@musefold/desktop-contracts/skill-runtime").SkillRuntimeEvent,
      ) => void,
    ) => {
      const listener = (
        _event: unknown,
        payload: import("@musefold/desktop-contracts/skill-runtime").SkillRuntimeEvent,
      ) => cb(payload);
      ipcRenderer.on(IPC.SKILL_RUNTIME_EVENT, listener);
      return () =>
        ipcRenderer.removeListener(IPC.SKILL_RUNTIME_EVENT, listener);
    },
  },
  designScheme: {
    startCreation: (
      request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeCreationRequest,
    ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_CREATE_START, request),
    confirmInstall: (executionId: string, accept: boolean) =>
      ipcRenderer.invoke(
        IPC.DESIGN_SCHEME_CREATE_CONFIRM_INSTALL,
        executionId,
        accept,
      ),
    cancelCreation: (executionId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_CREATE_CANCEL, executionId),
    list: () => ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST),
    getRevision: (revisionId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_GET_REVISION, revisionId),
    listAssets: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST_ASSETS, schemeId),
    updateInputs: (
      schemeId: string,
      baseRevisionId: string,
      inputs: Array<{ id: string; required: boolean }>,
    ) =>
      ipcRenderer.invoke(
        IPC.DESIGN_SCHEME_UPDATE_INPUTS,
        schemeId,
        baseRevisionId,
        inputs,
      ),
    startRun: (
      request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeRunRequest,
    ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_RUN_START, request),
    cancelRun: (executionId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_RUN_CANCEL, executionId),
    selectCover: (schemeId: string, assetId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_SELECT_COVER, schemeId, assetId),
    formalize: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_FORMALIZE, schemeId),
    rename: (schemeId: string, name: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_RENAME, schemeId, name),
    remove: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_REMOVE, schemeId),
    listSourceFiles: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST_SOURCE_FILES, schemeId),
    startModify: (
      request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeModifyRequest,
    ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_MODIFY_START, request),
    cancelModify: (executionId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_MODIFY_CANCEL, executionId),
    promoteWorkingDraft: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_PROMOTE_DRAFT, schemeId),
    checkUpdate: (schemeId: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_CHECK_UPDATE, schemeId),
    marketSearch: (query: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_MARKET_SEARCH, query),
    exportScheme: (schemeId: string, targetPath?: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_EXPORT, schemeId, targetPath),
    importScheme: (sourcePath?: string) =>
      ipcRenderer.invoke(IPC.DESIGN_SCHEME_IMPORT, sourcePath),
    onEvent: (
      cb: (
        event: import("@musefold/desktop-contracts/design-scheme").DesignSchemeCreationEvent,
      ) => void,
    ) => {
      const listener = (
        _event: unknown,
        payload: import("@musefold/desktop-contracts/design-scheme").DesignSchemeCreationEvent,
      ) => cb(payload);
      ipcRenderer.on(IPC.DESIGN_SCHEME_EVENT, listener);
      return () =>
        ipcRenderer.removeListener(IPC.DESIGN_SCHEME_EVENT, listener);
    },
  },
  aiConnection: {
    listPresets: () => ipcRenderer.invoke(IPC.AI_CONNECTION_LIST_PRESETS),
    list: () => ipcRenderer.invoke(IPC.AI_CONNECTION_LIST),
    create: (input: import("@musefold/desktop-contracts/ai").CreateAiConnectionInput) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_CREATE, input),
    update: (
      id: string,
      patch: import("@musefold/desktop-contracts/ai").UpdateAiConnectionInput,
    ) => ipcRenderer.invoke(IPC.AI_CONNECTION_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_DELETE, id),
    saveKey: (id: string, apiKey: string) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_SAVE_KEY, id, apiKey),
    deleteKey: (id: string) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_DELETE_KEY, id),
    hasKey: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_HAS_KEY, id),
    setActive: (id: string) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_SET_ACTIVE, id),
    listModels: (id: string) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_LIST_MODELS, id),
    validate: (id: string) =>
      ipcRenderer.invoke(IPC.AI_CONNECTION_VALIDATE, id),
  },
  provider: {
    list: () => ipcRenderer.invoke(IPC.PROVIDER_LIST),
    create: (p: import("@musefold/desktop-contracts/models").NewProviderConfig) =>
      ipcRenderer.invoke(IPC.PROVIDER_CREATE, p),
    update: (
      id: string,
      patch: Partial<import("@musefold/desktop-contracts/models").NewProviderConfig>,
    ) => ipcRenderer.invoke(IPC.PROVIDER_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_DELETE, id),
    saveKey: (id: string, apiKey: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_SAVE_KEY, id, apiKey),
    hasKey: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_HAS_KEY, id),
    openWebLogin: () => ipcRenderer.invoke(IPC.PROVIDER_OPEN_WEB_LOGIN),
    webLoginStart: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_START),
    webLoginRefresh: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_REFRESH),
    webLogout: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGOUT),
    webLoginState: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_STATE),
    setWebDeveloperVisible: (visible: boolean) =>
      ipcRenderer.invoke(IPC.PROVIDER_WEB_DEVELOPER_VISIBLE, visible),
    onWebLoginChanged: (
      cb: (
        status: import("@musefold/desktop-contracts/providers").DoubaoWebAccountStatus,
      ) => void,
    ) => {
      const listener = (
        _event: unknown,
        status: import("@musefold/desktop-contracts/providers").DoubaoWebAccountStatus,
      ) => cb(status);
      ipcRenderer.on(IPC.PROVIDER_WEB_LOGIN_CHANGED, listener);
      return () =>
        ipcRenderer.removeListener(IPC.PROVIDER_WEB_LOGIN_CHANGED, listener);
    },
    webUsage: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_USAGE),
    webStatus: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_STATUS),
    validate: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_VALIDATE, id),
    listModels: (id: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_LIST_MODELS, id),
    setActive: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_SET_ACTIVE, id),
  },
  settings: {
    pricing: {
      get: (providerId: string) =>
        ipcRenderer.invoke(IPC.SETTINGS_PRICING_GET, providerId),
      set: (req: import("@musefold/desktop-contracts/models").ProviderPricingSetRequest) =>
        ipcRenderer.invoke(IPC.SETTINGS_PRICING_SET, req),
      delete: (providerId: string) =>
        ipcRenderer.invoke(IPC.SETTINGS_PRICING_DELETE, providerId),
    },
  },
  automation: {
    status: () => ipcRenderer.invoke(IPC.AUTOMATION_STATUS),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.AUTOMATION_SET_ENABLED, enabled),
    rotateToken: () => ipcRenderer.invoke(IPC.AUTOMATION_ROTATE_TOKEN),
    auditList: (limit?: number) =>
      ipcRenderer.invoke(IPC.AUTOMATION_AUDIT_LIST, limit),
    confirm: (confirmationId: string, approved: boolean) =>
      ipcRenderer.invoke(IPC.AUTOMATION_CONFIRM, confirmationId, approved),
    budget: {
      get: () => ipcRenderer.invoke(IPC.AUTOMATION_BUDGET_GET),
      set: (monthlyLimitPoints: number) =>
        ipcRenderer.invoke(IPC.AUTOMATION_BUDGET_SET, monthlyLimitPoints),
    },
    onConfirmationRequired: (
      cb: (
        summary: import("@musefold/desktop-contracts/ipc").AutomationConfirmationSummary,
      ) => void,
    ) => {
      const listener = (
        _event: unknown,
        summary: import("@musefold/desktop-contracts/ipc").AutomationConfirmationSummary,
      ) => cb(summary);
      ipcRenderer.on(IPC.AUTOMATION_CONFIRMATION_REQUIRED, listener);
      return () =>
        ipcRenderer.removeListener(
          IPC.AUTOMATION_CONFIRMATION_REQUIRED,
          listener,
        );
    },
    onConfirmationResolved: (
      cb: (payload: {
        confirmationId: string;
        outcome: "approved" | "denied" | "timeout";
      }) => void,
    ) => {
      const listener = (
        _event: unknown,
        payload: {
          confirmationId: string;
          outcome: "approved" | "denied" | "timeout";
        },
      ) => cb(payload);
      ipcRenderer.on(IPC.AUTOMATION_CONFIRMATION_RESOLVED, listener);
      return () =>
        ipcRenderer.removeListener(
          IPC.AUTOMATION_CONFIRMATION_RESOLVED,
          listener,
        );
    },
    onActivity: (
      cb: (payload: { jobId: string; running: boolean }) => void,
    ) => {
      const listener = (
        _event: unknown,
        payload: { jobId: string; running: boolean },
      ) => cb(payload);
      ipcRenderer.on(IPC.AUTOMATION_ACTIVITY, listener);
      return () =>
        ipcRenderer.removeListener(IPC.AUTOMATION_ACTIVITY, listener);
    },
    onSetupRequested: (
      cb: (request: import("@musefold/desktop-contracts/ipc").AutomationSetupRequest) => void,
    ) => {
      const listener = (
        _event: unknown,
        request: import("@musefold/desktop-contracts/ipc").AutomationSetupRequest,
      ) => cb(request);
      ipcRenderer.on(IPC.AUTOMATION_SETUP_REQUESTED, listener);
      return () =>
        ipcRenderer.removeListener(IPC.AUTOMATION_SETUP_REQUESTED, listener);
    },
    onProviderChanged: (cb: (payload: { providerId: string }) => void) => {
      const listener = (_event: unknown, payload: { providerId: string }) =>
        cb(payload);
      ipcRenderer.on(IPC.AUTOMATION_PROVIDER_CHANGED, listener);
      return () =>
        ipcRenderer.removeListener(IPC.AUTOMATION_PROVIDER_CHANGED, listener);
    },
    integrationInfo: () => ipcRenderer.invoke(IPC.AUTOMATION_INTEGRATION_INFO),
    integrationAction: (
      action: import("@musefold/desktop-contracts/ipc").IntegrationAction,
    ) => ipcRenderer.invoke(IPC.AUTOMATION_INTEGRATION_ACTION, action),
  },
  account: {
    status: () =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_STATUS,
      ),
    register: (
      input: import("@musefold/desktop-contracts/account").AccountCredentialsInput,
    ) =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_REGISTER,
        input,
      ),
    login: (input: import("@musefold/desktop-contracts/account").AccountCredentialsInput) =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_LOGIN,
        input,
      ),
    logout: () =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_LOGOUT,
      ),
    redeem: (code: string) =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountRedeemResult>(
        IPC.ACCOUNT_REDEEM,
        code,
      ),
    refreshQuota: () =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_REFRESH_QUOTA,
      ),
    setServerUrl: (url: string) =>
      invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
        IPC.ACCOUNT_SET_SERVER_URL,
        url,
      ),
    onChanged: (
      cb: (status: import("@musefold/desktop-contracts/account").AccountStatus) => void,
    ) => {
      const listener = (
        _event: unknown,
        status: import("@musefold/desktop-contracts/account").AccountStatus,
      ) => cb(status);
      ipcRenderer.on(IPC.ACCOUNT_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.ACCOUNT_CHANGED, listener);
    },
  },
  cloudSync: {
    status: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_STATUS),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.CLOUD_SYNC_SET_ENABLED, enabled),
    syncNow: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_NOW),
    conflicts: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_CONFLICTS),
    resolve: (
      conflictId: string,
      resolution: import("@musefold/desktop-contracts/cloud-sync").CloudSyncConflictResolution,
    ) => ipcRenderer.invoke(IPC.CLOUD_SYNC_RESOLVE, conflictId, resolution),
    onChanged: (
      cb: (status: import("@musefold/desktop-contracts/cloud-sync").CloudSyncSummary) => void,
    ) => {
      const listener = (
        _event: unknown,
        status: import("@musefold/desktop-contracts/cloud-sync").CloudSyncSummary,
      ) => cb(status);
      ipcRenderer.on(IPC.CLOUD_SYNC_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.CLOUD_SYNC_CHANGED, listener);
    },
  },
  cloudConnections: {
    list: () => ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_LIST),
    update: (
      id: string,
      input: import("@musefold/contracts").UpdateMcpConnection,
    ) => ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_UPDATE, id, input),
    revoke: (id: string) =>
      ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_REVOKE, id),
  },
  image: {
    pickLocal: () => ipcRenderer.invoke(IPC.IMAGE_PICK_LOCAL),
    stageLocal: (
      input: import("@musefold/desktop-contracts/providers").StageLocalImageInput,
    ) => ipcRenderer.invoke(IPC.IMAGE_STAGE_LOCAL, input),
    generate: (req: import("@musefold/desktop-contracts/providers").GenerateImageRequest) =>
      ipcRenderer.invoke(IPC.IMAGE_GENERATE, req),
    cancel: (jobId: string) => ipcRenderer.invoke(IPC.IMAGE_CANCEL, jobId),
    retry: (historyId: string, jobId?: string) =>
      ipcRenderer.invoke(IPC.IMAGE_RETRY, historyId, jobId),
    onProgress: (
      cb: (
        progress: import("@musefold/desktop-contracts/providers").ImageGenerationProgress,
      ) => void,
    ) => {
      const listener = (
        _event: unknown,
        progress: import("@musefold/desktop-contracts/providers").ImageGenerationProgress,
      ) => cb(progress);
      ipcRenderer.on(IPC.IMAGE_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC.IMAGE_PROGRESS, listener);
    },
  },
  workbenchSession: {
    ensure: (
      command: import("@musefold/desktop-contracts/workbench").EnsureWorkbenchSessionCommand,
    ) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_ENSURE, command),
    list: (
      query?: import("@musefold/desktop-contracts/workbench").WorkbenchSessionListQuery,
    ) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_LIST, query),
    get: (id: string) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_GET, id),
    rename: (id: string, title: string) =>
      ipcRenderer.invoke(IPC.WORKBENCH_SESSION_RENAME, id, title),
    archive: (id: string, archived = true) =>
      ipcRenderer.invoke(IPC.WORKBENCH_SESSION_ARCHIVE, id, archived),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.WORKBENCH_SESSION_DELETE, id),
  },
  history: {
    list: (q?: {
      status?: string;
      providerId?: string;
      from?: number;
      to?: number;
      limit?: number;
      offset?: number;
    }) => ipcRenderer.invoke(IPC.HISTORY_LIST, q),
    related: (q: import("@musefold/desktop-contracts/ipc").RelatedHistoryQuery) =>
      ipcRenderer.invoke(IPC.HISTORY_RELATED, q),
    linkPrompt: (req: import("@musefold/desktop-contracts/ipc").HistoryLinkPromptRequest) =>
      ipcRenderer.invoke(IPC.HISTORY_LINK_PROMPT, req),
    get: (id: string) => ipcRenderer.invoke(IPC.HISTORY_GET, id),
    delete: (req: string | import("@musefold/desktop-contracts/ipc").HistoryDeleteRequest) =>
      ipcRenderer.invoke(IPC.HISTORY_DELETE, req),
    clear: (req?: number | import("@musefold/desktop-contracts/ipc").HistoryClearRequest) =>
      ipcRenderer.invoke(IPC.HISTORY_CLEAR, req),
    stats: (q: import("@musefold/desktop-contracts/models").HistoryStatsQuery) =>
      ipcRenderer.invoke(IPC.HISTORY_STATS, q),
  },
  share: {
    renderCard: (req: import("@musefold/desktop-contracts/ipc").ShareRenderCardRequest) =>
      ipcRenderer.invoke(IPC.SHARE_RENDER_CARD, req),
    buildDeeplink: (
      req: import("@musefold/desktop-contracts/ipc").ShareBuildDeeplinkRequest,
    ) => ipcRenderer.invoke(IPC.SHARE_BUILD_DEEPLINK, req),
    parseDeeplink: (
      req: import("@musefold/desktop-contracts/ipc").ShareParseDeeplinkRequest,
    ) => ipcRenderer.invoke(IPC.SHARE_PARSE_DEEPLINK, req),
    import: (req: import("@musefold/desktop-contracts/ipc").ShareImportRequest) =>
      ipcRenderer.invoke(IPC.SHARE_IMPORT, req),
    consumePending: () => ipcRenderer.invoke(IPC.SHARE_CONSUME_PENDING),
    onIncoming: (
      cb: (payload: import("@musefold/desktop-contracts/share").SharePayload) => void,
    ) => {
      const listener = (
        _event: unknown,
        payload: import("@musefold/desktop-contracts/share").SharePayload,
      ) => cb(payload);
      ipcRenderer.on(IPC.SHARE_INCOMING, listener);
      return () => ipcRenderer.removeListener(IPC.SHARE_INCOMING, listener);
    },
  },
  system: {
    getPaths: () => ipcRenderer.invoke(IPC.SYSTEM_GET_PATHS),
    getVersion: () => ipcRenderer.invoke(IPC.SYSTEM_GET_VERSION),
    openAboutResource: (
      resource: import("@musefold/desktop-contracts/ipc").AboutResourceId,
    ) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_ABOUT_RESOURCE, resource),
    openInFolder: (path: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_IN_FOLDER, path),
    saveImage: (sourcePath: string, targetPath?: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_IMAGE, sourcePath, targetPath),
    saveImages: (sourcePaths: string[], targetDirectory?: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_SAVE_IMAGES, sourcePaths, targetDirectory),
    copyImage: (sourcePath: string) =>
      ipcRenderer.invoke(IPC.SYSTEM_COPY_IMAGE, sourcePath),
    readClipboardText: () => ipcRenderer.invoke(IPC.SYSTEM_READ_CLIPBOARD_TEXT),
    readClipboardImage: () =>
      ipcRenderer.invoke(IPC.SYSTEM_READ_CLIPBOARD_IMAGE),
    diskUsage: () => ipcRenderer.invoke(IPC.SYSTEM_DISK_USAGE),
    export: (req?: import("@musefold/desktop-contracts/ipc").ExportRequest) =>
      ipcRenderer.invoke(IPC.SYSTEM_EXPORT, req ?? {}),
    import: (req?: import("@musefold/desktop-contracts/ipc").ImportRequest) =>
      ipcRenderer.invoke(IPC.SYSTEM_IMPORT, req ?? {}),
    listBackups: () => ipcRenderer.invoke(IPC.SYSTEM_LIST_BACKUPS),
    backupNow: () => ipcRenderer.invoke(IPC.SYSTEM_BACKUP_NOW),
    restoreBackup: (req: import("@musefold/desktop-contracts/ipc").RestoreBackupRequest) =>
      ipcRenderer.invoke(IPC.SYSTEM_RESTORE_BACKUP, req),
    relaunch: () => ipcRenderer.invoke(IPC.SYSTEM_RELAUNCH),
    resetData: (req: import("@musefold/desktop-contracts/ipc").ResetDataRequest) =>
      ipcRenderer.invoke(IPC.SYSTEM_RESET_DATA, req),
  },
  updater: {
    getState: () => ipcRenderer.invoke(IPC.UPDATER_GET_STATE),
    check: () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
    getChannel: () => ipcRenderer.invoke(IPC.UPDATER_GET_CHANNEL),
    setChannel: (channel: import("@musefold/desktop-contracts/updater").Channel) =>
      ipcRenderer.invoke(IPC.UPDATER_SET_CHANNEL, channel),
    onStateChanged: (
      cb: (status: import("@musefold/desktop-contracts/updater").UpdateStatus) => void,
    ) => {
      const listener = (
        _e: unknown,
        status: import("@musefold/desktop-contracts/updater").UpdateStatus,
      ) => cb(status);
      ipcRenderer.on(IPC.UPDATER_STATE_CHANGED, listener);
      return () =>
        ipcRenderer.removeListener(IPC.UPDATER_STATE_CHANGED, listener);
    },
    notifyContentReady: () => ipcRenderer.send(IPC.UPDATER_CONTENT_READY),
    getContentState: () => ipcRenderer.invoke(IPC.UPDATER_GET_CONTENT_STATE),
    checkContentNow: () => ipcRenderer.invoke(IPC.UPDATER_CHECK_CONTENT_NOW),
  },
  log: {
    tail: (maxLines?: number) => ipcRenderer.invoke(IPC.LOG_TAIL, maxLines),
    openDir: () => ipcRenderer.invoke(IPC.LOG_OPEN_DIR),
  },
  pet: {
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.PET_SET_ENABLED, enabled),
    isEnabled: () => ipcRenderer.invoke(IPC.PET_IS_ENABLED),
    getFrame: () => ipcRenderer.invoke(IPC.PET_GET_FRAME),
    ready: () => ipcRenderer.send(IPC.PET_READY),
    onFrame: (cb: (frame: import("@musefold/desktop-contracts/pet").PetFrame) => void) => {
      const listener = (
        _e: unknown,
        frame: import("@musefold/desktop-contracts/pet").PetFrame,
      ) => cb(frame);
      ipcRenderer.on(IPC.PET_FRAME, listener);
      return () => ipcRenderer.removeListener(IPC.PET_FRAME, listener);
    },
    interact: (interaction: import("@musefold/desktop-contracts/pet").PetInteraction) =>
      ipcRenderer.send(IPC.PET_INTERACT, interaction),
    moveBy: (dx: number, dy: number) =>
      ipcRenderer.send(IPC.PET_MOVE_BY, dx, dy),
    runToComposer: (anchor: import("@musefold/desktop-contracts/pet").PetComposerAnchor) =>
      ipcRenderer.invoke(IPC.PET_RUN_TO_COMPOSER, anchor),
    returnHome: () => ipcRenderer.invoke(IPC.PET_RETURN_HOME),
    openMenu: () => ipcRenderer.send(IPC.PET_MENU),
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () =>
      ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
    platform: () =>
      ipcRenderer.invoke("window:platform") as Promise<NodeJS.Platform>,
    onMaximizeChange: (cb: (isMax: boolean) => void) => {
      const listener = (_e: unknown, isMax: boolean) => cb(isMax);
      ipcRenderer.on("window:maximizeChanged", listener);
      return () =>
        ipcRenderer.removeListener("window:maximizeChanged", listener);
    },
    onFullscreenChange: (cb: (isFs: boolean) => void) => {
      const listener = (_e: unknown, isFs: boolean) => cb(isFs);
      ipcRenderer.on("window:fullscreenChanged", listener);
      return () =>
        ipcRenderer.removeListener("window:fullscreenChanged", listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
