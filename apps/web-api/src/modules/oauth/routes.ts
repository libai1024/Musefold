import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type Provider from "oidc-provider";
import { z } from "zod";
import { AppError } from "../../errors.js";
import type { SessionStorePort } from "../account/session-store.js";
import type { AccountService } from "../account/service.js";
import {
  requireMusefoldCsrf,
  requireMusefoldSession,
} from "../auth/request-auth.js";
import { OAUTH_INTERACTION_PATH, OAUTH_PATH } from "./provider.js";
import { MCP_SCOPES, OAuthService, type McpScope } from "./service.js";
import { updateMcpConnectionSchema } from "@musefold/contracts";
import {
  RATE_LIMIT_POLICIES,
  type RateLimiterPort,
} from "../rate-limit/service.js";

interface OAuthRoutesOptions {
  service: OAuthService;
  provider: Provider;
  sessions: SessionStorePort;
  cookieName: string;
  publicOrigin: string;
  resourceUrl: string;
  accountService: AccountService;
  rateLimiter?: RateLimiterPort;
}

const interactionParamsSchema = z.object({ uid: z.string().min(1).max(128) });
const interactionBodySchema = z.object({
  csrf: z.string().min(32),
  decision: z.enum(["approve", "deny"]),
});

export const oauthRoutes: FastifyPluginAsync<OAuthRoutesOptions> = async (
  app,
  options,
) => {
  app.get(`${OAUTH_INTERACTION_PATH}/:uid`, async (request, reply) => {
    const params = interactionParamsSchema.parse(request.params);
    const interaction = await getInteractionDetails(
      options.provider,
      request,
      reply,
    );
    if (interaction.uid !== params.uid) {
      throw new AppError("OAUTH_INVALID_GRANT", "OAuth 交互状态无效", 400);
    }

    const session = await getWebSession(request, options);
    if (!session) {
      const returnTo = `${options.publicOrigin}${request.raw.url ?? ""}`;
      return reply.redirect(
        `${options.publicOrigin}/Musefold/app/login?returnTo=${encodeURIComponent(returnTo)}`,
      );
    }

    const clientId = stringParam(interaction.params.client_id);
    const client = await options.provider.Client.find(clientId);
    const scopes = parseMcpScopes(stringParam(interaction.params.scope));
    return reply.type("text/html; charset=utf-8").send(
      renderConsent({
        clientName: client?.clientName ?? clientId,
        scopes,
        csrfToken: session.csrfToken,
      }),
    );
  });

  app.post(`${OAUTH_INTERACTION_PATH}/:uid`, async (request, reply) => {
    const params = interactionParamsSchema.parse(request.params);
    const body = interactionBodySchema.parse(request.body);
    const rawSessionId = request.cookies?.[options.cookieName];
    if (!rawSessionId) {
      throw new AppError("AUTH_REQUIRED", "请先登录 Musefold", 401);
    }
    const session = await options.sessions.get(rawSessionId);
    if (!session || session.csrfToken !== body.csrf) {
      throw new AppError("VALIDATION_FAILED", "OAuth consent 验证失败", 403);
    }
    const interaction = await getInteractionDetails(
      options.provider,
      request,
      reply,
    );
    if (interaction.uid !== params.uid) {
      throw new AppError("OAUTH_INVALID_GRANT", "OAuth 交互状态无效", 400);
    }

    reply.hijack();
    if (body.decision === "deny") {
      await options.provider.interactionFinished(
        request.raw,
        reply.raw,
        {
          error: "access_denied",
          error_description: "用户拒绝了 Musefold Cloud MCP 授权",
        },
        { mergeWithLastSubmission: false },
      );
      return;
    }

    const clientId = stringParam(interaction.params.client_id);
    const scopes = parseMcpScopes(stringParam(interaction.params.scope));
    const grant = await options.service.ensureGrant(
      session.ownerId,
      clientId,
      scopes,
    );
    const providerGrant = new options.provider.Grant({
      accountId: String(session.ownerId),
      clientId,
    });
    providerGrant.jti = grant.id;
    providerGrant.addResourceScope(options.resourceUrl, scopes);
    await providerGrant.save();

    await options.provider.interactionFinished(
      request.raw,
      reply.raw,
      {
        login: {
          accountId: String(session.ownerId),
          acr: "urn:musefold:password",
          amr: ["pwd"],
        },
        consent: { grantId: grant.id },
      },
      { mergeWithLastSubmission: false },
    );
  });

  registerProviderBridge(app, options.provider);

  const webAuth = requireMusefoldSession(options.sessions, options.cookieName);
  app.get(
    "/api/musefold/v1/connections",
    { preHandler: webAuth },
    async (request) => ({
      items: await options.service.listConnections(
        request.musefoldPrincipal.ownerId,
      ),
    }),
  );

  app.patch(
    "/api/musefold/v1/connections/:id",
    {
      preHandler: [webAuth, requireMusefoldCsrf],
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateMcpConnectionSchema.parse(request.body);
      let reauthenticated = false;
      if (body.reauthPassword) {
        await options.rateLimiter?.assertAllowed(
          "account:reauth",
          String(request.musefoldPrincipal.ownerId),
          RATE_LIMIT_POLICIES.accountReauth,
        );
        await options.accountService.reauthenticate(
          request.musefoldPrincipal.ownerId,
          request.musefoldPrincipal.username,
          body.reauthPassword,
        );
        reauthenticated = true;
      }
      const { reauthPassword: _reauthPassword, ...policy } = body;
      await options.service.updateConnection(
        request.musefoldPrincipal.ownerId,
        params.id,
        policy,
        reauthenticated,
      );
      return {
        items: await options.service.listConnections(
          request.musefoldPrincipal.ownerId,
        ),
      };
    },
  );

  app.delete(
    "/api/musefold/v1/connections/:id",
    {
      preHandler: [webAuth, requireMusefoldCsrf],
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await options.service.revokeConnection(
        request.musefoldPrincipal.ownerId,
        params.id,
      );
      return reply.code(204).send();
    },
  );

  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: options.resourceUrl,
    authorization_servers: [options.publicOrigin],
    scopes_supported: MCP_SCOPES,
  }));
  app.get(
    "/.well-known/oauth-protected-resource/api/musefold/mcp",
    async () => ({
      resource: options.resourceUrl,
      authorization_servers: [options.publicOrigin],
      scopes_supported: MCP_SCOPES,
    }),
  );
};

