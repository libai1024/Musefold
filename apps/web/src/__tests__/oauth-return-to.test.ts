import { describe, expect, it } from "vitest";
import { getSafeOAuthReturnTo } from "../oauth-return-to";

describe("getSafeOAuthReturnTo", () => {
  const origin = "https://musefold.example";

  it("keeps same-origin OAuth interaction URLs", () => {
    expect(
      getSafeOAuthReturnTo(
        `${origin}/api/musefold/v1/oauth/interaction/abc?foo=bar`,
        origin,
      ),
    ).toBe("/api/musefold/v1/oauth/interaction/abc?foo=bar");
  });

  it("rejects external and non-OAuth redirects", () => {
    expect(
      getSafeOAuthReturnTo("https://attacker.example/steal", origin),
    ).toBeNull();
    expect(
      getSafeOAuthReturnTo(`${origin}/Musefold/app/`, origin),
    ).toBeNull();
  });
});
