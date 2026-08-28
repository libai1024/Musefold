import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuthInfo } from "../oauth/service.js";
import {
  CLOUD_MCP_TOOL_MANIFEST,
  enabledCloudMcpTools,
  type CloudMcpDependencies,
} from "./manifest.js";

export function createCloudMcpServer(
  auth: McpAuthInfo,
  deps: CloudMcpDependencies,
): McpServer {
  const server = new McpServer(
    { name: "musefold-cloud", version: "1.1.0-dev" },
    {
      instructions:
        "Musefold Cloud MCP only exposes read-only account, prompt and official skill tools. Never request or return credentials, local file paths, generation controls or arbitrary URLs.",
    },
  );

  for (const entry of enabledCloudMcpTools(auth.scopes)) {
    entry.register(
      server,
      { auth, deps },
      { ...entry.config, annotations: { readOnlyHint: entry.readOnly } },
    );
  }

  return server;
}

export { CLOUD_MCP_TOOL_MANIFEST };
export type { CloudMcpDependencies } from "./manifest.js";

export function cloudMcpToolManifestIsReadOnly(): boolean {
  return CLOUD_MCP_TOOL_MANIFEST.every((entry) => entry.readOnly);
}
