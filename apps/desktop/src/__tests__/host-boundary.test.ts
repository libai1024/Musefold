import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("desktop host boundary", () => {
  it("assembles the shared QueryClient at the window root", () => {
    expect(mainSource).toMatch(/desktopQueryClient/);
    expect(mainSource).toMatch(/QueryClientProvider/);
  });

  it("injects PlatformServices at the host instead of product-ui", () => {
    expect(mainSource).toMatch(/desktopPlatformServices/);
    expect(mainSource).not.toMatch(/from ['"]electron['"]/);
  });

  it("mounts history and library pages on the shared page controllers", () => {
    const historyPage = readFileSync(new URL("../pages/HistoryPage.tsx", import.meta.url), "utf8");
    const libraryPage = readFileSync(new URL("../pages/LibraryPage.tsx", import.meta.url), "utf8");
    expect(historyPage).toMatch(/useHistoryPageController/);
    expect(libraryPage).toMatch(/useLibraryPageController/);
    expect(historyPage).toMatch(/desktopPlatformServices/);
    expect(libraryPage).toMatch(/desktopPlatformServices/);
  });
});
