// packages/desktop-contracts/src/ipc/api.ts
// Api 聚合接口（V13-GOV-04：按域拆分后的组合面；形状与拆分前完全一致，消费方零改动）。

import type { PromptApi, SearchHistoryApi } from "./prompt";
import type { HistoryApi } from "./history";
import type { WorkbenchSessionApi } from "./workbench";
import type { AiConnectionApi, ProviderApi, SettingsApi, ImageApi } from "./generation";
import type { AccountApi, CloudSyncApi, CloudConnectionsApi } from "./account";
import type {
  SystemApi,
  UpdaterApi,
  LogApi,
  WindowApi,
} from "./system";
import type { AutomationApi } from "./automation";
import type { ShareApi } from "./share";
import type { DiagnosticsApi, PetApi, SkillRuntimeApi, DesignSchemeApi } from "./misc";

// ---------- IPC 错误 ----------
export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

// ---------- preload 暴露的 API 形态（window.api） ----------
export interface Api {
  prompt: PromptApi;
  searchHistory: SearchHistoryApi;
  skillRuntime: SkillRuntimeApi;
  designScheme: DesignSchemeApi;
  aiConnection: AiConnectionApi;
  provider: ProviderApi;
  settings: SettingsApi;
  image: ImageApi;
  workbenchSession: WorkbenchSessionApi;
  history: HistoryApi;
  share: ShareApi;
  system: SystemApi;
  updater: UpdaterApi;
  log: LogApi;
  /** 本地控制面（Automation API v1，V04-SET-01/02） */
  automation: AutomationApi;
  /** v0.5 账号与云通道（V05-ACC-05）；请求/响应永不含密码回显、JWT、refresh、sk- 明文（D12：不暴露给控制面/CLI/MCP） */
  account: AccountApi;
  cloudSync: CloudSyncApi;
  cloudConnections: CloudConnectionsApi;
  diagnostics: DiagnosticsApi;
  /** 桌宠（悬浮伴侣）。宠物窗口和主窗口都用这套 API。 */
  pet: PetApi;
  window: WindowApi;
}
