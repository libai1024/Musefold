import { describe, expect, it } from "vitest";
import {
  areWorkbenchDraftsEqual,
  buildWorkbenchDraft,
  collectGatewayPages,
  generatePageRatio,
} from "../generate-page-model";

describe("generate page draft helpers", () => {
  it("builds the complete cloud draft from composer state", () => {
    expect(
      buildWorkbenchDraft({
        prompt: "雨后的安静建筑",
        selectedPromptId: "prompt-architecture",
        size: "1536x1024",
        aspectRatio: "16:9",
        quality: "high",
      }),
    ).toEqual({
      prompt: "雨后的安静建筑",
      negative: "",
      params: {
        size: "1536x1024",
        aspectRatio: "16:9",
        quality: "high",
      },
      promptReferenceIds: ["prompt-architecture"],
    });
  });

  it("detects parameter and prompt-reference changes", () => {
    const original = buildWorkbenchDraft({
      prompt: "玻璃花瓶",
      selectedPromptId: null,
      size: "1024x1024",
      aspectRatio: "1:1",
      quality: "medium",
    });
    const changed = buildWorkbenchDraft({
      prompt: "玻璃花瓶",
      selectedPromptId: "prompt-glass",
      size: "1024x1536",
      aspectRatio: "9:16",
      quality: "medium",
    });

    expect(areWorkbenchDraftsEqual(original, { ...original })).toBe(true);
    expect(areWorkbenchDraftsEqual(original, changed)).toBe(false);
  });

  it("falls back to 1:1 when the aspect ratio is not a workbench option", () => {
    expect(generatePageRatio("21:9")).toBe("1:1");
    expect(generatePageRatio("16:9")).toBe("16:9");
  });

  it("collects gateway pages until the cursor is exhausted", async () => {
    const pages = [
      { items: [{ id: "a" }], nextCursor: "n1" },
      { items: [{ id: "b" }], nextCursor: null },
    ];
    const items = await collectGatewayPages((cursor) => {
      if (!cursor) return Promise.resolve(pages[0]);
      return Promise.resolve(pages[1]);
    });
    expect(items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
