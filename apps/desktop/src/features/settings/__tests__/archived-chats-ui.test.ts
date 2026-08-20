import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsView = readFileSync(
  "apps/desktop/src/features/settings/components/SettingsView.tsx",
  "utf8",
);
const archivedSection = readFileSync(
  "apps/desktop/src/features/settings/sections/ArchivedChatsSection.tsx",
  "utf8",
);
const sidebar = readFileSync("apps/desktop/src/components/layout/Sidebar.tsx", "utf8");
const sessionList = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchSessionList.tsx",
  "utf8",
);

describe("archived chat UI contract", () => {
  it("keeps archived chats as the final settings destination and out of the sidebar header", () => {
    const aboutIndex = settingsView.indexOf("key: 'about', label: '关于'");
    const archivedIndex = settingsView.indexOf(
      "key: 'archived', label: '已归档聊天'",
    );
    expect(aboutIndex).toBeGreaterThan(-1);
    expect(archivedIndex).toBeGreaterThan(aboutIndex);
    expect(sidebar).not.toContain("查看已归档对话");
    expect(sidebar).not.toContain("返回最近对话");
  });

  it("uses exactly the two supported conversation types", () => {
    expect(archivedSection).toContain(
      "chat: { label: '普通聊天', icon: MessageSquareText }",
    );
    expect(archivedSection).toContain(
      "prompt: { label: '引用提示词', icon: LibraryBig }",
    );
    expect(archivedSection).not.toContain("引用配方");
    // 侧栏不再用类型图标，类型通过行级 data 属性暴露
    expect(sessionList).toContain(
      "data-conversation-kind={item.kind ?? 'chat'}",
    );
  });

  it("preserves open, restore and confirmed delete actions", () => {
    expect(archivedSection).toContain("openSession(session.id)");
    expect(archivedSection).toContain("archiveSession(session.id, false)");
    expect(archivedSection).toContain("<Dialog open={deleteTarget !== null}");
  });
});
