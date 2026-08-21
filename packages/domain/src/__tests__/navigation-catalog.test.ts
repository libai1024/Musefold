import { describe, expect, it } from "vitest";
import { getProductCapabilities } from "../capabilities";
import {
  PRODUCT_COMMAND_CATALOG,
  PRODUCT_NAV_CATALOG,
  PRODUCT_SHORTCUTS,
  matchProductModifierShortcut,
  productCommandCapabilityMap,
  productSidebarCapabilityMap,
  productViewTitle,
  shortcutDisplayKeys,
  visibleProductCommands,
  visibleProductNav,
} from "../navigation-catalog";

describe("product navigation catalog", () => {
  it("keeps host sidebar ids and order stable for current capability flags", () => {
    expect(visibleProductNav("desktop", getProductCapabilities("desktop")).map((item) => item.sidebarId)).toEqual([
      "library",
      "design-schemes",
      "history",
    ]);
    expect(visibleProductNav("web", getProductCapabilities("web")).map((item) => item.sidebarId)).toEqual([
      "prompts",
      "history",
      "connections",
    ]);
    expect(PRODUCT_NAV_CATALOG.map((item) => item.id)).toEqual([
      "library",
      "design-schemes",
      "history",
      "connections",
    ]);
  });

  it("hides desktop-only nav when the matching capability is off", () => {
    const closed = {
      ...getProductCapabilities("desktop"),
      designSchemes: false,
      localPrompts: false,
    };
    expect(visibleProductNav("desktop", closed).map((item) => item.sidebarId)).toEqual(["history"]);
  });

  it("derives the desktop capability maps used by host entry gates", () => {
    expect(productSidebarCapabilityMap("desktop")).toEqual({
      library: "localPrompts",
      "design-schemes": "designSchemes",
      history: "generationHistory",
    });
    expect(productCommandCapabilityMap("desktop")).toEqual({
      "nav-library": "localPrompts",
      "nav-design-schemes": "designSchemes",
      "nav-history": "generationHistory",
      "act-import-skill": "designSchemes",
      "act-providers": "byokProviders",
      "act-ai-connections": "agent",
    });
  });
});

describe("product command catalog", () => {
  it("lists desktop command ids in the palette order and keeps Skill/BYOK as desktop extras", () => {
    expect(visibleProductCommands("desktop", getProductCapabilities("desktop")).map((item) => item.id)).toEqual([
      "act-new-conversation",
      "act-import-skill",
      "nav-library",
      "nav-design-schemes",
      "nav-history",
      "nav-settings",
      "act-providers",
      "act-ai-connections",
      "act-theme",
      "act-sidebar",
    ]);
    expect(visibleProductCommands("web", getProductCapabilities("web"))).toEqual([]);
    expect(PRODUCT_COMMAND_CATALOG.find((item) => item.id === "nav-design-schemes")?.navigate).toBe(
      "design-schemes",
    );
    expect(PRODUCT_COMMAND_CATALOG.find((item) => item.id === "act-providers")?.settingsSection).toBe(
      "providers",
    );
    expect(PRODUCT_COMMAND_CATALOG.find((item) => item.id === "act-ai-connections")?.settingsSection).toBe(
      "ai",
    );
  });

  it("omits gated commands when flags are off and leaves ungated actions visible", () => {
    const closed = {
      ...getProductCapabilities("desktop"),
      designSchemes: false,
      byokProviders: false,
      agent: false,
    };
    expect(visibleProductCommands("desktop", closed).map((item) => item.id)).toEqual([
      "act-new-conversation",
      "nav-library",
      "nav-history",
      "nav-settings",
      "act-theme",
      "act-sidebar",
    ]);
  });
});

describe("product shortcuts", () => {
  it("renders the about-page key rows and matches ⌘K / ⌘N without Shift or Alt", () => {
    expect(PRODUCT_SHORTCUTS.map((item) => item.label)).toEqual([
      "命令面板",
      "新建",
      "搜索",
      "发送（生成）",
      "换行",
    ]);
    expect(shortcutDisplayKeys(PRODUCT_SHORTCUTS[0], "⌘")).toEqual(["⌘", "K"]);
    expect(shortcutDisplayKeys(PRODUCT_SHORTCUTS[4], "⌘")).toEqual(["Shift", "Enter"]);
    expect(
      matchProductModifierShortcut({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("command-palette");
    expect(
      matchProductModifierShortcut({
        key: "n",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("new-design");
    expect(
      matchProductModifierShortcut({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      matchProductModifierShortcut({
        key: "f",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("keeps host view titles unchanged", () => {
    expect(productViewTitle("prompts")).toBe("提示词库");
    expect(productViewTitle("generate")).toBe("新设计");
    expect(productViewTitle("connections")).toBe("已连接应用");
  });
});
