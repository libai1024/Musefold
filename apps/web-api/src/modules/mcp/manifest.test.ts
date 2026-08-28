import { describe, expect, it } from "vitest";
import {
  CLOUD_MCP_TOOL_MANIFEST,
  CLOUD_MCP_TOOL_NAMES,
  enabledCloudMcpTools,
} from "./manifest.js";

const forbiddenNames = [
  "save_prompt",
  "generate_image",
  "estimate_generation",
  "get_generation",
  "wait_for_generation",
  "cancel_generation",
  "list_history",
];

const expectedNames = [
  "get_account_status",
  "get_prompt",
  "get_skill",
  "list_models",
  "list_skills",
  "musefold_status",
  "search_prompts",
];

describe("Cloud MCP tool manifest", () => {
  it("is the exact seven-tool read-only allowlist", () => {
    expect([...CLOUD_MCP_TOOL_NAMES].sort()).toEqual(expectedNames);
    expect(CLOUD_MCP_TOOL_MANIFEST).toHaveLength(7);
    expect(CLOUD_MCP_TOOL_MANIFEST.every((entry) => entry.readOnly)).toBe(true);
    expect(
      CLOUD_MCP_TOOL_MANIFEST.some((entry) =>
        forbiddenNames.includes(entry.name),
      ),
    ).toBe(false);
  });

  it("declares scope, schema, data limits and rollout for every entry", () => {
    for (const entry of CLOUD_MCP_TOOL_MANIFEST) {
      expect(entry.requiredScope).toMatch(/^(account|prompts|skills):read$/);
      expect(entry.schemaRef).toBeTruthy();
      expect(Object.keys(entry.dataLimits).length).toBeGreaterThan(0);
      expect(["enabled", "disabled"]).toContain(entry.rollout);
      expect(typeof entry.register).toBe("function");
    }
  });

  it("filters tools by grant scope and rollout", () => {
    expect(enabledCloudMcpTools(["account:read"]).map((entry) => entry.name)).toEqual([
      "musefold_status",
      "get_account_status",
      "list_models",
    ]);
    expect(enabledCloudMcpTools(["prompts:read"]).map((entry) => entry.name)).toEqual([
      "search_prompts",
      "get_prompt",
    ]);
    expect(enabledCloudMcpTools(["skills:read"]).map((entry) => entry.name)).toEqual([
      "list_skills",
      "get_skill",
    ]);
    expect(enabledCloudMcpTools([])).toEqual([]);
  });
});
