import { PackageOperationBudget } from './modules/design-scheme-packages/operation-budget.js';
import { designSchemePackageExportRoutes } from './modules/design-scheme-packages/export-routes.js';
import { DesignSchemePackageExportService } from './modules/design-scheme-packages/export-service.js';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';
import { DesignSchemePackageService } from './modules/design-scheme-packages/service.js';
import { DesignSchemePackageImportService } from './modules/design-scheme-packages/import-service.js';
import { designSchemePackageRoutes } from './modules/design-scheme-packages/routes.js';
import { randomUUID } from 'node:crypto';
import { DesignSchemeAgentService } from './modules/design-scheme-agent/service.js';
import { designSchemeAgentRoutes } from './modules/design-scheme-agent/routes.js';
import { DesignSchemeSourcePreparationService } from './modules/design-schemes/source-preparation.js';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MusefoldDatabase } from '@musefold/db';
import { getConnInfo } from '@hono/node-server/conninfo';
import { clientIpResolver } from './lib/client-ip.js';
import type { MusefoldAuth } from './auth/index.js';
import { type AuthedEnv, requireSession } from './auth/middleware.js';
import type { ApiEnv } from './env.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { accountRoutes } from './modules/account/routes.js';
import type { AccountService } from './modules/account/service.js';
import { designSchemeAssetRoutes } from './modules/design-scheme-assets/routes.js';
import { DesignSchemeAssetService } from './modules/design-scheme-assets/service.js';
import { S3DesignSchemeAssetStorage } from './modules/design-scheme-assets/storage.js';
import { DesignSchemeRunService } from './modules/design-scheme-runs/service.js';
import { designSchemeRoutes } from './modules/design-schemes/routes.js';
import { DesignSchemeService } from './modules/design-schemes/service.js';
import { DesignSchemeMarketSearchService } from './modules/design-schemes/market-search.js';
import { generationRoutes } from './modules/generation/routes.js';
import type { GenerationService } from './modules/generation/service.js';
import { createCloudMcpRequestHandler } from './modules/mcp/handler.js';
import type { SkillService } from './modules/mcp/skills.js';
import { promptRoutes } from './modules/prompts/routes.js';
import type { PromptService } from './modules/prompts/service.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from './modules/rate-limit/service.js';
import { syncRoutes } from './modules/sync/routes.js';
import type { SyncService } from './modules/sync/service.js';
import { cloudMcpRoutes } from './modules/cloud-mcp/routes.js';
import { CloudMcpService } from './modules/cloud-mcp/service.js';
import { usageRoutes } from './modules/usage/routes.js';
import { UsageService } from './modules/usage/service.js';
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
    designSchemeAssets?: DesignSchemeAssetService;
    designSchemeAgent?: DesignSchemeAgentService;
  };
}

/** 云端生图对外固定暴露的模型别名。 */
export const CLOUD_MODEL_ALIASES = ['musefold-image-pro'] as const;