function registerProviderBridge(
  app: Parameters<FastifyPluginAsync<OAuthRoutesOptions>>[0],
  provider: Provider,
): void {
  const callback = provider.callback();
  const urls = [
    `${OAUTH_PATH}/*`,
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ];
  for (const url of urls) {
    app.route({
      method: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      url,
      onRequest: async (request, reply) => {
        reply.hijack();
        try {
          await callback(request.raw, reply.raw);
        } catch (error) {
          request.log.error({ err: error }, "OAuth provider request failed");
          if (!reply.raw.headersSent) {
            reply.raw.writeHead(500, { "content-type": "application/json" });
          }
          if (!reply.raw.writableEnded) {
            reply.raw.end(JSON.stringify({ error: "server_error" }));
          }
        }
      },
      handler: async () => undefined,
    });
  }
}

async function getWebSession(
  request: FastifyRequest,
  options: OAuthRoutesOptions,
) {
  const rawSessionId = request.cookies?.[options.cookieName];
  return rawSessionId ? options.sessions.get(rawSessionId) : null;
}

async function getInteractionDetails(
  provider: Provider,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    return await provider.interactionDetails(request.raw, reply.raw);
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name === "SessionNotFound") {
      throw new AppError(
        "OAUTH_INVALID_GRANT",
        "OAuth 交互会话已失效，请重新发起 MCP 授权",
        400,
      );
    }
    throw error;
  }
}

function stringParam(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new AppError("OAUTH_INVALID_GRANT", "OAuth 参数无效", 400);
  }
  return value;
}

function parseMcpScopes(value: string): McpScope[] {
  const requested = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (
    requested.some(
      (scope) =>
        !(MCP_SCOPES as readonly string[]).includes(scope) &&
        !["offline_access", "openid"].includes(scope),
    )
  ) {
    throw new AppError(
      "OAUTH_SCOPE_INSUFFICIENT",
      "请求了未开放的 MCP scope",
      400,
    );
  }
  const scopes = requested.filter((scope): scope is McpScope =>
    (MCP_SCOPES as readonly string[]).includes(scope),
  );
  if (!scopes.length) {
    throw new AppError("OAUTH_SCOPE_INSUFFICIENT", "没有可用的 MCP scope", 400);
  }
  return scopes;
}

function renderConsent(input: {
  clientName: string;
  scopes: string[];
  csrfToken: string;
}): string {
  const scopes = input.scopes.map(escapeHtml).join(", ");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 Musefold</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f4f6f8;color:#18212b;margin:0;padding:48px 20px}.panel{max-width:480px;margin:auto;background:#fff;border:1px solid #dfe4e8;border-radius:8px;padding:28px;box-shadow:0 8px 24px #18212b14}h1{font-size:24px;margin:0 0 12px}p{line-height:1.6}.scopes{background:#f4f6f8;border-radius:6px;padding:12px;word-break:break-word}.actions{display:flex;gap:12px;margin-top:24px}button{border:0;border-radius:6px;padding:11px 18px;font-size:15px;cursor:pointer}button[name=decision][value=approve]{background:#155eef;color:#fff}button[name=decision][value=deny]{background:#e9edf1;color:#18212b}</style><main class="panel"><h1>连接 ${escapeHtml(input.clientName)}</h1><p>该 AI 客户端请求访问你的 Musefold 云端能力：</p><p class="scopes">${scopes}</p><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(input.csrfToken)}"><div class="actions"><button name="decision" value="approve">允许访问</button><button name="decision" value="deny">拒绝</button></div></form></main></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}
