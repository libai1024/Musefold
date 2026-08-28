#!/usr/bin/env node

import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MUSEFOLD_STAGING_MCP_URL?.trim();
const token = process.env.MUSEFOLD_STAGING_MCP_ACCESS_TOKEN?.trim();
if (!url || !token) {
  console.error("[mcp-staging] 需要 MUSEFOLD_STAGING_MCP_URL 和 MUSEFOLD_STAGING_MCP_ACCESS_TOKEN");
  process.exit(2);
}

const clients = [];
const expectedTools = [
  "get_account_status",
  "get_prompt",
  "get_skill",
  "list_models",
  "list_skills",
  "musefold_status",
  "search_prompts",
];
const forbiddenTools = [
  "save_prompt",
  "generate_image",
  "estimate_generation",
  "get_generation",
  "wait_for_generation",
  "cancel_generation",
  "list_history",
];

async function openClient(name) {
  const client = new Client({ name, version: "2.1.0-staging" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  clients.push(client);
  return client;
}

function structured(result, label) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${label} did not return structuredContent`);
  return result.structuredContent;
}

try {
  const [first, second] = await Promise.all([
    openClient("musefold-staging-read-only-a"),
    openClient("musefold-staging-read-only-b"),
  ]);
  const [firstTools, secondTools] = await Promise.all([
    first.listTools(),
    second.listTools(),
  ]);
  for (const [label, tools] of [["first", firstTools], ["second", secondTools]]) {
    const names = tools.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(expectedTools))
      throw new Error(`${label} tool catalog mismatch: ${names.join(", ")}`);
    if (names.some((name) => forbiddenTools.includes(name)))
      throw new Error(`${label} exposed a forbidden Cloud MCP tool`);
  }
  console.log("[mcp-staging] PASS two independent Streamable HTTP clients · exact read-only tools/list");

  const status = structured(await first.callTool({ name: "musefold_status", arguments: {} }), "musefold_status");
  if (status.surface !== "cloud" || status.connected !== true)
    throw new Error("musefold_status did not report connected cloud surface");
  structured(await first.callTool({ name: "get_account_status", arguments: {} }), "get_account_status");
  structured(await first.callTool({ name: "list_models", arguments: {} }), "list_models");
  const search = structured(await second.callTool({ name: "search_prompts", arguments: { limit: 20 } }), "search_prompts");
  if (!Array.isArray(search.items)) throw new Error("search_prompts omitted items");
  if (search.items[0]?.id) {
    const prompt = structured(await second.callTool({
      name: "get_prompt",
      arguments: { id: search.items[0].id },
    }), "get_prompt");
    if (!prompt || prompt.id !== search.items[0].id)
      throw new Error("get_prompt returned a different prompt");
  }
  const skillList = structured(await first.callTool({ name: "list_skills", arguments: {} }), "list_skills");
  if (!Array.isArray(skillList.skills)) throw new Error("list_skills omitted skills");
  if (skillList.skills.length > 0) {
    const selected = skillList.skills[0];
    const skill = structured(await second.callTool({
      name: "get_skill",
      arguments: { id: selected.id, version: selected.version },
    }), "get_skill");
    if (skill.id !== selected.id || skill.version !== selected.version || !skill.contentHash)
      throw new Error("get_skill returned an incomplete pinned Skill");
  } else if (process.env.MUSEFOLD_STAGING_MCP_REQUIRE_SKILL !== "false") {
    throw new Error("get_skill cannot be verified because staging has no published Skill");
  }
  console.log("[mcp-staging] PASS account, models, prompts and official Skills");
  console.log("[mcp-staging] COMPLETE");
} catch (error) {
  console.error(`[mcp-staging] FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
}
