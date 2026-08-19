import { z } from 'zod';

export const workerConfigSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z
    .string()
    .url()
    .default(
      'postgres://musefold_worker:musefold_worker@127.0.0.1:55432/musefold',
    ),
  NEW_API_BASE_URL: z.string().url().default('https://zhaozhaoyue.top'),
  SESSION_ENCRYPTION_KEY: z
    .string()
    .min(16)
    .default('development-only-musefold-session-key'),
  S3_ENDPOINT: z.string().url().default('http://127.0.0.1:59000'),
  S3_REGION: z.string().trim().min(1).max(64).default('us-east-1'),
  S3_BUCKET: z.string().trim().min(1).max(128).default('musefold-local'),
  S3_ACCESS_KEY_ID: z.string().trim().min(1).max(128).default('musefold_local'),
  S3_SECRET_ACCESS_KEY: z
    .string()
    .min(1)
    .max(256)
    .default('musefold_local_secret'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  S3_AUTO_CREATE_BUCKET: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const config = workerConfigSchema.parse(environment);
  if (
    config.SESSION_ENCRYPTION_KEY === 'development-only-musefold-session-key' &&
    config.NODE_ENV === 'production'
  ) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must be configured outside development',
    );
  }
  return config;
}
