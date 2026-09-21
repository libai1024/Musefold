import { z } from 'zod';
import { accountIssuerSchema } from '@musefold/contracts';

const issuerSchema = accountIssuerSchema.transform((value) => {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: issuerSchema.default('http://127.0.0.1:8787'),
  NEW_API_BASE_URL: issuerSchema,
  /** 与 api 共用的凭据加密密钥(读取 account_credentials 用)。 */
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(16),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('musefold'),
  /** Legacy policy: only create an actually missing bucket, never on access/network errors. */
  S3_AUTO_CREATE_BUCKET: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  /** Process configuration: restart every worker to pause/resume destructive maintenance. */
  MAINTENANCE_CLEANUP_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return envSchema.parse(source);
}
