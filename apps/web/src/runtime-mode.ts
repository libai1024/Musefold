export type WebGatewayMode = "api" | "fixture";

export interface WebRuntimeModeInput {
  isDevelopment: boolean;
  useFixtures?: string;
}

/** Fixtures are a local preview aid and must never be selected implicitly. */
export function resolveWebGatewayMode(
  input: WebRuntimeModeInput,
): WebGatewayMode {
  return input.isDevelopment && input.useFixtures === "true"
    ? "fixture"
    : "api";
}
