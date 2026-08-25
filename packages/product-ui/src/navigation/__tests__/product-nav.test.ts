import { getProductCapabilities, PRODUCT_COMMAND_CATALOG } from "@musefold/domain";
import { describe, expect, it } from "vitest";
import {
  buildSidebarNavItems,
  productCommandIcon,
  productCommandLabel,
  resolveProductViewKey,
} from "../product-nav";

describe("shared product nav helpers", () => {
  it("builds host sidebar items from the catalog without changing testids", () => {
    const desktop = buildSidebarNavItems({
      surface: "desktop",
      capabilities: getProductCapabilities("desktop"),
      currentView: "library",
      onSelect: () => undefined,
    });
    const web = buildSidebarNavItems({
      surface: "web",
      capabilities: getProductCapabilities("web"),
      currentView: "prompts",
      onSelect: () => undefined,
      counts: { prompts: 3 },
    });

    expect(desktop.map((item) => item.id)).toEqual(["library", "design-schemes", "history"]);
    expect(web.map((item) => item.id)).toEqual(["prompts", "history", "settings"]);
    expect(desktop[0]?.active).toBe(true);
    expect(web[0]?.count).toBe(3);
    expect(web.map((item) => `nav-${item.id}`)).toEqual([
      "nav-prompts",
      "nav-history",
      "nav-settings",
    ]);
  });

  it("maps web prompts to the library icon view and keeps theme command copy", () => {
    expect(resolveProductViewKey("prompts")).toBe("library");
    expect(resolveProductViewKey("connections")).toBe("connections");
    const theme = PRODUCT_COMMAND_CATALOG.find((item) => item.id === "act-theme");
    expect(theme).toBeTruthy();
    expect(productCommandLabel(theme!, "dark")).toBe("切换到浅色");
    expect(productCommandLabel(theme!, "light")).toBe("切换到深色");
    expect(productCommandIcon("act-theme", "dark")).not.toBe(productCommandIcon("act-theme", "light"));
    expect(productCommandIcon("nav-library")).toBeTruthy();
  });
});
