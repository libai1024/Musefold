import type { AccountSession } from "@musefold/contracts";
import {
  accountSessionSchema,
  desktopAccountSessionSchema,
  loginRequestSchema,
  redeemRequestSchema,
  redeemResultSchema,
  registerRequestSchema,
} from "@musefold/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { WebApiConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import type { AccountService } from "./service.js";
import {
  RATE_LIMIT_POLICIES,
  type RateLimiterPort,
} from "../rate-limit/service.js";

interface AccountRoutesOptions {
  accountService: AccountService;
  config: Pick<
    WebApiConfig,
    "NODE_ENV" | "SESSION_COOKIE_NAME" | "SESSION_ABSOLUTE_TTL_SECONDS"
  >;
  rateLimiter?: RateLimiterPort;
}

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (
  app,
  options,
) => {
  const cookieOptions = {
    httpOnly: true,
    secure: options.config.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: options.config.SESSION_ABSOLUTE_TTL_SECONDS,
  };

  app.post(
    "/api/musefold/v1/auth/device-session",
    {
      schema: {
        tags: ["account"],
        headers: z
          .object({ authorization: z.string().min(16).max(8_192) })
          .passthrough(),
        response: { 200: desktopAccountSessionSchema },
      },
    },
    async (request) => {
      await options.rateLimiter?.assertAllowed(
        "account:desktop-session",
        request.ip,
        RATE_LIMIT_POLICIES.desktopSession,
      );
      const result = await options.accountService.openDesktopSession(
        requireBearer(request.headers.authorization),
      );
      return {
        ...publicSession(result),
        sessionToken: result.rawSessionId,
      };
    },
  );

  app.post(
    "/api/musefold/v1/auth/register",
    {
      schema: {
        tags: ["account"],
        body: registerRequestSchema,
        response: { 200: accountSessionSchema },
      },
    },
    async (request, reply) => {
      await options.rateLimiter?.assertAllowed(
        "account:register",
        request.ip,
        RATE_LIMIT_POLICIES.accountRegister,
      );
      const result = await options.accountService.register(
        registerRequestSchema.parse(request.body),
      );
      reply.setCookie(
        options.config.SESSION_COOKIE_NAME,
        result.rawSessionId,
        cookieOptions,
      );
      return publicSession(result);
    },
  );

  app.post(
    "/api/musefold/v1/auth/login",
    {
      schema: {
        tags: ["account"],
        body: loginRequestSchema,
        response: { 200: accountSessionSchema },
      },
    },
    async (request, reply) => {
      await options.rateLimiter?.assertAllowed(
        "account:login",
        request.ip,
        RATE_LIMIT_POLICIES.accountLogin,
      );
      const result = await options.accountService.login(
        loginRequestSchema.parse(request.body),
      );
      reply.setCookie(
        options.config.SESSION_COOKIE_NAME,
        result.rawSessionId,
        cookieOptions,
      );
      return publicSession(result);
    },
  );

  app.get(
    "/api/musefold/v1/auth/me",
    {
      schema: {
        tags: ["account"],
        response: { 200: accountSessionSchema },
      },
    },
    async (request) => {
      const result = await options.accountService.getSession(
        requireCookie(request.cookies, options.config.SESSION_COOKIE_NAME),
      );
      return publicSession(result);
    },
  );

  app.post(
    "/api/musefold/v1/auth/redeem",
    {
      schema: {
        tags: ["account"],
        headers: z
          .object({ "x-musefold-csrf": z.string().min(32).max(256) })
          .passthrough(),
        body: redeemRequestSchema,
        response: { 200: redeemResultSchema },
      },
    },
    async (request) => {
      const rawSessionId = requireCookie(
        request.cookies,
        options.config.SESSION_COOKIE_NAME,
      );
      const session = await options.accountService.getSession(rawSessionId);
      requireCsrf(request.headers["x-musefold-csrf"], session.csrfToken);
      await options.rateLimiter?.assertAllowed(
        "account:redeem",
        String(session.account.id),
        RATE_LIMIT_POLICIES.accountRedeem,
      );
      return options.accountService.redeem(
        rawSessionId,
        redeemRequestSchema.parse(request.body).code,
      );
    },
  );

  app.post(
    "/api/musefold/v1/auth/logout",
    {
      schema: {
        tags: ["account"],
        headers: z
          .object({ "x-musefold-csrf": z.string().min(32).max(256) })
          .passthrough(),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const rawSessionId = requireCookie(
        request.cookies,
        options.config.SESSION_COOKIE_NAME,
      );
      const session = await options.accountService.getSession(rawSessionId);
      requireCsrf(request.headers["x-musefold-csrf"], session.csrfToken);
      await options.accountService.logout(rawSessionId);
      reply.clearCookie(options.config.SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(204).send();
    },
  );
};

function publicSession(
  result: AccountSession & { rawSessionId: string },
): AccountSession {
  return { account: result.account, csrfToken: result.csrfToken };
}

function requireCookie(
  cookies: Record<string, string | undefined>,
  name: string,
): string {
  const value = cookies[name];
  if (!value) throw new AppError("AUTH_REQUIRED", "请先登录 Musefold", 401);
  return value;
}

function requireCsrf(
  header: string | string[] | undefined,
  expected: string,
): void {
  if (typeof header !== "string" || header !== expected) {
    throw new AppError(
      "VALIDATION_FAILED",
      "请求验证失败，请刷新页面后重试",
      403,
    );
  }
}

function requireBearer(header: string | undefined): string {
  const match = header ? /^Bearer\s+([^\s]+)$/i.exec(header) : null;
  if (!match?.[1]) throw new AppError("AUTH_REQUIRED", "缺少账号访问凭据", 401);
  return match[1];
}
