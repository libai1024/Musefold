import { describe, expect, it } from "vitest";
import {
  WORKBENCH_QUALITY_OPTIONS,
  workbenchFormatParams,
} from "../workbenchDisplay";

describe("workbench display helpers", () => {
  it("formats generation params for the turn meta line", () => {
    expect(
      workbenchFormatParams({ ratioId: "16:9", quality: "高清", n: 2 }),
    ).toBe("16:9 · 高清 · 2张");
  });

  it("exposes the four shared quality options", () => {
    expect(WORKBENCH_QUALITY_OPTIONS.map((option) => option.id)).toEqual([
      "auto",
      "low",
      "medium",
      "high",
    ]);
  });
});
