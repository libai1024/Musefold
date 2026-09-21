import { createHash } from 'node:crypto';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { MusefoldDatabase } from '@musefold/db';
import type { NewApiClient } from '@musefold/new-api-client';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, jwt } from 'better-auth/plugins';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import type { ApiEnv } from '../env.js';
import { CloudMcpService } from '../modules/cloud-mcp/service.js';
import { type NewApiDelegationHooks, newApiDelegation } from './new-api-delegation.js';
import { oauthBrowser } from './oauth-browser.js';

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
  const serviceUrl = new URL(env.PUBLIC_BASE_URL);
  const servicePath = serviceUrl.pathname.replace(/\/+$/, '');
  const authPath = `${servicePath}/api/auth`;
  const cloudMcp = new CloudMcpService(db);
  const bearerPlugin = bearer();
  // Explicit shared hashing keeps the early refresh-lineage lookup identical to
  // BA's stored tokens (SHA-256/base64url); no token material is logged or stored.
  const hashOAuthToken = (value: string) => createHash('sha256').update(value).digest('base64url');
  const oauth = mcp({
    resource: env.mcpResourceUrl,
    scopes: [...MCP_SCOPES],
    loginPage: `${servicePath}/login`,
    consentPage: `${servicePath}/consent`,
    storeTokens: { hash: hashOAuthToken },
    customTokenResponseFields: async ({ grantType, user, scopes, verificationValue }) => {
      // Opaque issuance does not invoke accessToken claims. Apply the same
      // frozen-code check there; refresh is checked before BA's replay path.
      if (grantType === 'authorization_code') {
        try {
          await cloudMcp.createAccessTokenClaims({
            userId: user?.id ?? '',
            clientId: verificationValue?.query.client_id ?? '',
            sessionId: verificationValue?.sessionId ?? '',
            scopes,
            referenceId: verificationValue?.referenceId,
          });
        } catch {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_grant',
            error_description: 'authorization unavailable',
          });
        }
      }
      return {};
    },
    extensions: [
      {
        claims: {
          accessToken: async ({ user, client, sessionId, scopes, referenceId }) => {
            try {
              return await cloudMcp.createAccessTokenClaims({
                userId: user?.id ?? '',
                clientId: client.clientId,
                sessionId: sessionId ?? '',
                scopes,
                referenceId,
              });
            } catch {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_IDENTITY_UNVERIFIED',
                message: '账号会话尚未获得此 MCP 授权',
              });
            }
          },
        },
      },
    ],
  });
  return betterAuth({
    baseURL: `${serviceUrl.origin}${authPath}`,
    basePath: authPath,
    advanced: servicePath
      ? {
          cookiePrefix: `musefold_${createHash('sha256').update(servicePath).digest('hex').slice(0, 12)}`,
          defaultCookieAttributes: { path: servicePath },
        }
      : undefined,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg' }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        newApiUserId: { type: 'number', required: false, input: false },
      },
    },
    trustedOrigins: env.trustedOrigins,
    databaseHooks: {
      session: {
        delete: {
          before: async (value) => {
            await hooks.loginSessions?.releases.captureBeforeDelete(value.id);
          },
        },
      },
      verification: {
        create: {
          before: async (verification) => ({
            data: { value: await cloudMcp.freezeAuthorizationCode(verification.value) },
          }),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path?.startsWith('/login-capacity/') ||
          ctx.path === '/sign-in/new-api' ||
          ctx.path === '/sign-up/new-api'
        )
          ctx.setHeader('Cache-Control', 'private, no-store');
        if (ctx.path?.startsWith('/login-capacity/')) {
          const origin = ctx.headers?.get('origin');
          const binding = ctx.headers?.get('x-musefold-login-binding');
          if (
            (origin &&
              origin !== new URL(env.PUBLIC_BASE_URL).origin &&
              !env.trustedOrigins.includes(origin)) ||
            (!origin && !binding)
          )
            throw new APIError('FORBIDDEN', {
              code: 'FORBIDDEN',
              message: '登录请求来源不受信任',
            });
        }
        if (ctx.path === '/oauth2/token' && ctx.body?.grant_type === 'refresh_token') {
          const token = ctx.body.refresh_token;
          if (
            typeof token !== 'string' ||
            token.length === 0 ||
            token.length > 4096 ||
            !(await cloudMcp.hasActiveRefreshTokenAuthorization(hashOAuthToken(token)))
          ) {
            throw new APIError('BAD_REQUEST', {
              error: 'invalid_grant',
              error_description: 'authorization unavailable',
            });
          }
        }
        // BA's built-in list exposes raw tokens for every session under a user.
        // A restricted candidate deliberately shares a legacy recovery target,
        // so even a normal session must never enumerate those bearer secrets.
        if (ctx.path === '/list-sessions')
          throw new APIError('FORBIDDEN', {
            code: 'ACCOUNT_IDENTITY_UNVERIFIED',
            message: '会话凭据不可枚举',
          });
        const allowed = new Set([
          '/get-session',
          '/sign-out',
          '/sign-in/new-api',
          '/sign-up/new-api',
          '/login-capacity/review',
          '/login-capacity/complete',
          '/login-capacity/cancel',
        ]);
        if (allowed.has(ctx.path)) return;
        // Global hooks precede plugin hooks. Run the actual bearer normalizer
        // before checking the session: it validates signed/encoded tokens,
        // accepts padded raw tokens and retains the cookie for invalid bearers.
        // Reusing it avoids a second parser disagreeing about the effective user.
        const normalized = await bearerPlugin.hooks.before[0]?.handler({
          ...ctx,
          returnHeaders: false,
        });
        if (normalized?.context.headers) ctx.headers = normalized.context.headers;
        const current = await getSessionFromCtx(ctx, {
          disableCookieCache: true,
          disableRefresh: true,
        });
        if (!current) return;
        try {
          await hooks.assertSessionAuthorization(current.session.id, current.user.id);
        } catch {
          throw new APIError('FORBIDDEN', {
            code: 'ACCOUNT_IDENTITY_UNVERIFIED',
            message: '恢复会话不能授权业务或 MCP 访问',
          });
        }
      }),
    },
    plugins: [
      newApiDelegation(newApi, hooks),
      bearerPlugin,
      jwt(),
      oauth,
      oauthBrowser(oauth.options, [new URL(env.PUBLIC_BASE_URL).origin, ...env.trustedOrigins]),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
      }),
    ],
  });
}

export type MusefoldAuth = ReturnType<typeof createAuth>;
