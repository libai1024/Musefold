import { describe, expect, it } from "vitest";
import {
  areWorkbenchDraftsEqual,
  buildWorkbenchDraft,
} from "../workbench-draft";

describe("workbench draft snapshots", () => {
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
});
