import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MusefoldDatabase } from '@musefold/db';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { MusefoldAuth } from './auth/index.js';
import { type AuthedEnv, requireSession } from './auth/middleware.js';
import type { ApiEnv } from './env.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { accountRoutes } from './modules/account/routes.js';
import type { AccountService } from './modules/account/service.js';
import { designSchemeRoutes } from './modules/design-schemes/routes.js';
import { DesignSchemeService } from './modules/design-schemes/service.js';
import { generationRoutes } from './modules/generation/routes.js';
import type { GenerationService } from './modules/generation/service.js';
import { createCloudMcpRequestHandler } from './modules/mcp/handler.js';
import type { SkillService } from './modules/mcp/skills.js';
import { promptRoutes } from './modules/prompts/routes.js';
import type { PromptService } from './modules/prompts/service.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from './modules/rate-limit/service.js';
import { syncRoutes } from './modules/sync/routes.js';
import type { SyncService } from './modules/sync/service.js';
import { workbenchRoutes } from './modules/workbench/routes.js';
import type { WorkbenchService } from './modules/workbench/service.js';

export interface AppDependencies {
  env: ApiEnv;
  db: MusefoldDatabase;
  auth: MusefoldAuth;
  rateLimiter: RateLimiter;
  services: {
    account: AccountService;
    prompts: PromptService;
    sync: SyncService;
    workbench: WorkbenchService;
    generation: GenerationService;
    skills: SkillService;
  };
}

/** 云端生图对外固定暴露的模型别名。 */
export const CLOUD_MODEL_ALIASES = ['musefold-image-pro'] as const;

export function createApp(deps: AppDependencies) {
  const { env, auth, rateLimiter, services } = deps;
  const app = new OpenAPIHono<AuthedEnv>();

  // 请求 ID + 统一错误体。
  app.use('*', async (c, next) => {
    c.res.headers.set('x-request-id', c.req.header('x-request-id') ?? randomUUID());
    await next();
  });
  app.onError((error, c) => {
    const requestId = c.res.headers.get('x-request-id') ?? randomUUID();
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, requestId), error.status as 400);
    }
    console.error(`[api] 未处理异常 requestId=${requestId}`, error);
    return c.json(
      toErrorBody(new AppError('INTERNAL_ERROR', '服务内部错误', 500, true), requestId),
      500,
    );
  });

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Better Auth:登录/登出/会话/OAuth 授权服务器 + MCP well-known 文档。
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.on(['GET'], '/.well-known/*', (c) => auth.handler(c.req.raw));

  // 云端 MCP(Streamable HTTP,只读白名单)。IP 级 + 客户端级限流。
  const mcpHandler = createCloudMcpRequestHandler(auth, {
    prompts: services.prompts,
    skills: services.skills,
    account: services.account,
    resourceUrl: env.mcpResourceUrl,
    modelAliases: [...CLOUD_MODEL_ALIASES],
  });
  app.post('/mcp', async (c) => {
    await rateLimiter.assertAllowed('mcp-ip', clientIp(c), RATE_LIMIT_POLICIES.cloudMcpIp);
    return mcpHandler(c.req.raw);
  });

  // OpenAPI 文档(从代码生成;先于业务路由注册,避开会话中间件)。
  app.doc('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Musefold API', version: '2.5.0' },
    servers: [{ url: '/api/v1' }],
  });

  // 业务 JSON API(会话保护)。
  const authed = requireSession(auth, [env.PUBLIC_BASE_URL, ...env.trustedOrigins]);
  const api = new OpenAPIHono<AuthedEnv>();
  api.use('*', authed);
  api.route('/', promptRoutes(services.prompts));
  api.route('/', workbenchRoutes(services.workbench));
  api.route('/', generationRoutes(services.generation));
  api.route('/', designSchemeRoutes(new DesignSchemeService(deps.db)));
  api.route('/', syncRoutes(services.sync, rateLimiter));
  api.route('/', accountRoutes(services.account, rateLimiter));
  app.route('/api/v1', api);

  return app;
}

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
