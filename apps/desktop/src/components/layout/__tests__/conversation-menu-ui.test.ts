import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync("apps/desktop/src/components/layout/Sidebar.tsx", "utf8");
const sessionList = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchSessionList.tsx",
  "utf8",
);
const contextMenu = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchSessionContextMenu.tsx",
  "utf8",
);
const menuTrigger = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchSessionMenuTrigger.tsx",
  "utf8",
);
const deleteDialog = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchSessionDeleteDialog.tsx",
  "utf8",
);
const titleBar = readFileSync("apps/desktop/src/components/layout/TitleBar.tsx", "utf8");
const productStyles = readFileSync("packages/product-ui/src/styles.css", "utf8");

describe("recent conversation actions", () => {
  it("uses direct pin and archive hover actions instead of a more button", () => {
    expect(sessionList).toContain('data-testid="conversation-hover-pin"');
    expect(sessionList).toContain('data-testid="conversation-hover-archive"');
    expect(sidebar).not.toContain("MoreHorizontal");
    expect(sidebar).not.toContain("管理对话：");
  });

  it("renders a viewport-aware glass context menu through a body portal", () => {
    expect(contextMenu).toContain("createPortal(");
    expect(contextMenu).toContain("document.body");
    expect(contextMenu).toContain("data-workbench-session-context-menu");
    expect(contextMenu).toContain("window.innerWidth - rect.width - 8");
    expect(contextMenu).toContain("window.innerHeight - rect.height - 8");
    expect(productStyles).toContain(".mf-workbench-session-context-menu");
    expect(productStyles).toContain("backdrop-filter: blur(20px)");
    expect(productStyles).toContain("z-index: 1000");
  });

  it("shares the same menu trigger and delete confirmation with the title bar", () => {
    expect(menuTrigger).toContain("<WorkbenchSessionContextMenu");
    expect(menuTrigger).toContain('label="管理当前对话"');
    expect(menuTrigger).toContain('aria-haspopup="menu"');
    expect(deleteDialog).toContain("已经生成的图片仍保留在生成历史中");
    expect(titleBar).toContain("<WorkbenchSessionMenuTrigger");
    expect(titleBar).toContain("<WorkbenchSessionDeleteDialog");
    expect(titleBar).not.toContain("titlebar-session-menu\"");
  });

  it("offers the requested context actions without displaying a title header", () => {
    expect(contextMenu).toContain('pinned ? "取消置顶聊天" : "置顶聊天"');
    expect(contextMenu).toContain('"重命名聊天"');
    expect(contextMenu).toContain('"归档聊天"');
    expect(contextMenu).toContain('"标记为未读"');
    expect(contextMenu).not.toContain("title={title}>{title}</p>");
  });

  it("puts pinned chats in their own group without an inline pin marker", () => {
    expect(sessionList).toContain('item.pinned ? "置顶" : sessionDateGroup');
    expect(sessionList).not.toContain("{pinned && <Pin");
  });

  it("shows a leading status glow instead of conversation type icons", () => {
    expect(sidebar).not.toContain("ConversationTypeIcon");
    expect(sidebar).not.toContain("conversation-type-indicator");
    expect(sessionList).toContain('className="mf-workbench-session-status"');
    expect(sessionList).toContain("data-status={status}");
    expect(sessionList).toContain('status === "running"');
  });
});
