import { describe, expect, it } from "vitest";
import { resolveWebGatewayMode } from "../runtime-mode";

describe("resolveWebGatewayMode", () => {
  it("defaults development to the real API", () => {
    expect(resolveWebGatewayMode({ isDevelopment: true })).toBe("api");
  });

  it("requires an explicit true flag for fixture previews", () => {
    expect(
      resolveWebGatewayMode({ isDevelopment: true, useFixtures: "true" }),
    ).toBe("fixture");
    expect(
      resolveWebGatewayMode({ isDevelopment: true, useFixtures: "false" }),
    ).toBe("api");
  });

  it("never enables fixtures in production", () => {
    expect(
      resolveWebGatewayMode({ isDevelopment: false, useFixtures: "true" }),
    ).toBe("api");
  });
});
