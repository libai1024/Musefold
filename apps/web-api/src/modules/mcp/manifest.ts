import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PromptServicePort } from "../prompts/service.js";
import type { McpAuthInfo, OAuthService } from "../oauth/service.js";
import { SkillService } from "./skills.js";

export interface CloudMcpDependencies {
  oauth: OAuthService;
  prompts: PromptServicePort;
  skills: SkillService;
  resourceUrl: string;
}

export interface CloudMcpToolContext {
  auth: McpAuthInfo;
  deps: CloudMcpDependencies;
}

export interface CloudMcpToolManifestEntry {
  name: string;
  requiredScope: McpAuthInfo["scopes"][number];
  readOnly: true;
  schemaRef: string;
  dataLimits: Readonly<Record<string, number | string>>;
  rollout: "enabled" | "disabled";
  config: Record<string, unknown>;
  register: (
    server: McpServer,
    context: CloudMcpToolContext,
    config: Record<string, unknown>,
  ) => void;
}

const registerTool = (
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  handler: (args: any) => Promise<unknown>,
): void => {
  (
    server.registerTool as unknown as (
      name: string,
      config: unknown,
      handler: unknown,
    ) => void
  )(name, config, handler);
};

const result = (value: unknown) => ({
  structuredContent: value,
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export const CLOUD_MCP_TOOL_MANIFEST: readonly CloudMcpToolManifestEntry[] = [
  {
    name: "musefold_status",
    requiredScope: "account:read",
    readOnly: true,
    schemaRef: "empty-object",
    dataLimits: { responseBytes: 16_384 },
    rollout: "enabled",
    config: {
      title: "Musefold 状态",
      description: "Return redacted Cloud MCP connection and capability status.",
      inputSchema: {},
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "musefold_status", config, async () => {
        await deps.oauth.assertScope(auth, "account:read");
        return result({
          connected: true,
          surface: "cloud",
          clientId: auth.clientId,
          scopes: auth.scopes,
          resource: deps.resourceUrl,
          capabilities: ["account", "prompts", "official_skills"],
        });
      });
    },
  },
  {
    name: "get_account_status",
    requiredScope: "account:read",
    readOnly: true,
    schemaRef: "empty-object",
    dataLimits: { responseBytes: 16_384 },
    rollout: "enabled",
    config: {
      title: "账号状态",
      description:
        "Return a redacted account capability summary. Credentials and upstream tokens are never returned.",
      inputSchema: {},
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "get_account_status", config, async () => {
        await deps.oauth.assertScope(auth, "account:read");
        const grant = await deps.oauth.getGrant(auth.grantId);
        return result({
          ownerId: String(auth.ownerId),
          officialModelsAvailable: grant.allowedModelAliases.length > 0,
          quota: null,
          quotaUnit: "points",
          budget: {
            mode: grant.mode,
            maxPointsPerGeneration: grant.maxPointsPerGeneration,
            maxPointsPerDay: grant.maxPointsPerDay,
          },
        });
      });
    },
  },
  {
    name: "list_models",
    requiredScope: "account:read",
    readOnly: true,
    schemaRef: "empty-object",
    dataLimits: { maxItems: 32, responseBytes: 32_768 },
    rollout: "enabled",
    config: {
      title: "列出模型",
      description: "List the fixed cloud image model alias exposed to this grant.",
      inputSchema: {},
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "list_models", config, async () => {
        await deps.oauth.assertScope(auth, "account:read");
        const grant = await deps.oauth.getGrant(auth.grantId);
        return result({
          models: grant.allowedModelAliases.map((id) => ({
            id,
            kind: "image",
            sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
            qualities: ["auto", "low", "medium", "high"],
          })),
        });
      });
    },
  },
  {
    name: "search_prompts",
    requiredScope: "prompts:read",
    readOnly: true,
    schemaRef: "search-prompts-v1",
    dataLimits: { queryChars: 200, maxItems: 50, responseBytes: 262_144 },
    rollout: "enabled",
    config: {
      title: "搜索提示词",
      description: "Search the authenticated user cloud prompt library.",
      inputSchema: {
        q: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "search_prompts", config, async (args) => {
        await deps.oauth.assertScope(auth, "prompts:read");
        return result(
          await deps.prompts.listPrompts(auth.ownerId, {
            q: args.q,
            limit: args.limit ?? 20,
            includeDeleted: false,
            sort: "updated-desc",
          }),
        );
      });
    },
  },
  {
    name: "get_prompt",
    requiredScope: "prompts:read",
    readOnly: true,
    schemaRef: "get-prompt-v1",
    dataLimits: { idChars: 64, responseBytes: 262_144 },
    rollout: "enabled",
    config: {
      title: "读取提示词",
      description: "Read one authenticated user cloud prompt.",
      inputSchema: { id: z.string().min(1).max(64) },
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "get_prompt", config, async (args) => {
        await deps.oauth.assertScope(auth, "prompts:read");
        return result(await deps.prompts.getPrompt(auth.ownerId, args.id));
      });
    },
  },
  {
    name: "list_skills",
    requiredScope: "skills:read",
    readOnly: true,
    schemaRef: "empty-object",
    dataLimits: { maxItems: 100, responseBytes: 262_144 },
    rollout: "enabled",
    config: {
      title: "列出官方 Skills",
      description: "List published, audited, code-free Musefold visual skills.",
      inputSchema: {},
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "list_skills", config, async () => {
        await deps.oauth.assertScope(auth, "skills:read");
        return result({ skills: await deps.skills.list() });
      });
    },
  },
  {
    name: "get_skill",
    requiredScope: "skills:read",
    readOnly: true,
    schemaRef: "get-skill-v1",
    dataLimits: { idChars: 120, versionChars: 32, responseBytes: 524_288 },
    rollout: "enabled",
    config: {
      title: "读取官方 Skill",
      description:
        "Read one pinned official skill version, schema and content hash. The server never executes skill code.",
      inputSchema: {
        id: z.string().min(1).max(120),
        version: z.string().min(1).max(32),
      },
    },
    register: (server, { auth, deps }, config) => {
      registerTool(server, "get_skill", config, async (args) => {
        await deps.oauth.assertScope(auth, "skills:read");
        return result(await deps.skills.get(args.id, args.version));
      });
    },
  },
];

export const CLOUD_MCP_TOOL_NAMES = CLOUD_MCP_TOOL_MANIFEST.map(
  (entry) => entry.name,
);

export function enabledCloudMcpTools(
  scopes: readonly string[],
): readonly CloudMcpToolManifestEntry[] {
  return CLOUD_MCP_TOOL_MANIFEST.filter(
    (entry) => entry.rollout === "enabled" && scopes.includes(entry.requiredScope),
  );
}
