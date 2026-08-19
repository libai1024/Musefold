import {
  syncBootstrapQuerySchema,
  syncDeviceRegistrationSchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
  syncUsagePushRequestSchema,
} from "@musefold/contracts";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { SessionStorePort } from "../account/session-store.js";
import {
  requireMusefoldCsrf,
  requireMusefoldSession,
} from "../auth/request-auth.js";
import {
  RATE_LIMIT_POLICIES,
  type RateLimiterPort,
} from "../rate-limit/service.js";
import type { SyncServicePort } from "./service.js";

interface SyncRoutesOptions {
  syncService: SyncServicePort;
  sessions: SessionStorePort;
  cookieName: string;
  rateLimiter?: RateLimiterPort;
}

export const syncRoutes: FastifyPluginAsync<SyncRoutesOptions> = async (
  app,
  options,
) => {
  const auth = requireMusefoldSession(options.sessions, options.cookieName);
  const rateLimit = async (request: FastifyRequest) =>
    options.rateLimiter?.assertAllowed(
      "prompt-sync",
      String(request.musefoldPrincipal.ownerId),
      RATE_LIMIT_POLICIES.promptSync,
    );

  app.post(
    "/api/musefold/v1/sync/devices",
    {
      preHandler: [auth, requireMusefoldCsrf, rateLimit],
      schema: { tags: ["sync"], body: syncDeviceRegistrationSchema },
    },
    async (request, reply) => {
      const result = await options.syncService.registerDevice(
        request.musefoldPrincipal.ownerId,
        syncDeviceRegistrationSchema.parse(request.body),
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/api/musefold/v1/sync/bootstrap",
    {
      preHandler: [auth, rateLimit],
      schema: { tags: ["sync"], querystring: syncBootstrapQuerySchema },
    },
    async (request) => {
      const query = syncBootstrapQuerySchema.parse(
        normalizeQuery(request.query as Record<string, unknown>),
      );
      return options.syncService.bootstrap(
        request.musefoldPrincipal.ownerId,
        query.entity,
        query.after,
        query.limit,
      );
    },
  );

  app.get(
    "/api/musefold/v1/sync/pull",
    {
      preHandler: [auth, rateLimit],
      schema: { tags: ["sync"], querystring: syncPullQuerySchema },
    },
    async (request) => {
      const query = syncPullQuerySchema.parse(
        normalizeQuery(request.query as Record<string, unknown>),
      );
      return options.syncService.pull(
        request.musefoldPrincipal.ownerId,
        query.cursor,
        query.limit,
        query.deviceId,
      );
    },
  );

  app.post(
    "/api/musefold/v1/sync/push",
    {
      bodyLimit: 512 * 1024,
      preHandler: [auth, requireMusefoldCsrf, rateLimit],
      schema: { tags: ["sync"], body: syncPushRequestSchema },
    },
    async (request) => {
      const body = syncPushRequestSchema.parse(request.body);
      return options.syncService.push(
        request.musefoldPrincipal.ownerId,
        body.deviceId,
        body.mutations,
      );
    },
  );

  app.post(
    "/api/musefold/v1/sync/usage",
    {
      bodyLimit: 128 * 1024,
      preHandler: [auth, requireMusefoldCsrf, rateLimit],
      schema: { tags: ["sync"], body: syncUsagePushRequestSchema },
    },
    async (request) => {
      const body = syncUsagePushRequestSchema.parse(request.body);
      return options.syncService.pushUsage(
        request.musefoldPrincipal.ownerId,
        body.deviceId,
        body.events,
      );
    },
  );

  app.get(
    "/api/musefold/v1/sync/status",
    { preHandler: [auth, rateLimit] },
    async (request) => {
      const deviceId = String(
        (request.query as { deviceId?: string }).deviceId ?? "",
      );
      return options.syncService.status(
        request.musefoldPrincipal.ownerId,
        deviceId,
      );
    },
  );
};

function normalizeQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...query,
    limit: typeof query.limit === "string" ? Number(query.limit) : query.limit,
  };
}
