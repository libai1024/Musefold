// packages/desktop-contracts/src/ipc/index.ts
// IPC 契约分域组合出口（V13-GOV-04）。历史入口 src/ipc.ts 是本目录的 re-export barrel。

export { IPC } from "./channels";
export type {
  ListPromptsQuery,
  UpdatePromptPatch,
  PromptStats,
  PromptApi,
  SearchHistoryApi,
} from "./prompt";
export type {
  HistoryClearRequest,
  HistoryClearResult,
  RelatedHistoryQuery,
  RelatedHistoryResult,
  HistoryLinkPromptRequest,
  HistoryLinkPromptResult,
  HistoryDeleteRequest,
  HistoryDeleteResult,
  HistoryApi,
} from "./history";
export type { WorkbenchSessionApi } from "./workbench";
export type {
  AiConnectionApi,
  ProviderApi,
  ImageApi,
} from "./generation";
export type { AccountApi, CloudSyncApi, CloudConnectionsApi } from "./account";
export type {
  DiskUsageResult,
  BackupInfo,
  RestoreBackupRequest,
  RestoreBackupResult,
  ResetDataRequest,
  ResetDataResult,
  AboutResourceId,
  ExportMode,
  ExportRequest,
  ExportCounts,
  ExportEnvelope,
  ExportResult,
  ImportStrategy,
  ImportRequest,
  ImportSourceInfo,
  ImportTypeStat,
  ImportResult,
  SystemApi,
  UpdaterApi,
  LogApi,
  WindowApi,
} from "./system";
export type {
  AutomationStatus,
  AutomationAuditEntry,
  AutomationSpendAudit,
  AutomationConfirmationSummary,
  AutomationBudget,
  AutomationProviderDraft,
  AutomationSetupRequest,
  IntegrationInfo,
  IntegrationAction,
  IntegrationActionResult,
  AutomationApi,
} from "./automation";
export type {
  ShareRenderCardRequest,
  ShareRenderCardResult,
  ShareBuildDeeplinkRequest,
  ShareBuildDeeplinkResult,
  ShareParseDeeplinkRequest,
  ShareParseDeeplinkResult,
  ShareImportRequest,
  ShareImportResult,
  ShareApi,
} from "./share";
export type {
  DiagnosticsApi,
  PetApi,
  SkillRuntimeApi,
  DesignSchemeApi,
} from "./misc";
export type { IpcError, Api } from "./api";

// window.api 全局类型
import type { Api as WindowApiShape } from "./api";

declare global {
  interface Window {
    api: WindowApiShape;
  }
}
