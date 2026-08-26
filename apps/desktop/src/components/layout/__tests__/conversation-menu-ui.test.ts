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
  it("places a compact leading pin before the title and keeps archive trailing", () => {
    expect(sessionList).toContain('data-testid="conversation-hover-pin"');
    expect(sessionList).toContain('data-testid="conversation-hover-archive"');
    expect(sessionList.indexOf('data-testid="conversation-hover-pin"')).toBeLessThan(
      sessionList.indexOf('className="mf-workbench-session-open"'),
    );
    expect(sessionList.indexOf('data-testid="conversation-hover-archive"')).toBeGreaterThan(
      sessionList.indexOf('className="mf-workbench-session-open"'),
    );
    expect(productStyles).toContain(".mf-workbench-session-pin[aria-pressed='true']");
    expect(productStyles).toContain("padding-left: 4px");
    expect(productStyles).toContain("gap: 4px");
    expect(productStyles).toContain("text-overflow: clip");
    expect(productStyles).toContain("#000 calc(100% - 20px)");
    expect(productStyles).toContain("background: var(--surface-popover)");
    expect(productStyles).toContain("box-shadow: var(--shadow-sm)");
    expect(sidebar).not.toContain("MoreHorizontal");
    expect(sidebar).not.toContain("管理对话：");
  });

  it("renders a viewport-aware solid context menu through a body portal", () => {
    expect(contextMenu).toContain("createPortal(");
    expect(contextMenu).toContain("document.body");
    expect(contextMenu).toContain("data-workbench-session-context-menu");
    expect(contextMenu).toContain("bounds.right - rect.width - 8");
    expect(contextMenu).toContain("bounds.bottom - rect.height - 8");
    expect(contextMenu).toContain("right: window.innerWidth");
    expect(contextMenu).toContain("bottom: window.innerHeight");
    expect(sessionList).toContain("returnFocusTarget: HTMLElement");
    expect(contextMenu).toContain("returnFocusTarget ??");
    expect(sidebar).toContain("returnFocusTarget={contextMenu.returnFocusTarget}");
    expect(contextMenu).toContain("mf-ui-dropdown-content mf-workbench-session-context-menu");
    expect(contextMenu).toContain("mf-ui-dropdown-item mf-workbench-session-context-action");
    expect(contextMenu).toContain('data-tone={tone === "danger" ? tone : undefined}');
    expect(contextMenu).toContain('className="mf-ui-dropdown-separator"');
    expect(productStyles).not.toContain("backdrop-filter: blur(20px)");
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

  it("puts pinned chats in their own group and exposes an interactive leading pin", () => {
    expect(sessionList).toContain("item.pinned ? '置顶' : sessionDateGroup");
    expect(sessionList).toContain("aria-pressed={item.pinned}");
    expect(sessionList).toContain('className="mf-workbench-session-pin"');
  });

  it("shows a leading status glow instead of conversation type icons", () => {
    expect(sidebar).not.toContain("ConversationTypeIcon");
    expect(sidebar).not.toContain("conversation-type-indicator");
    expect(sessionList).toContain('className="mf-workbench-session-status"');
    expect(sessionList).toContain("data-status={status}");
    expect(sessionList).toContain("status === 'running'");
  });
});
