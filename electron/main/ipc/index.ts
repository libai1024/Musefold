// electron/main/ipc/index.ts
// 统一注册所有 IPC handler

import { registerPromptHandlers } from "./prompts";
import { registerSmartSetHandlers } from "./smartSets";
import { registerFolderHandlers } from "./folders";
import { registerTagHandlers } from "./tags";
import { registerProviderHandlers } from "./providers";
import { registerSettingsHandlers } from "./settings";
import { registerImageHandlers } from "./images";
import { registerHistoryHandlers } from "./history";
import { registerSystemHandlers } from "./system";
import { registerShareHandlers } from "./share";
import { registerWorkbenchSessionHandlers } from "./workbench-sessions";
import { registerSkillRuntimeHandlers } from "./skill-runtime";
import { registerDesignSchemeHandlers } from "./design-scheme";
import { registerAutomationHandlers } from "./automation";
import { registerPetHandlers } from "../pet";
import { registerAccountHandlers } from "./account";
import { registerCloudSyncHandlers } from "./cloud-sync";
import { registerUpdaterHandlers } from "./updater";
import { registerAiConnectionHandlers } from "./ai-connections";
import { registerPrefsOriginMigrationHandlers } from "../prefs-origin-migration";

export function registerAllHandlers(): void {
  registerPromptHandlers();
  registerSmartSetHandlers();
  registerFolderHandlers();
  registerTagHandlers();
  registerProviderHandlers();
  registerSettingsHandlers();
  registerImageHandlers();
  registerHistoryHandlers();
  registerSystemHandlers();
  registerShareHandlers();
  registerWorkbenchSessionHandlers();
  registerSkillRuntimeHandlers();
  registerDesignSchemeHandlers();
  registerAutomationHandlers();
  registerAccountHandlers();
  registerCloudSyncHandlers();
  registerAiConnectionHandlers();
  registerUpdaterHandlers();
  registerPetHandlers();
  registerPrefsOriginMigrationHandlers();
}
