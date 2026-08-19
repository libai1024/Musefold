import { z } from "zod";

const booleanEnvironmentSchema = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const trustProxySchema = z
  .string()
  .trim()
  .min(1)
  .default("false")
  .refine((value) => value !== "true" && value !== "*", {
    message: "TRUST_PROXY must name trusted proxy addresses, not every proxy",
  })
  .transform((value) => (value === "false" ? false : value));

export const webApiConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().trim().min(1).max(255).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(60160),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: trustProxySchema,
  PUBLIC_ORIGIN: z.string().url().default("http://127.0.0.1:60160"),
  MCP_RESOURCE_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:60160/api/musefold/mcp"),
  NEW_API_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
    .default("mf_session"),
  SESSION_ENCRYPTION_KEY: z
    .string()
    .min(16)
    .default("development-only-musefold-session-key"),
  OAUTH_JWKS_JSON: z.string().trim().min(1).optional(),
  SESSION_IDLE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(2_592_000)
    .default(604_800),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3_600)
    .max(31_536_000)
    .default(2_592_000),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://musefold_app:musefold_app@127.0.0.1:55432/musefold"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:59000"),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().trim().min(1).max(64).default("us-east-1"),
  S3_BUCKET: z.string().trim().min(1).max(128).default("musefold-local"),
  S3_ACCESS_KEY_ID: z.string().trim().min(1).max(128).default("musefold_local"),
  S3_SECRET_ACCESS_KEY: z
    .string()
    .min(1)
    .max(256)
    .default("musefold_local_secret"),
  S3_FORCE_PATH_STYLE: booleanEnvironmentSchema,
  S3_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(600),
  OPENAPI_ENABLED: booleanEnvironmentSchema,
});

export type WebApiConfig = z.infer<typeof webApiConfigSchema>;

export function loadWebApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WebApiConfig {
  const config = webApiConfigSchema.parse(environment);
  if (
    config.NODE_ENV === "production" &&
    config.SESSION_ENCRYPTION_KEY === "development-only-musefold-session-key"
  ) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY must be configured outside development",
    );
  }
  if (config.NODE_ENV === "production" && !config.OAUTH_JWKS_JSON) {
    throw new Error("OAUTH_JWKS_JSON must be configured outside development");
  }
  return config;
}
