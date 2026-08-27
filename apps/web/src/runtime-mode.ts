export type WebGatewayMode = "api" | "fixture";

export interface WebRuntimeModeInput {
  isDevelopment: boolean;
  /** True only for the explicit `vite build --mode fixtures` bundle. */
  isFixtureBuild?: boolean;
  useFixtures?: string;
}

/** Fixtures are a local preview aid and must never be selected implicitly:
 *  they require the dev server or an explicit fixtures build AND the opt-in flag. */
export function resolveWebGatewayMode(
  input: WebRuntimeModeInput,
): WebGatewayMode {
  const fixturesAllowed = input.isDevelopment || input.isFixtureBuild === true;
  return fixturesAllowed && input.useFixtures === "true"
    ? "fixture"
    : "api";
}
