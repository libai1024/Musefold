import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateGenerationInput, GenerationJob } from "@musefold/contracts";
import {
  cloudGenerationRequestSchema,
  newPromptDocumentSchema,
} from "@musefold/contracts";
import type { AccountCredentialStorePort } from "../account/credential-store.js";
import type { GenerationServicePort } from "../generation/service.js";
import type { PromptServicePort } from "../prompts/service.js";
import type { McpAuthInfo, OAuthService } from "../oauth/service.js";
import { SkillService } from "./skills.js";

interface CloudMcpDependencies {
  oauth: OAuthService;
  prompts: PromptServicePort;
  generations: GenerationServicePort;
  skills: SkillService;
  credentials: AccountCredentialStorePort;
  publicOrigin: string;
  resourceUrl: string;
}

const GENERATION_COST_POINTS = 1_000;
const tool = (
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  handler: (args: any) => Promise<unknown>,
) => {
  (
    server.registerTool as unknown as (
      name: string,
      config: unknown,
      handler: unknown,
    ) => void
  )(name, config, handler);
};

export function createCloudMcpServer(
  auth: McpAuthInfo,
  deps: CloudMcpDependencies,
): McpServer {
  const server = new McpServer(
    { name: "musefold-cloud", version: "1.1.0-dev" },
    {
      instructions:
        "Musefold Cloud MCP only handles cloud-safe account, prompt, official skill, generation and history tools. Never request or return credentials or local file paths.",
    },
  );

  tool(
    server,
    "musefold_status",
    {
      title: "Musefold 状态",
      description:
        "Return redacted Cloud MCP connection and capability status.",
      inputSchema: {},
    },
    async () => {
      await deps.oauth.assertScope(auth, "account:read");
      return result({
        connected: true,
        surface: "cloud",
        clientId: auth.clientId,
        scopes: auth.scopes,
        resource: deps.resourceUrl,
        capabilities: [
          "account",
          "prompts",
          "official_skills",
          "generation",
          "history",
        ],
      });
    },
  );

  tool(
    server,
    "get_account_status",
    {
      title: "账号状态",
      description:
        "Return a redacted account capability summary. Credentials and upstream tokens are never returned.",
      inputSchema: {},
    },
    async () => {
      await deps.oauth.assertScope(auth, "account:read");
      const credential = await deps.credentials.get(auth.ownerId);
      const grant = await deps.oauth.getGrant(auth.grantId);
      return result({
        ownerId: String(auth.ownerId),
        canGenerate: Boolean(credential),
        quota: null,
        quotaUnit: "points",
        budget: {
          mode: grant.mode,
          maxPointsPerGeneration: grant.maxPointsPerGeneration,
          maxPointsPerDay: grant.maxPointsPerDay,
        },
      });
    },
  );

  tool(
    server,
    "list_models",
    {
      title: "列出模型",
      description:
        "List the fixed cloud image model alias exposed to this grant.",
      inputSchema: {},
    },
    async () => {
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
    },
  );

  tool(
    server,
    "search_prompts",
    {
      title: "搜索提示词",
      description: "Search the authenticated user cloud prompt library.",
      inputSchema: {
        q: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "prompts:read");
      return result(
        await deps.prompts.listPrompts(auth.ownerId, {
          q: args.q,
          limit: args.limit ?? 20,
          includeDeleted: false,
          sort: "updated-desc",
        }),
      );
    },
  );

  tool(
    server,
    "get_prompt",
    {
      title: "读取提示词",
      description: "Read one authenticated user cloud prompt.",
      inputSchema: { id: z.string().min(1).max(64) },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "prompts:read");
      return result(await deps.prompts.getPrompt(auth.ownerId, args.id));
    },
  );

  tool(
    server,
    "save_prompt",
    {
      title: "保存提示词",
      description:
        "Save an AI-created prompt to the authenticated user cloud library.",
      inputSchema: {
        title: z.string().min(1).max(80),
        content: z.string().min(1).max(12_000),
        description: z.string().max(500).optional(),
        negative: z.string().max(4_000).optional(),
      },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "prompts:write");
      const input = newPromptDocumentSchema.parse({
        title: args.title,
        content: args.content,
        description: args.description ?? null,
        negative: args.negative ?? null,
        folderId: null,
        tagIds: [],
        modelId: null,
        params: null,
        rating: 0,
        isPinned: false,
        source: "generation",
        sourceUrl: null,
      });
      return result(await deps.prompts.createPrompt(auth.ownerId, input));
    },
  );

  tool(
    server,
    "list_skills",
    {
      title: "列出官方 Skills",
      description: "List published, audited, code-free Musefold visual skills.",
      inputSchema: {},
    },
    async () => {
      await deps.oauth.assertScope(auth, "skills:read");
      return result({ skills: await deps.skills.list() });
    },
  );

  tool(
    server,
    "get_skill",
    {
      title: "读取官方 Skill",
      description:
        "Read one pinned official skill version, schema and content hash. The server never executes skill code.",
      inputSchema: {
        id: z.string().min(1).max(120),
        version: z.string().min(1).max(32),
      },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "skills:read");
      return result(await deps.skills.get(args.id, args.version));
    },
  );

  tool(
    server,
    "estimate_generation",
    {
      title: "估算生图",
      description: "Estimate points without creating a job or reserving quota.",
      inputSchema: {
        prompt: z.string().min(1).max(12_000),
        size: z.string().optional(),
        quality: z.string().optional(),
      },
    },
    async () => {
      await deps.oauth.assertScope(auth, "generations:read");
      return result({
        estimatedPoints: GENERATION_COST_POINTS,
        currency: "points",
        count: 1,
        model: "musefold-image-pro",
      });
    },
  );

  tool(
    server,
    "generate_image",
    {
      title: "云端生图",
      description:
        "Create one cloud image job. It enters Web approval unless the connected grant has an automatic budget that covers it.",
      inputSchema: {
        idempotencyKey: z.string().min(8).max(128),
        prompt: z.string().min(1).max(12_000),
        negative: z.string().max(4_000).optional(),
        size: z
          .enum(["auto", "1024x1024", "1536x1024", "1024x1536"])
          .optional(),
        aspectRatio: z
          .string()
          .regex(/^\d{1,2}:\d{1,2}$/)
          .optional(),
        quality: z.enum(["auto", "low", "medium", "high"]).optional(),
        maxPoints: z.number().int().min(1),
        promptId: z.string().max(64).optional(),
        skillRef: z
          .object({
            id: z.string().max(120),
            version: z.string().max(32),
            contentHash: z.string().length(71),
          })
          .optional(),
        skillInputs: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
      },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "generations:write");
      const grant = await deps.oauth.getGrant(auth.grantId);
      if (args.maxPoints < GENERATION_COST_POINTS)
        return result({
          status: "rejected",
          reason: "MCP_BUDGET_EXCEEDED",
          estimatedPoints: GENERATION_COST_POINTS,
          approvalUrl: null,
        });
      if (!grant.allowedModelAliases.includes("musefold-image-pro"))
        return result({
          status: "rejected",
          reason: "model_not_allowed",
          estimatedPoints: GENERATION_COST_POINTS,
          approvalUrl: null,
        });
      let skill:
        | {
            id: string;
            version: string;
            contentHash: string;
            inputs: Record<string, unknown>;
          }
        | undefined;
      if (args.skillRef) {
        const loaded = await deps.skills.get(
          args.skillRef.id,
          args.skillRef.version,
        );
        if (loaded.contentHash !== args.skillRef.contentHash)
          throw new Error("Skill 内容 hash 不匹配，请重新读取 Skill");
        deps.skills.validateInputs(loaded, args.skillInputs ?? {});
        skill = {
          id: loaded.id,
          version: loaded.version,
          contentHash: loaded.contentHash,
          inputs: args.skillInputs ?? {},
        };
      }
      const input: CreateGenerationInput = cloudGenerationRequestSchema.parse({
        prompt: args.prompt,
        negative: args.negative,
        size: args.size ?? "auto",
        aspectRatio: args.aspectRatio,
        quality: args.quality ?? "auto",
        promptId: args.promptId,
        count: 1,
      });
      const created = await deps.generations.createCloudMcp(
        auth.ownerId,
        input,
        args.idempotencyKey,
        {
          grantId: auth.grantId,
          approvalRequired:
            grant.mode !== "auto_with_limits" ||
            grant.maxPointsPerGeneration < GENERATION_COST_POINTS,
          skill,
        },
      );
      const approvalUrl = created.approvalToken
        ? deps.publicOrigin +
          "/Musefold/app/approvals/" +
          encodeURIComponent(created.job.id) +
          "?token=" +
          encodeURIComponent(created.approvalToken)
        : null;
      return result(
        await cloudJob(created.job, auth.ownerId, deps, { approvalUrl, skill }),
      );
    },
  );

  tool(
    server,
    "get_generation",
    {
      title: "查询云端生图",
      description: "Read one cloud generation and refresh signed asset URLs.",
      inputSchema: { jobId: z.string().min(1).max(64) },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "generations:read");
      return result(
        await cloudJob(
          await deps.generations.get(auth.ownerId, args.jobId),
          auth.ownerId,
          deps,
        ),
      );
    },
  );

  tool(
    server,
    "wait_for_generation",
    {
      title: "等待云端生图",
      description:
        "Wait for at most 25 seconds and return the current durable job state.",
      inputSchema: { jobId: z.string().min(1).max(64) },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "generations:read");
      let job = await deps.generations.get(auth.ownerId, args.jobId);
      for (
        let attempt = 0;
        attempt < 25 &&
        ["queued", "running", "cancelling"].includes(job.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        job = await deps.generations.get(auth.ownerId, args.jobId);
      }
      return result(await cloudJob(job, auth.ownerId, deps));
    },
  );

  tool(
    server,
    "cancel_generation",
    {
      title: "取消云端生图",
      description:
        "Best-effort cancellation of an authenticated cloud generation.",
      inputSchema: { jobId: z.string().min(1).max(64) },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "generations:write");
      return result(
        await cloudJob(
          await deps.generations.cancel(auth.ownerId, args.jobId),
          auth.ownerId,
          deps,
        ),
      );
    },
  );

  tool(
    server,
    "list_history",
    {
      title: "列出云端历史",
      description:
        "List the authenticated user generation history with short-lived asset URLs.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().max(1024).optional(),
      },
    },
    async (args) => {
      await deps.oauth.assertScope(auth, "generations:read");
      const page = await deps.generations.history(auth.ownerId, {
        limit: args.limit ?? 20,
        cursor: args.cursor,
        includeDeleted: false,
      });
      return result({
        ...page,
        items: await Promise.all(
          page.items.map((job) => cloudJob(job, auth.ownerId, deps)),
        ),
      });
    },
  );

  return server;
}

