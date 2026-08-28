import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // 本地默认与 docker-compose 对齐;CI/生产经环境变量注入。
    url: process.env.DATABASE_URL ?? 'postgres://musefold:musefold@127.0.0.1:5432/musefold',
  },
  strict: true,
  verbose: true,
});
