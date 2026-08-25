import { describe, expect, it } from "vitest";
import {
  resultRevealDecision,
  useResultTheaterReveal,
} from "../useResultTheaterReveal";
import { theaterDurationMs } from "../useTheaterIdle";

describe("resultRevealDecision", () => {
  it("reveals only when an image arrives and motion is allowed", () => {
    expect(resultRevealDecision(true, false)).toBe("reveal");
    expect(resultRevealDecision(true, true)).toBe("idle");
    expect(resultRevealDecision(false, false)).toBe("idle");
  });
});

describe("theaterDurationMs", () => {
  it("normalizes ms and minified s token text to milliseconds", () => {
    expect(theaterDurationMs("640ms")).toBe(640);
    expect(theaterDurationMs(".64s")).toBe(640);
    expect(theaterDurationMs("0.64s")).toBe(640);
    expect(theaterDurationMs("")).toBe(0);
    expect(theaterDurationMs("garbage")).toBe(0);
  });
});

describe("useResultTheaterReveal", () => {
  it("is a named export consumed by the shared result surface", () => {
    expect(typeof useResultTheaterReveal).toBe("function");
  });
});
