import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
  prompt: vi.fn(),
  smartSet: vi.fn(),
  provider: vi.fn(),
  image: vi.fn(),
  history: vi.fn(),
  system: vi.fn(),
  share: vi.fn(),
  workbenchSession: vi.fn(),
  skillRuntime: vi.fn(),
  designScheme: vi.fn(),
  automation: vi.fn(),
  account: vi.fn(),
  cloudSync: vi.fn(),
  aiConnection: vi.fn(),
  updater: vi.fn(),
  pet: vi.fn(),
  prefsOriginMigration: vi.fn(),
}));

vi.mock("../prompts", () => ({ registerPromptHandlers: registrations.prompt }));
vi.mock("../smartSets", () => ({
  registerSmartSetHandlers: registrations.smartSet,
}));
vi.mock("../providers", () => ({
  registerProviderHandlers: registrations.provider,
}));
vi.mock("../images", () => ({ registerImageHandlers: registrations.image }));
vi.mock("../history", () => ({
  registerHistoryHandlers: registrations.history,
}));
vi.mock("../system", () => ({ registerSystemHandlers: registrations.system }));
vi.mock("../share", () => ({ registerShareHandlers: registrations.share }));
vi.mock("../workbench-sessions", () => ({
  registerWorkbenchSessionHandlers: registrations.workbenchSession,
}));
vi.mock("../skill-runtime", () => ({
  registerSkillRuntimeHandlers: registrations.skillRuntime,
}));
vi.mock("../design-scheme", () => ({
  registerDesignSchemeHandlers: registrations.designScheme,
}));
vi.mock("../automation", () => ({
  registerAutomationHandlers: registrations.automation,
}));
vi.mock("../account", () => ({
  registerAccountHandlers: registrations.account,
}));
vi.mock("../cloud-sync", () => ({
  registerCloudSyncHandlers: registrations.cloudSync,
}));
vi.mock("../ai-connections", () => ({
  registerAiConnectionHandlers: registrations.aiConnection,
}));
vi.mock("../updater", () => ({
  registerUpdaterHandlers: registrations.updater,
}));
vi.mock("../../pet", () => ({ registerPetHandlers: registrations.pet }));
vi.mock("../../prefs-origin-migration", () => ({
  registerPrefsOriginMigrationHandlers: registrations.prefsOriginMigration,
}));

import { registerAllHandlers } from "../index";

describe("main IPC registry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers every active IPC domain on application startup", () => {
    registerAllHandlers();

    expect(
      Object.values(registrations).every(
        (register) => register.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
