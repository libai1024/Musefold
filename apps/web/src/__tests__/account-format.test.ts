import { describe, expect, it } from "vitest";
import { formatAccountPoints } from "../account-format";

describe("formatAccountPoints", () => {
  it("uses the Desktop quota conversion and keeps two decimal places at most", () => {
    expect(formatAccountPoints(41_598_736)).toBe("831.97");
    expect(formatAccountPoints(9_300_000)).toBe("186");
  });
});