async function cloudJob(
  job: GenerationJob,
  ownerId: number,
  deps: CloudMcpDependencies,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const assets = await Promise.all(
    job.assets.map(async (asset) => {
      const signed = await deps.generations.assetSignedUrl(ownerId, asset.id);
      return {
        ...asset,
        url: signed.url,
        expiresAt: signed.expiresAt,
        resourceUri: `musefold://assets/${encodeURIComponent(asset.id)}`,
      };
    }),
  );
  return { ...job, assets, ...extra };
}

function result(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    structuredContent: value,
    content: [
      { type: "text" as const, text: JSON.stringify(value) },
      ...assetResourceLinks(value),
    ],
  };
}

function assetResourceLinks(value: unknown) {
  const root = record(value);
  if (!root) return [];
  const containers = [
    root,
    ...(Array.isArray(root.items)
      ? root.items.flatMap((item) => (record(item) ? [record(item)!] : []))
      : []),
  ];
  return containers.flatMap((container) => {
    if (!Array.isArray(container.assets)) return [];
    return container.assets.flatMap((candidate) => {
      const asset = record(candidate);
      if (
        !asset ||
        typeof asset.id !== "string" ||
        typeof asset.url !== "string" ||
        !/^https?:\/\//.test(asset.url) ||
        typeof asset.mimeType !== "string"
      ) {
        return [];
      }
      return [
        {
          type: "resource_link" as const,
          uri: asset.url,
          name: `musefold-${asset.id}.${assetExtension(asset.mimeType)}`,
          mimeType: asset.mimeType,
          description:
            typeof asset.expiresAt === "string"
              ? `Musefold generated image; signed URL expires at ${asset.expiresAt}`
              : "Musefold generated image",
        },
      ];
    });
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assetExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}
