import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * Cloud MCP 已授权客户端 id。Better Auth oauth_client.client_id 可能长于
 * 普通实体 id(64),这里放宽到 256,出参仍 secret-free。
 */
export const cloudMcpClientIdSchema = z.string().trim().min(1).max(256);

/** 桌面连到非官方云时的稳定桥错误码,供 UI 显示「暂不支持」。 */
export const CLOUD_MCP_CUSTOM_SERVER_CODE = 'CLOUD_MCP_CUSTOM_SERVER' as const;

/** 官方云 API 默认基址;桌面 `MUSEFOLD_API_URL` 与此不等即自定义服务器。 */
export const OFFICIAL_CLOUD_API_BASE = 'https://www.zhaozhaoyue.top';

/**
 * 当前用户已授权的一个 Cloud MCP OAuth 客户端(设置「已连接应用」行)。
 * 出参 strict:不得携带 access_token / refresh_token / client_secret。
 */
export const cloudMcpAuthorizationSchema = z
  .object({
    clientId: cloudMcpClientIdSchema,
    /**
     * 客户端展示名。oauth_client.name 可空,服务端回退 clientId 前缀,
     * 出参恒有、不把空串留给 UI。
     */
    name: z.string().trim().min(1).max(120),
    uri: z.string().trim().max(2048).nullable(),
    scopes: z.array(z.string().trim().min(1).max(64)).max(16),
    authorizedAt: isoDateTimeSchema,
    /** 该 client 未撤销 access token 的 max(createdAt);从未发过令牌则为 null。 */
    lastUsedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const cloudMcpAuthorizationListSchema = z
  .object({
    items: z.array(cloudMcpAuthorizationSchema),
  })
  .strict();

export const cloudMcpRevokeInputSchema = z
  .object({
    clientId: cloudMcpClientIdSchema,
  })
  .strict();

export const cloudMcpRevokeResultSchema = z
  .object({
    revoked: z.literal(true),
    clientId: cloudMcpClientIdSchema,
  })
  .strict();

export type CloudMcpAuthorization = z.infer<typeof cloudMcpAuthorizationSchema>;
export type CloudMcpAuthorizationList = z.infer<typeof cloudMcpAuthorizationListSchema>;
export type CloudMcpRevokeInput = z.infer<typeof cloudMcpRevokeInputSchema>;
export type CloudMcpRevokeResult = z.infer<typeof cloudMcpRevokeResultSchema>;

/** Signed provider query, not an arbitrary return URL or a login credential. */
export const cloudMcpOAuthRequestSchema = z
  .object({
    oauth_query: z.string().min(1).max(8192),
  })
  .strict();
export const cloudMcpOAuthReviewSchema = z
  .object({
    client: z
      .object({
        id: cloudMcpClientIdSchema,
        name: z.string().min(1).max(120),
        origin: z.string().max(2048).nullable(),
      })
      .strict(),
    scopes: z
      .array(z.enum(['account:read', 'prompts:read', 'skills:read', 'offline_access']))
      .min(1)
      .max(4),
    account: z
      .object({ id: z.string().min(1), name: z.string().min(1).max(120) })
      .strict()
      .nullable(),
    loginRequired: z.boolean(),
    /** Server-built same-origin authorization URL. Never a caller-provided returnTo. */
    continueUrl: z.string().startsWith('/api/auth/oauth2/authorize?').max(8192).nullable(),
    /** Short-lived, query/account/session-bound confirmation; cannot authorize anything alone. */
    reviewRef: z.string().min(1).max(4096).nullable(),
  })
  .strict();
export const cloudMcpOAuthDecisionSchema = cloudMcpOAuthRequestSchema.extend({
  accept: z.boolean(),
  reviewRef: z.string().min(1).max(4096),
});
export const cloudMcpOAuthRedirectSchema = z
  .object({
    redirect: z.literal(true),
    url: z.string().min(1).max(8192),
  })
  .strict();
export type CloudMcpOAuthRequest = z.infer<typeof cloudMcpOAuthRequestSchema>;
export type CloudMcpOAuthReview = z.infer<typeof cloudMcpOAuthReviewSchema>;
export type CloudMcpOAuthDecision = z.infer<typeof cloudMcpOAuthDecisionSchema>;
export type CloudMcpOAuthRedirect = z.infer<typeof cloudMcpOAuthRedirectSchema>;

/** ISO 8601 with offset;zod datetime({ offset: true }) 不接受裸 Z。 */
export function toCloudMcpIso(date: Date): string {
  return date.toISOString().replace(/Z$/, '+00:00');
}

/**
 * 展示名:有 name 用 name;否则回退 clientId 前 8 位(前缀,避免整段 id 占满行)。
 */
export function cloudMcpClientDisplayName(
  name: string | null | undefined,
  clientId: string,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.slice(0, 120);
  return clientId.slice(0, 8) || clientId;
}

export function isOfficialCloudApiBase(base: string): boolean {
  return base.replace(/\/+$/, '') === OFFICIAL_CLOUD_API_BASE;
}
