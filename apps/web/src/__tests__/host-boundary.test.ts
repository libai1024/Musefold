import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("web host boundary", () => {
  it("keeps page implementations outside the route and adapter host", () => {
    expect(appSource).toContain('from "./layout/WebNavigation"');
    expect(appSource).toContain('from "./views/GenerateView"');
    expect(appSource).toContain('from "./views/PromptLibraryView"');
    expect(appSource).toContain('from "./views/HistoryView"');
    expect(appSource).not.toMatch(
      /function (GenerateView|PromptLibraryView|HistoryView|Sidebar|Topbar|MobileNavigation)\s*\(/,
    );
  });
});
