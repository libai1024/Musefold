#!/usr/bin/env node

const endpoint = process.env.MUSEFOLD_OPENAPI_URL?.trim();
if (!endpoint) {
  console.error("需要 MUSEFOLD_OPENAPI_URL，例如 https://staging.example.com/api/musefold/v1/openapi.json");
  process.exit(2);
}

try {
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const document = await response.json();
  const paths = document?.paths;
  const required = [
    "/api/musefold/v1/auth/login",
    "/api/musefold/v1/prompts",
    "/api/musefold/v1/generations",
    "/api/musefold/mcp",
  ];
  const missing = required.filter((path) => !paths?.[path]);
  if (missing.length) throw new Error(`missing paths: ${missing.join(", ")}`);
  console.log(`[openapi] PASS ${Object.keys(paths).length} paths`);
} catch (error) {
  console.error(`[openapi] FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
