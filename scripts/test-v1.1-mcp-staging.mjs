#!/usr/bin/env node

import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MUSEFOLD_STAGING_MCP_URL?.trim();
const token = process.env.MUSEFOLD_STAGING_MCP_ACCESS_TOKEN?.trim();
const runGeneration = process.env.MUSEFOLD_STAGING_MCP_RUN_GENERATION === "true";
if (!url || !token) {
  console.error("[mcp-staging] 需要 MUSEFOLD_STAGING_MCP_URL 和 MUSEFOLD_STAGING_MCP_ACCESS_TOKEN");
  process.exit(2);
}

const clients = [];

async function openClient(name) {
  const client = new Client({ name, version: "1.1.0-staging" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

function structured(result, label) {
  if (!result.structuredContent || typeof result.structuredContent !== "object")
    throw new Error(`${label} did not return structuredContent`);
  return result.structuredContent;
}

try {
  const [first, second] = await Promise.all([
    openClient("musefold-staging-client-a"),
    openClient("musefold-staging-client-b"),
  ]);
  const firstTools = await first.listTools();
  const secondTools = await second.listTools();
  const required = ["musefold_status", "list_skills", "list_history", "generate_image"];
  for (const name of required) {
    if (!firstTools.tools.some((tool) => tool.name === name) ||
        !secondTools.tools.some((tool) => tool.name === name))
      throw new Error(`tool ${name} is missing from one independent client`);
  }
  console.log("[mcp-staging] PASS two independent Streamable HTTP clients · tools/list");

  const status = structured(await first.callTool({ name: "musefold_status", arguments: {} }), "musefold_status");
  if (status.surface !== "cloud" || status.connected !== true)
    throw new Error("musefold_status did not report connected cloud surface");
  structured(await second.callTool({ name: "list_skills", arguments: {} }), "list_skills");
  structured(await second.callTool({ name: "list_history", arguments: { limit: 20 } }), "list_history");
  console.log("[mcp-staging] PASS auth, status, skills and history");

  if (runGeneration) {
    const prompt = process.env.MUSEFOLD_STAGING_MCP_PROMPT?.trim() ||
      "A clean editorial postcard for Musefold staging verification, soft daylight, no text";
    const input = {
      idempotencyKey: `mcp-staging-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      prompt,
      size: "1024x1024",
      quality: "low",
      maxPoints: 1_000,
    };
    const firstGeneration = structured(await first.callTool({ name: "generate_image", arguments: input }), "generate_image");
    const duplicate = structured(await second.callTool({ name: "generate_image", arguments: input }), "generate_image duplicate");
    if (firstGeneration.id && duplicate.id && firstGeneration.id !== duplicate.id)
      throw new Error("MCP idempotency key created different jobs");
    if (firstGeneration.status === "rejected")
      throw new Error(`MCP generation rejected: ${firstGeneration.reason ?? "unknown"}`);
    if (firstGeneration.approvalUrl)
      console.log("[mcp-staging] generation requires Web approval; no upstream call was assumed");
    else if (firstGeneration.id) {
      let job = firstGeneration;
      for (let attempt = 0; attempt < 8 && ["pending_approval", "queued", "running", "cancelling"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        job = structured(await first.callTool({ name: "wait_for_generation", arguments: { jobId: firstGeneration.id } }), "wait_for_generation");
      }
      if (!["succeeded", "failed", "cancelled", "rejected", "expired"].includes(job.status))
        throw new Error("MCP generation did not reach a terminal state");
      console.log(`[mcp-staging] PASS generation/wait · ${job.status}`);
      if (job.status === "succeeded" && (!Array.isArray(job.assets) || job.assets.length === 0))
        throw new Error("MCP succeeded generation returned no assets");
    }
  }
  console.log("[mcp-staging] COMPLETE");
} catch (error) {
  console.error(`[mcp-staging] FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
}
