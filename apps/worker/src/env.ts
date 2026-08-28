import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  NEW_API_BASE_URL: z.string().url(),
  /** 与 api 共用的凭据加密密钥(读取 account_credentials 用)。 */
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(16),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('musefold'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return envSchema.parse(source);
}
