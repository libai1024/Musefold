import { createHmac } from 'node:crypto';
import { serve } from '@hono/node-server';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../../app.js';
import { loadEnv } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter, RATE_LIMIT_POLICIES } from '../../modules/rate-limit/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const secret = 'synthetic-address-limiter-hmac';
describeDb('actual HTTP proxy trust and persistent MCP IP buckets', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM rate_limit_buckets');
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  it.each([
    ['false', '127.0.0.1', ''],
    ['loopback', '203.0.113.9', ', 203.0.113.9'],
    ['loopback,10.0.0.0/8', '203.0.113.9', ', 203.0.113.9, 10.2.3.4'],
  ])(
    'changing an untrusted prefix cannot reset the real bucket (%s)',
    async (trust, subject, suffix) => {
      const limiter = new RateLimiter(database.db, secret);
      const app = createApp({
        env: loadEnv({
          DATABASE_URL: container.getConnectionUri(),
          BETTER_AUTH_SECRET: 'synthetic-proxy-secret',
          NEW_API_BASE_URL: 'https://provider.example.test',
          CREDENTIAL_ENCRYPTION_KEY: 'synthetic-proxy-key',
          TRUST_PROXY: trust,
        }),
        db: database.db,
        auth: {},
        rateLimiter: {
          async assertAllowed(...args: Parameters<RateLimiter['assertAllowed']>) {
            await limiter.assertAllowed(...args);
            // Authentication is deliberately denied after the actual production limiter.
            throw new AppError('AUTH_REQUIRED', 'Synthetic anonymous request', 401);
          },
        },
        services: {
          account: {
            recovery: { retry() {}, inspect() {}, verifyOriginal() {}, independent() {} },
          },
        },
      } as unknown as AppDependencies);
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      try {
        if (!server.listening)
          await new Promise<void>((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
          });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing fixture address');
        const post = async (n: number) => {
          const result = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
            method: 'POST',
            headers: { 'x-forwarded-for': `198.51.100.${n}${suffix}` },
          });
          await result.arrayBuffer();
          return result.status;
        };
        for (const n of [1, 2, 3]) expect(await post(n)).toBe(401);
        const key = createHmac('sha256', secret)
          .update('mcp-ip')
          .update('\0')
          .update(subject)
          .digest('hex');
        expect(
          (await database.pool.query('SELECT bucket_key, count FROM rate_limit_buckets')).rows,
        ).toEqual([{ bucket_key: key, count: 3 }]);
        // Only this isolated fixture is advanced to the boundary; production policy is unchanged.
        await database.pool.query('UPDATE rate_limit_buckets SET count=$1 WHERE bucket_key=$2', [
          RATE_LIMIT_POLICIES.cloudMcpIp.capacity,
          key,
        ]);
        expect(await post(4)).toBe(429);
        expect((await database.pool.query('SELECT count FROM rate_limit_buckets')).rows).toEqual([
          { count: RATE_LIMIT_POLICIES.cloudMcpIp.capacity + 1 },
        ]);
      } finally {
        if ('closeAllConnections' in server) server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    30_000,
  );
});
