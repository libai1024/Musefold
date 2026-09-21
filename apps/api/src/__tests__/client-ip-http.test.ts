import { serve } from '@hono/node-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import { loadEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { RATE_LIMIT_POLICIES } from '../modules/rate-limit/service.js';

const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((stop) => stop()));
});

function fixture(trust?: string) {
  const subjects: string[] = [];
  const assertAllowed = vi.fn(async (namespace: string, subject: string, policy: unknown) => {
    expect(namespace).toBe('mcp-ip');
    expect(policy).toEqual(RATE_LIMIT_POLICIES.cloudMcpIp);
    subjects.push(subject);
    // Stop before authentication/storage: this suite proves the real HTTP address boundary.
    throw new AppError('RATE_LIMITED', 'Synthetic request boundary', 429);
  });
  const app = createApp({
    env: loadEnv({
      DATABASE_URL: 'postgres://unused.test/db',
      BETTER_AUTH_SECRET: 'synthetic-proxy-test-secret',
      NEW_API_BASE_URL: 'https://provider.example.test',
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-proxy-test-key',
      TRUST_PROXY: trust,
    }),
    db: {},
    auth: {},
    rateLimiter: { assertAllowed },
    services: {
      account: { recovery: { retry() {}, inspect() {}, verifyOriginal() {}, independent() {} } },
    },
  } as unknown as AppDependencies);
  return { app, subjects };
}

async function http(trust?: string) {
  const result = fixture(trust);
  const server = serve({ fetch: result.app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  close.push(
    () =>
      new Promise<void>((resolve, reject) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
  return {
    ...result,
    async post(headers: Record<string, string>) {
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: 'POST',
        headers,
      });
      expect(response.status).toBe(429);
      await response.arrayBuffer();
    },
  };
}

describe('MCP source address through the actual Node HTTP adapter', () => {
  it.each([undefined, 'false', '192.0.2.10'])(
    'ignores spoofed forwarding from an untrusted peer (%s)',
    async (trust) => {
      const service = await http(trust);
      for (const ip of ['198.51.100.1', '198.51.100.2'])
        await service.post({ 'x-forwarded-for': ip });
      expect(service.subjects).toEqual(['127.0.0.1', '127.0.0.1']);
    },
  );
  it.each([
    ['loopback', '198.51.100.1, 203.0.113.9', '203.0.113.9'],
    ['127.0.0.1, 10.0.0.0/8', '198.51.100.1, 203.0.113.9, 10.2.3.4', '203.0.113.9'],
    ['loopback', '198.51.100.1', '198.51.100.1'],
  ])('walks only explicitly trusted hops (%s)', async (trust, forwarded, expected) => {
    const service = await http(trust);
    await service.post({ 'x-forwarded-for': forwarded });
    expect(service.subjects).toEqual([expected]);
  });
  it.each([
    'unknown',
    '198.51.100.1:42',
    '198.51.100.1,,10.0.0.1',
    '198.51.100.1, bad-hop',
    Array(34).fill('127.0.0.1').join(','),
  ])('falls back to the real peer for malformed/oversized chains', async (forwarded) => {
    const service = await http('loopback');
    await service.post({ 'x-forwarded-for': forwarded });
    expect(service.subjects).toEqual(['127.0.0.1']);
  });
  it('normalizes equivalent IPv6 and mapped IPv4 spellings into the same limiter subject', async () => {
    const service = await http('loopback');
    for (const ip of ['2001:db8::1', '2001:0db8:0000::1', '::ffff:c000:205', '192.0.2.5'])
      await service.post({ 'x-forwarded-for': ip });
    expect(service.subjects).toEqual(['2001:db8::1', '2001:db8::1', '192.0.2.5', '192.0.2.5']);
  });
  it('does not treat unrelated forwarding headers or a missing connection as trusted evidence', async () => {
    const service = await http('loopback');
    await service.post({ 'x-real-ip': '198.51.100.1', forwarded: 'for=198.51.100.2' });
    expect(service.subjects).toEqual(['127.0.0.1']);
    const direct = fixture('loopback');
    const response = await direct.app.request('/mcp', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.3' },
    });
    expect(response.status).toBe(429);
    expect(direct.subjects).toEqual(['unknown']);
  });
});
