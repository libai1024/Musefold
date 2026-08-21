import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("desktop navigation wiring", () => {
  it("uses design schemes as the reusable workflow surface and exposes no recipe route", () => {
    const sidebar = source("apps/desktop/src/components/layout/Sidebar.tsx");
    const productSidebar = source(
      "packages/product-ui/src/navigation/ProductSidebar.tsx",
    );
    const commandPalette = source("apps/desktop/src/components/command/CommandPalette.tsx");
    const app = source("apps/desktop/src/App.tsx");

    expect(sidebar).toContain("buildSidebarNavItems");
    expect(productSidebar).toContain("data-testid={item.testId ?? `nav-${item.id}`}");
    expect(sidebar).not.toContain('key: "recipes"');
    expect(productSidebar).not.toContain("recipes");

    expect(commandPalette).toContain("visibleProductCommands");
    expect(commandPalette).toContain("runCommand");
    expect(commandPalette).not.toContain("id: 'nav-recipes'");

    const catalog = source("packages/domain/src/navigation-catalog.ts");
    expect(catalog).toContain('id: "nav-design-schemes"');
    expect(catalog).toContain('navigate: "design-schemes"');
    expect(catalog).not.toContain("nav-recipes");
    expect(app).toContain("'design-schemes': DesignSchemesPage");
    expect(app).not.toContain("RecipesPage");
    expect(app).not.toContain("recipes:");
  });

  it("exposes design scheme stores through the E2E hook without legacy recipe helpers", () => {
    const testHook = source("apps/desktop/src/lib/test-hook.ts");

    expect(testHook).toContain("schemeCreation: useSchemeCreationStore");
    expect(testHook).toContain("schemeRun: useSchemeRunStore");
    expect(testHook).not.toContain("RecipeRoute");
    expect(testHook).not.toContain("useRecipe");
  });

  it("offers an app restart instead of exposing missing conversation IPC errors", () => {
    const sidebar = source("apps/desktop/src/components/layout/Sidebar.tsx");

    expect(sidebar).toContain("WORKBENCH_SESSION_RESTART_REQUIRED");
    expect(sidebar).toContain("workbench-session-relaunch");
    expect(sidebar).toContain("api.system.relaunch()");
    expect(sidebar).not.toContain("{error}，点击重试");
  });
});
