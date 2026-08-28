import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { MusefoldDatabase } from '@musefold/db';
import type { NewApiClient } from '@musefold/new-api-client';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, jwt } from 'better-auth/plugins';
import type { ApiEnv } from '../env.js';
import { type NewApiDelegationHooks, newApiDelegation } from './new-api-delegation.js';

/** 云端 MCP 只读白名单对应的全部 scope;生图/写操作刻意不在其中。 */
export const MCP_SCOPES = ['account:read', 'prompts:read', 'skills:read'] as const;

export interface CreateAuthDeps {
  env: ApiEnv;
  db: MusefoldDatabase;
  newApi: NewApiClient;
  hooks: NewApiDelegationHooks;
}

/**
 * Better Auth 只承担两件事:会话(Web cookie + 桌面 bearer)与 MCP OAuth 2.1 授权服务器。
 * 登录凭据校验全部委托 New API(newApiDelegation 插件),本服务不存密码。
 */
export function createAuth({ env, db, newApi, hooks }: CreateAuthDeps) {
  return betterAuth({
    baseURL: env.PUBLIC_BASE_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        newApiUserId: { type: 'number', required: false, input: false },
      },
    },
    trustedOrigins: env.trustedOrigins,
    plugins: [
      newApiDelegation(newApi, hooks),
      bearer(),
      jwt(),
      mcp({
        resource: env.mcpResourceUrl,
        scopes: [...MCP_SCOPES],
        loginPage: '/login',
        consentPage: '/consent',
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
      }),
    ],
  });
}

export type MusefoldAuth = ReturnType<typeof createAuth>;