export function createApp(deps: AppDependencies) {
  const { env, auth, rateLimiter, services } = deps;
  const servicePath = new URL(env.PUBLIC_BASE_URL).pathname.replace(/\/+$/, '');
  const app = new OpenAPIHono<AuthedEnv>();
  const clientIp = clientIpResolver(env.TRUST_PROXY);

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

  const cloudMcp = new CloudMcpService(deps.db);

  // 云端 MCP(Streamable HTTP,只读白名单)。IP 级 + 客户端级限流。
  // JWT 过签名后仍查 consent:撤销授权后同一 client 的下次调用必须 401。
  const mcpHandler = createCloudMcpRequestHandler(auth, {
    prompts: services.prompts,
    skills: services.skills,
    account: services.account,
    resourceUrl: env.mcpResourceUrl,
    modelAliases: [...CLOUD_MODEL_ALIASES],
    isAuthorizationActive: async (claims) =>
      typeof claims.sub === 'string' &&
      (await services.account.isPrincipalActive(claims.sub)) &&
      (await cloudMcp.hasActiveTokenAuthorization(claims)),
  });
  app.post('/mcp', async (c) => {
    let remoteAddress: string | undefined;
    try {
      remoteAddress = getConnInfo(c).remote.address;
    } catch {
      /* No adapter/socket means no trusted proxy evidence. */
    }
    await rateLimiter.assertAllowed(
      'mcp-ip',
      clientIp(remoteAddress, c.req.header('x-forwarded-for')),
      RATE_LIMIT_POLICIES.cloudMcpIp,
    );
    return mcpHandler(c.req.raw);
  });

  // OpenAPI 文档(从代码生成;先于业务路由注册,避开会话中间件)。
  app.doc('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Musefold API', version: '2.5.0' },
    servers: [{ url: `${servicePath}/api/v1` }],
  });

  // 业务 JSON API(会话保护)。
  const authed = requireSession(
    auth,
    [new URL(env.PUBLIC_BASE_URL).origin, ...env.trustedOrigins],
    services.account,
    servicePath,
  );
  const api = new OpenAPIHono<AuthedEnv>();
  api.use('*', authed);
  api.route('/', promptRoutes(services.prompts));
  api.route('/', workbenchRoutes(services.workbench));
  api.route('/', generationRoutes(services.generation));
  api.route('/', usageRoutes(new UsageService(deps.db)));
  api.route('/', cloudMcpRoutes(cloudMcp));
  const designSchemeAssets =
    services.designSchemeAssets ??
    new DesignSchemeAssetService(deps.db, new S3DesignSchemeAssetStorage(env));
  api.route('/', designSchemeAssetRoutes(designSchemeAssets));
  const packageBudget = new PackageOperationBudget();
  api.route(
    '/',
    designSchemePackageExportRoutes(
      new DesignSchemePackageExportService(
        deps.db,
        new S3DesignSchemeAssetStorage(env, DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes),
        new DesignSchemeService(deps.db, designSchemeAssets),
        designSchemeAssets,
        packageBudget,
      ),
    ),
  );
  api.route(
    '/',
    designSchemePackageRoutes(
      new DesignSchemePackageService(
        deps.db,
        new S3DesignSchemeAssetStorage(env, DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes),
        packageBudget,
      ),
    ),
  );
  api.route(
    '/',
    designSchemeAgentRoutes(
      services.designSchemeAgent ??
        new DesignSchemeAgentService(
          deps.db,
          new DesignSchemeSourcePreparationService(deps.db, new S3DesignSchemeAssetStorage(env)),
          env,
          designSchemeAssets,
        ),
      rateLimiter,
    ),
  );
  api.route(
    '/',
    designSchemeRoutes(
      new DesignSchemeService(
        deps.db,
        designSchemeAssets,
        new DesignSchemeRunService(deps.db, designSchemeAssets, services.generation),
        new DesignSchemeMarketSearchService({ rateLimiter }),
        new DesignSchemePackageImportService(
          deps.db,
          new S3DesignSchemeAssetStorage(env, DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes),
          designSchemeAssets,
          packageBudget,
        ),
      ),
    ),
  );
  api.route('/', syncRoutes(services.sync, rateLimiter));
  api.route('/', accountRoutes(services.account, rateLimiter));
  app.route('/api/v1', api);

  if (!servicePath) return app;
  const mounted = new OpenAPIHono<AuthedEnv>();
  mounted.route(servicePath, app);
  // RFC discovery prefixes the issuer/resource path with /.well-known, outside
  // the application mount. Only this application's exact documents are exposed.
  for (const path of [
    `/.well-known/oauth-protected-resource${servicePath}/mcp`,
    `/.well-known/oauth-authorization-server${servicePath}/api/auth`,
    `/.well-known/openid-configuration${servicePath}/api/auth`,
  ])
    mounted.on(['GET', 'HEAD'], path, (c) => auth.handler(c.req.raw));
  return mounted;
}
