import { describe, expect, it } from "vitest";
import {
  isWorkbenchTimelineNearLatest,
  shouldFollowWorkbenchTimelineResize,
} from "../useWorkbenchTimelineController";

describe("workbench timeline controller", () => {
  it("keeps an empty timeline at the top when content resizes", () => {
    expect(shouldFollowWorkbenchTimelineResize(0, true)).toBe(false);
  });

  it("follows a populated timeline while the user is near the latest turn", () => {
    expect(shouldFollowWorkbenchTimelineResize(1, true)).toBe(true);
  });

  it("does not move a populated timeline after the user scrolls away", () => {
    expect(shouldFollowWorkbenchTimelineResize(1, false)).toBe(false);
    expect(
      isWorkbenchTimelineNearLatest({
        scrollHeight: 800,
        scrollTop: 120,
        clientHeight: 500,
      }),
    ).toBe(false);
  });
});
