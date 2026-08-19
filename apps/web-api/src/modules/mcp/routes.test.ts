import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpRoutes } from "./routes.js";
import { SkillService } from "./skills.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const oauth = { verifyAccessToken: vi.fn() };
  const rateLimiter = { assertAllowed: vi.fn() };
  await app.register(mcpRoutes, {
    oauth: oauth as never,
    prompts: {} as never,
    generations: {} as never,
    skills: {} as never,
    credentials: {} as never,
    config: {
      PUBLIC_ORIGIN: "https://musefold.example",
      MCP_RESOURCE_URL: "https://musefold.example/api/musefold/mcp",
    },
    rateLimiter,
  });
  return { app, oauth, rateLimiter };
}

describe("Cloud MCP HTTP boundary", () => {
  it("validates official Skill inputs against the published JSON schema", () => {
    const service = new SkillService({} as never);
    const skill = {
      id: "postcard",
      version: "1.0.0",
      title: "明信片视觉",
      summary: "测试",
      content: "# Skill",
      inputSchema: {
        type: "object",
        properties: { subject: { type: "string", minLength: 1 } },
        required: ["subject"],
        additionalProperties: false,
      },
      contentHash: "sha256:" + "a".repeat(64),
    };
    expect(() => service.validateInputs(skill, { subject: "咖啡馆" })).not.toThrow();
    expect(() => service.validateInputs(skill, {})).toThrow("Skill 输入不符合 schema");
    expect(() => service.validateInputs(skill, { subject: "咖啡馆", extra: true })).toThrow(
      "Skill 输入不符合 schema",
    );
  });

  it("rejects browser origins outside the canonical Web origin before auth", async () => {
    const { app, oauth, rateLimiter } = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/musefold/mcp",
      headers: { origin: "https://evil.example" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "origin_not_allowed" });
    expect(oauth.verifyAccessToken).not.toHaveBeenCalled();
    expect(rateLimiter.assertAllowed).not.toHaveBeenCalled();
  });

  it("advertises protected resource metadata to non-browser MCP clients", async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/musefold/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="https://musefold.example/.well-known/oauth-protected-resource/api/musefold/mcp"',
    );
  });

  it("completes initialize, tools/list and tools/call with the official Streamable HTTP client", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const oauth = {
      verifyAccessToken: vi.fn().mockResolvedValue({
        token: "test-access-token",
        ownerId: 42,
        clientId: "sdk-client",
        grantId: "grant-1",
        scopes: [
          "account:read",
          "prompts:read",
          "prompts:write",
          "skills:read",
          "generations:read",
          "generations:write",
        ],
        resource: "http://127.0.0.1/api/musefold/mcp",
        expiresAt: Math.floor(Date.now() / 1_000) + 600,
      }),
      assertScope: vi.fn(),
      getGrant: vi.fn().mockResolvedValue({
        id: "grant-1",
        ownerId: 42,
        clientId: "sdk-client",
        scopes: ["account:read"],
        mode: "ask_each_time",
        maxPointsPerGeneration: 1_000,
        maxPointsPerDay: 10_000,
        allowedModelAliases: ["musefold-image-pro"],
        suspended: false,
      }),
    };
    const generationJob = {
      id: "01JTESTGENERATION0000000000",
      sessionId: null,
      parentRunId: null,
      promptId: null,
      actorType: "cloud_mcp",
      approvalStatus: "not_required",
      status: "succeeded",
      progress: 100,
      request: {
        prompt: "A quiet editorial still life",
        size: "1024x1024",
        quality: "high",
        count: 1,
      },
      providerModel: "musefold-image-pro",
      costPoints: 1_000,
      assets: [
        {
          id: "01JTESTASSET0000000000000",
          url: "/api/musefold/v1/assets/placeholder/url",
          mimeType: "image/png",
          width: 1024,
          height: 1024,
          byteSize: 2048,
          expiresAt: "2026-08-18T12:00:00.000Z",
        },
      ],
      error: null,
      createdAt: "2026-08-18T12:00:00.000Z",
      startedAt: "2026-08-18T12:00:01.000Z",
      finishedAt: "2026-08-18T12:00:02.000Z",
    };
    const generations = {
      createCloudMcp: vi.fn().mockResolvedValue({
        job: generationJob,
        approvalToken: null,
      }),
      assetSignedUrl: vi.fn().mockResolvedValue({
        url: "https://assets.example/result.png?signature=test",
        expiresAt: "2026-08-18T12:15:00.000Z",
      }),
    };
    await app.register(mcpRoutes, {
      oauth: oauth as never,
      prompts: {} as never,
      generations: generations as never,
      skills: {} as never,
      credentials: {} as never,
      config: {
        PUBLIC_ORIGIN: "https://musefold.example",
        MCP_RESOURCE_URL: "https://musefold.example/api/musefold/mcp",
      },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Fastify did not expose a TCP test address");

    const client = new Client({ name: "musefold-sdk-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/api/musefold/mcp`),
      {
        requestInit: {
          headers: { Authorization: "Bearer test-access-token" },
        },
      },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "musefold_status",
          "generate_image",
          "list_skills",
          "list_history",
        ]),
      );
      const status = await client.callTool({
        name: "musefold_status",
        arguments: {},
      });
      expect(status.structuredContent).toMatchObject({
        connected: true,
        surface: "cloud",
        clientId: "sdk-client",
      });
      const generated = await client.callTool({
        name: "generate_image",
        arguments: {
          idempotencyKey: "sdk-test-generation-1",
          prompt: "A quiet editorial still life",
          size: "1024x1024",
          quality: "high",
          maxPoints: 1_000,
        },
      });
      expect(generated.structuredContent).toMatchObject({
        id: generationJob.id,
        assets: [
          {
            id: generationJob.assets[0]?.id,
            url: "https://assets.example/result.png?signature=test",
            expiresAt: "2026-08-18T12:15:00.000Z",
            resourceUri: `musefold://assets/${generationJob.assets[0]?.id}`,
          },
        ],
      });
      expect(generated.content).toContainEqual(
        expect.objectContaining({
          type: "resource_link",
          uri: "https://assets.example/result.png?signature=test",
          mimeType: "image/png",
        }),
      );
      expect(oauth.verifyAccessToken).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
