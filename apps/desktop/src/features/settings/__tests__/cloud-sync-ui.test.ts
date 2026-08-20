import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../sections/AccountSection.tsx", import.meta.url),
  "utf8",
);
const connectionsSource = readFileSync(
  new URL("../sections/ConnectedAppsSection.tsx", import.meta.url),
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
    expect(source).toContain('role="switch"');
    expect(source).toContain("window.api.cloudSync.setEnabled");
    expect(source).toContain("window.api.cloudSync.syncNow");
  });

  it("offers explicit conflict outcomes and only duplicates supported entities", () => {
    expect(source).toContain('onResolve(conflict.id, "remote")');
    expect(source).toContain('onResolve(conflict.id, "local")');
    expect(source).toContain('onResolve(conflict.id, "duplicate")');
    expect(source).toContain("conflict.canDuplicate");
  });

  it("uses the shared Cloud MCP connection surface through a narrow preload adapter", () => {
    expect(settingsView).toContain("key: 'connections', label: '已连接应用'");
    expect(connectionsSource).toContain("<ConnectedAppsScreen");
    expect(connectionsSource).toContain("useCloudConnectionsStore");
    expect(connectionsStoreSource).toContain("listConnections");
    expect(connectionsStoreSource).toContain("updateConnection");
    expect(connectionsStoreSource).toContain("revokeConnection");
    expect(connectionsStoreSource).not.toContain("window.api.cloudConnections");
    expect(connectionsSource).not.toContain("reauthPassword");
  });
});
