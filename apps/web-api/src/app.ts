import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import swagger from "@fastify/swagger";
import { createNewApiClient } from "@musefold/new-api-client";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { WebApiConfig } from "./config.js";
import { DatabaseRuntime, type ReadinessProbe } from "./database/runtime.js";
import { AppError, toErrorResponse } from "./errors.js";
import { accountRoutes } from "./modules/account/routes.js";
import { AccountService } from "./modules/account/service.js";
import { SessionStore } from "./modules/account/session-store.js";
import { AccountCredentialStore } from "./modules/account/credential-store.js";
import { promptRoutes } from "./modules/prompts/routes.js";
import { PromptService } from "./modules/prompts/service.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { SyncService } from "./modules/sync/service.js";
import { workbenchRoutes } from "./modules/workbench/routes.js";
import { WorkbenchService } from "./modules/workbench/service.js";
import { generationRoutes } from "./modules/generation/routes.js";
import { GenerationService } from "./modules/generation/service.js";
import { S3AssetUrlSigner } from "./storage/s3-signer.js";
import { healthRoutes } from "./modules/health/routes.js";
import { oauthRoutes } from "./modules/oauth/routes.js";
import { OAuthService } from "./modules/oauth/service.js";
import { createCloudOidcProvider } from "./modules/oauth/provider.js";
import { mcpRoutes } from "./modules/mcp/routes.js";
import { SkillService } from "./modules/mcp/skills.js";
import { PostgresRateLimiter } from "./modules/rate-limit/service.js";

export interface BuildWebApiOptions {
  config: WebApiConfig;
  readinessProbe?: ReadinessProbe;
}

export async function buildWebApi(
  options: BuildWebApiOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: options.config.TRUST_PROXY,
    logger:
      options.config.LOG_LEVEL === "silent"
        ? false
        : {
            level: options.config.LOG_LEVEL,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
                "*.password",
                "*.reauthPassword",
                "*.token",
                "*.refreshToken",
                "*.code",
                "*.prompt",
                "*.negative",
              ],
              censor: "[REDACTED]",
            },
          },
    genReqId: (request) => {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && supplied.length <= 128
        ? supplied
        : randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await app.register(formbody);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (
        error.code === "RATE_LIMITED" &&
        typeof error.details.retryAfterSeconds === "number"
      ) {
        reply.header(
          "Retry-After",
          String(Math.max(1, Math.ceil(error.details.retryAfterSeconds))),
        );
      }
      return reply
        .code(error.statusCode)
        .send(toErrorResponse(error, request.id));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const validationError = new AppError(
        "VALIDATION_FAILED",
        "请求参数不符合接口约束",
        400,
        false,
        { issues: error.validation },
      );
      return reply.code(400).send(toErrorResponse(validationError, request.id));
    }

    request.log.error({ err: error }, "Unhandled request error");
    const internalError = new AppError(
      "INTERNAL_ERROR",
      "服务暂时不可用",
      500,
      true,
    );
    return reply.code(500).send(toErrorResponse(internalError, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new AppError("VALIDATION_FAILED", "接口不存在", 404);
    return reply.code(404).send(toErrorResponse(error, request.id));
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Musefold Web API",
        version: "1.1.0",
      },
      servers: [{ url: options.config.PUBLIC_ORIGIN }],
    },
    transform: jsonSchemaTransform,
  });

  if (options.config.OPENAPI_ENABLED) {
    app.get(
      "/api/musefold/v1/openapi.json",
      {
        schema: { hide: true },
      },
      async () => app.swagger(),
    );
  }

  const database = options.readinessProbe
    ? null
    : new DatabaseRuntime(options.config);
  const readinessProbe = options.readinessProbe ?? database;
  if (!readinessProbe) throw new Error("Readiness probe is required");

  if (database) {
    try {
      await database.generationEvents.start();
    } catch (error) {
      app.log.warn(
        { err: error },
        "generation LISTEN unavailable; SSE will use bounded event polling",
      );
    }
    app.addHook("onClose", async () => database.close());
    app.decorateRequest(
      "musefoldPrincipal",
      undefined as unknown as import("./modules/auth/request-auth.js").MusefoldPrincipal,
    );
    const sessions = new SessionStore(database.db, options.config);
    const credentials = new AccountCredentialStore(database.db, options.config);
    const accountService = new AccountService(
      createNewApiClient(options.config.NEW_API_BASE_URL),
      sessions,
      credentials,
    );
    const promptService = new PromptService(database.db);
    const oauthService = new OAuthService(database.db);
    const oidcProvider = createCloudOidcProvider(database.db, options.config);
    oauthService.attachProvider(oidcProvider);
    const generationService = new GenerationService(
      database.db,
      new S3AssetUrlSigner(options.config),
      options.config.SESSION_ENCRYPTION_KEY,
    );
    const rateLimiter = new PostgresRateLimiter(
      database.db,
      options.config.SESSION_ENCRYPTION_KEY,
    );
    await app.register(accountRoutes, {
      accountService,
      config: options.config,
      rateLimiter,
    });
    await app.register(promptRoutes, {
      promptService,
      sessions,
      cookieName: options.config.SESSION_COOKIE_NAME,
    });
    await app.register(syncRoutes, {
      syncService: new SyncService(database.db, promptService),
      sessions,
      cookieName: options.config.SESSION_COOKIE_NAME,
      rateLimiter,
    });
    await app.register(workbenchRoutes, {
      service: new WorkbenchService(database.db),
      sessions,
      cookieName: options.config.SESSION_COOKIE_NAME,
    });
    await app.register(generationRoutes, {
      service: generationService,
      sessions,
      cookieName: options.config.SESSION_COOKIE_NAME,
      events: database.generationEvents,
    });
    await app.register(oauthRoutes, {
      service: oauthService,
      provider: oidcProvider,
      sessions,
      cookieName: options.config.SESSION_COOKIE_NAME,
      publicOrigin: options.config.PUBLIC_ORIGIN,
      resourceUrl: options.config.MCP_RESOURCE_URL,
      accountService,
      rateLimiter,
    });
    await app.register(mcpRoutes, {
      oauth: oauthService,
      prompts: promptService,
      generations: generationService,
      skills: new SkillService(database.db),
      credentials,
      config: options.config,
      rateLimiter,
    });
  }

  await app.register(healthRoutes, { readinessProbe });
  return app;
}
