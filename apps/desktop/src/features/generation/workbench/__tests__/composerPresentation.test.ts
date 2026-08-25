import { describe, expect, it } from "vitest";
import {
  composerPresentationMode,
  composerPresentationModeLocked,
} from "../composerPresentation";

const base = {
  refinementContext: null,
  schemeSource: null,
  skillRuntimeStatus: "idle",
  designPlanIntent: null,
  draftCommand: null,
};

describe("composer presentation mode", () => {
  it("uses image mode by default", () => {
    expect(composerPresentationMode(base)).toBe("image");
    expect(composerPresentationModeLocked("image")).toBe(false);
  });

  it("prioritizes locked runtime contexts", () => {
    expect(
      composerPresentationMode({ ...base, designPlanIntent: { prompt: "x" } }),
    ).toBe("design-plan");
    expect(
      composerPresentationMode({ ...base, skillRuntimeStatus: "ready" }),
    ).toBe("skill");
    expect(
      composerPresentationMode({ ...base, schemeSource: { mode: "trial" } }),
    ).toBe("scheme");
    expect(composerPresentationMode({ ...base, refinementContext: {} })).toBe(
      "refinement",
    );
    expect(composerPresentationModeLocked("refinement")).toBe(true);
  });
});
