import { createElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HistoryGateway, PromptGateway, WorkbenchGateway } from "@musefold/domain";
import type { PlatformServices } from "@musefold/domain";
import { useHistoryPageController } from "../history-page-controller";
import { useLibraryPageController } from "../library-page-controller";
import { useGeneratePageController } from "../generate-page-controller";
import { createMusefoldQueryClient, musefoldQueryKeys } from "../query-client";
import { DEFAULT_HISTORY_PAGE_LIST_KEY, DEFAULT_LIBRARY_PAGE_LIST_KEY } from "../paged-items";
import { requirePageControllerDeps } from "../types";

const platform: PlatformServices = {
  toast: { success() {}, error() {}, info() {} },
  writeClipboard: async () => {},
  download: async () => {},
  openExternal: async () => {},
};

describe("page-controller deps", () => {
  it("requires explicit platform deps instead of implicit context", () => {
    expect(() => requirePageControllerDeps(undefined, "useHistoryPageController")).toThrow(
      /explicit platform deps/,
    );
    expect(
      useGeneratePageController({ workbench: {} as WorkbenchGateway, platform }).platform,
    ).toBe(platform);
  });

  it("loads history via HistoryGateway list when the Query cache is warm", async () => {
    const history: HistoryGateway = {
      async listGenerationHistory() {
        return { items: [{ id: "job-1" } as never], nextCursor: null };
      },
      async deleteGeneration(id) {
        return { id } as never;
      },
      async restoreGeneration(id) {
        return { id } as never;
      },
    };
    const client = createMusefoldQueryClient();
    await client.prefetchQuery({
      queryKey: musefoldQueryKeys.history.list(DEFAULT_HISTORY_PAGE_LIST_KEY),
      queryFn: () => history.listGenerationHistory({ limit: 20 }),
    });

    let ids: string[] = [];
    function Probe() {
      const page = useHistoryPageController({ history, platform });
      ids = page.items.map((item) => item.id);
      return null;
    }
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
    expect(ids).toEqual(["job-1"]);
  });

  it("loads library via PromptGateway list when the Query cache is warm", async () => {
    const prompts = {
      async listPrompts() {
        return { items: [{ id: "p-1" }], nextCursor: null };
      },
      async getPrompt(id: string) {
        return { id };
      },
      async createPrompt() {
        return { id: "p-new" };
      },
      async updatePrompt(id: string) {
        return { id };
      },
      async deletePrompt(id: string) {
        return { id };
      },
      async restorePrompt(id: string) {
        return { id };
      },
      async usePrompt(id: string) {
        return { prompt: { id }, recorded: true };
      },
    } as unknown as PromptGateway;
    const client = createMusefoldQueryClient();
    await client.prefetchQuery({
      queryKey: musefoldQueryKeys.library.list(DEFAULT_LIBRARY_PAGE_LIST_KEY),
      queryFn: () => prompts.listPrompts({ limit: 20, sort: "updated-desc" }),
    });

    let ids: string[] = [];
    function Probe() {
      const page = useLibraryPageController({ prompts, platform });
      ids = page.items.map((item) => item.id);
      return null;
    }
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
    expect(ids).toEqual(["p-1"]);
  });
});
