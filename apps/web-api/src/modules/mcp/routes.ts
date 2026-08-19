import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyPluginAsync } from "fastify";
import type { WebApiConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import type { AccountCredentialStorePort } from "../account/credential-store.js";
import type { GenerationServicePort } from "../generation/service.js";
import type { PromptServicePort } from "../prompts/service.js";
import { OAuthService } from "../oauth/service.js";
import { createCloudMcpServer } from "./server.js";
import { SkillService } from "./skills.js";
import {
  RATE_LIMIT_POLICIES,
  type RateLimiterPort,
} from "../rate-limit/service.js";

interface McpRoutesOptions {
  oauth: OAuthService;
  prompts: PromptServicePort;
  generations: GenerationServicePort;
  skills: SkillService;
  credentials: AccountCredentialStorePort;
  config: Pick<WebApiConfig, "PUBLIC_ORIGIN" | "MCP_RESOURCE_URL">;
  rateLimiter?: RateLimiterPort;
}

export const mcpRoutes: FastifyPluginAsync<McpRoutesOptions> = async (
  app,
  options,
) => {
  app.post(
    "/api/musefold/mcp",
    { bodyLimit: 512 * 1024 },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (
        typeof origin === "string" &&
        origin !== new URL(options.config.PUBLIC_ORIGIN).origin
      ) {
        return reply.code(403).send({ error: "origin_not_allowed" });
      }
      await options.rateLimiter?.assertAllowed(
        "cloud-mcp:ip",
        request.ip,
        RATE_LIMIT_POLICIES.cloudMcpIp,
      );
      const auth = await authenticate(
        request.headers.authorization,
        options.oauth,
        options.config.MCP_RESOURCE_URL,
        reply,
      );
      if (!auth) return;
      await options.rateLimiter?.assertAllowed(
        "cloud-mcp",
        `${auth.ownerId}:${auth.grantId}`,
        RATE_LIMIT_POLICIES.cloudMcp,
      );
      const server = createCloudMcpServer(auth, {
        oauth: options.oauth,
        prompts: options.prompts,
        generations: options.generations,
        skills: options.skills,
        credentials: options.credentials,
        publicOrigin: options.config.PUBLIC_ORIGIN,
        resourceUrl: options.config.MCP_RESOURCE_URL,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      reply.hijack();
      request.raw.on("close", () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.error({ err: error }, "Cloud MCP request failed");
        if (!reply.raw.headersSent)
          reply.raw.writeHead(500, { "Content-Type": "application/json" });
        if (!reply.raw.writableEnded)
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "MCP request failed" },
              id: null,
            }),
          );
      }
    },
  );

  app.get("/api/musefold/mcp", async (_request, reply) =>
    reply
      .code(405)
      .header("Allow", "POST")
      .send({ error: "MCP requires POST Streamable HTTP requests" }),
  );
  app.delete("/api/musefold/mcp", async (_request, reply) =>
    reply
      .code(405)
      .header("Allow", "POST")
      .send({ error: "Stateless MCP sessions cannot be deleted" }),
  );
};

async function authenticate(
  authorization: string | undefined,
  oauth: OAuthService,
  resource: string,
  reply: {
    code(statusCode: number): {
      header(name: string, value: string): { send(payload: unknown): unknown };
    };
  },
): Promise<Awaited<ReturnType<OAuthService["verifyAccessToken"]>> | null> {
  const metadataUrl = protectedResourceMetadataUrl(resource);
  if (!authorization?.startsWith("Bearer ")) {
    reply
      .code(401)
      .header("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
      .send({ error: "unauthorized" });
    return null;
  }
  try {
    return await oauth.verifyAccessToken(
      authorization.slice(7).trim(),
      resource,
    );
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("OAUTH_INVALID_GRANT", "MCP access token 无效", 401);
    reply
      .code(401)
      .header("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
      .send({ error: appError.message });
    return null;
  }
}

function protectedResourceMetadataUrl(resource: string): string {
  const target = new URL(resource);
  return new URL(
    "/.well-known/oauth-protected-resource" +
      (target.pathname === "/" ? "" : target.pathname),
    target.origin,
  ).toString();
}
