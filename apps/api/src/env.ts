import { z } from 'zod';
import { designSchemeTextModelSchema } from '@musefold/contracts';
import { validTrustedProxy } from './lib/client-ip.js';

/**
 * 进程唯一的环境入口:启动时一次性校验,后续全部经 ApiEnv 传参。
 * 密钥类变量只在这里出现名字,不进日志。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  /** 对外可达的服务根地址(OAuth issuer / cookie 域 / MCP resource 由此派生)。 */
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  /** 自托管 New API 网关(账号事实源)。 */
  NEW_API_BASE_URL: z.string().url(),
  /** Empty/unset disables cloud text calls; image policy is independent. */
  SCHEME_AGENT_TEXT_MODEL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    designSchemeTextModelSchema.optional(),
  ),
  /** Explicit historical deployment provenance. Absence never inherits NEW_API_BASE_URL. */
  LEGACY_NEW_API_ISSUER: z.string().url().optional(),
  /** AES-256-GCM 凭据加密密钥(hex64 / base64-32B / 任意口令均可,见 server-crypto)。 */
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(16),
  /** 逗号分隔的额外可信来源(生产反代域等)。 */
  TRUSTED_ORIGINS: z.string().default(''),
  /** Socket peers allowed to append X-Forwarded-For. Never infer this from allowed origins. */
  TRUST_PROXY: z
    .string()
    .trim()
    .default('false')
    .refine(validTrustedProxy, 'TRUST_PROXY must name explicit trusted addresses or subnets'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('musefold'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  ASSET_URL_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
});

export type ApiEnv = z.infer<typeof envSchema> & {
  mcpResourceUrl: string;
  trustedOrigins: string[];
};

/**
 * 本地 Web 壳 / Playwright 走 Next :3399 反代到 API :8787。
 * 浏览器 Origin 是 3399,写请求必须进 CSRF 白名单,否则提示词/方案 POST 会被 403。
 * 生产不默认放行(同源部署时 Origin = PUBLIC_BASE_URL)。
 */
const LOCAL_WEB_SHELL_ORIGINS = ['http://127.0.0.1:3399', 'http://localhost:3399'] as const;

export function loadEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = envSchema.parse(source);
  const fromEnv = parsed.TRUSTED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const localShell = parsed.NODE_ENV === 'production' ? [] : LOCAL_WEB_SHELL_ORIGINS;
  return {
    ...parsed,
    mcpResourceUrl: `${parsed.PUBLIC_BASE_URL.replace(/\/$/, '')}/mcp`,
    trustedOrigins: [...new Set([...fromEnv, ...localShell])],
  };
}
