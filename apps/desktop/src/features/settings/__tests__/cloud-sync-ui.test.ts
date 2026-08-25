import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = [
  readFileSync(
    new URL("../components/AccountSection.tsx", import.meta.url),
    "utf8",
  ),
  readFileSync(
    new URL("../components/AccountCloudSyncPanel.tsx", import.meta.url),
    "utf8",
  ),
].join("\n");
const connectionsSource = readFileSync(
  new URL("../components/ConnectedAppsSection.tsx", import.meta.url),
  "utf8",
);
const connectionsStoreSource = readFileSync(
  new URL("../cloud-connections-store.ts", import.meta.url),
  "utf8",
);
const settingsView = readFileSync(
  new URL("../components/SettingsView.tsx", import.meta.url),
  "utf8",
);

describe("account cloud sync UI contract", () => {
  it("keeps sync controls in the existing account settings surface", () => {
    expect(source).toContain('data-testid="account-cloud-sync"');
    // v1.4.1：开关统一走共享 SettingsSwitch（role=switch 由原语保证）
    expect(source).toContain("<SettingsSwitch");
    expect(source).toContain("cloudSyncSetEnabled");
    expect(source).toContain("cloudSyncNow");
    expect(source).not.toContain("window.api.cloudSync");
  });

  it("offers explicit conflict outcomes and only duplicates supported entities", () => {
    expect(source).toContain("onResolve(conflict.id, 'remote')");
    expect(source).toContain("onResolve(conflict.id, 'local')");
    expect(source).toContain("onResolve(conflict.id, 'duplicate')");
    expect(source).toContain("conflict.canDuplicate");
  });

  it("uses the shared Cloud MCP connection surface through a narrow preload adapter", () => {
    // v2 设置整合：已连接应用并入「开放能力」分区
    expect(settingsView).toContain("id: 'open'");
    expect(settingsView).toContain("label: '开放能力'");
    expect(connectionsSource).toContain("<ConnectedAppsScreen");
    expect(connectionsSource).toContain("useCloudConnectionsStore");
    expect(connectionsStoreSource).toContain("listConnections");
    expect(connectionsStoreSource).toContain("updateConnection");
    expect(connectionsStoreSource).toContain("revokeConnection");
    expect(connectionsStoreSource).not.toContain("window.api.cloudConnections");
    expect(connectionsSource).not.toContain("reauthPassword");
  });
});
