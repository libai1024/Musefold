import { describe, expect, it } from "vitest";
import type { HistoryGateway, PromptGateway, WorkbenchGateway } from "@musefold/domain";
import type { PlatformServices } from "@musefold/domain";
import { useHistoryPageController } from "../history-page-controller";
import { useLibraryPageController } from "../library-page-controller";
import { useGeneratePageController } from "../generate-page-controller";
import { requirePageControllerDeps } from "../types";

const platform: PlatformServices = {
  toast: { success() {}, error() {}, info() {} },
  writeClipboard: async () => {},
  download: async () => {},
  openExternal: async () => {},
};

describe("page-controller skeleton", () => {
  it("requires explicit platform deps instead of implicit context", () => {
    expect(() => requirePageControllerDeps(undefined, "useHistoryPageController")).toThrow(
      /explicit platform deps/,
    );
    const wired = useHistoryPageController({
      history: {} as HistoryGateway,
      platform,
    });
    expect(wired.platform).toBe(platform);
    expect(
      useLibraryPageController({ prompts: {} as PromptGateway, platform }).platform,
    ).toBe(platform);
    expect(
      useGeneratePageController({ workbench: {} as WorkbenchGateway, platform }).platform,
    ).toBe(platform);
  });
});
