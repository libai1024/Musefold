import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import { createAutomationServer, AutomationError } from '../server';
import { discoveryFileMode, readDiscoveryFile } from '../discovery';

const resources: Array<{ dir: string; stop?: () => Promise<void> }> = [];
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.stop?.(); rmSync(resource.dir, { recursive: true, force: true }); } });

function createFixture(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-automation-server-'));
  const hub = createEventHub();
  const server = createAutomationServer({
    core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 2, formalSchemes: 0, providers: 1, activeProviderId: 'tvt' }) } },
    events: hub,
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    routes: { 'POST /v1/echo': ({ body }) => ({ body }) },
    ...overrides,
  });
  resources.push({ dir, stop: () => server.stop() });
  return { dir, hub, server };
}

async function request(info: { port: number; token: string }, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${info.token}`);
  return fetch(`http://127.0.0.1:${info.port}${path}`, { ...init, headers });
}

describe('automation server', () => {
  it('binds loopback, authenticates, writes discovery and serves health', async () => {
    const { dir, server } = createFixture();
    const info = await server.start();
    expect(info.host).toBe('127.0.0.1');
    expect(server.listening).toBe(true);
    expect(discoveryFileMode(dir)).toBe(0o600);
    expect(readDiscoveryFile(dir)?.port).toBe(info.port);
    const response = await request(info, '/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: true, owner: 'desktop-app', apiVersion: 'v1', data: { prompts: 2 } });
  });

  it('rejects missing, invalid and browser-origin credentials', async () => {
    const { server } = createFixture();
    const info = await server.start();
    const missing = await fetch(`http://127.0.0.1:${info.port}/v1/health`);
    expect(missing.status).toBe(401);
    const invalid = await fetch(`http://127.0.0.1:${info.port}/v1/health`, { headers: { authorization: 'Bearer nope' } });
    expect(invalid.status).toBe(401);
    const origin = await request(info, '/v1/health', { headers: { origin: 'https://evil.test' } });
    expect(origin.status).toBe(403);
    expect((await origin.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
  });

  it('enforces request limits, maps errors and emits audit records', async () => {
    const audit: unknown[] = [];
    const { server } = createFixture({ requestBodyLimit: 8, onAudit: (record: unknown) => { audit.push(record); } });
    const info = await server.start();
    const tooLarge = await request(info, '/v1/echo', { method: 'POST', body: JSON.stringify({ message: 'too long' }) });
    expect(tooLarge.status).toBe(413);
    const missing = await request(info, '/v1/nope');
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(audit).toHaveLength(2);
  });

  it('rotates tokens and broadcasts a rotation event to SSE clients', async () => {
    const { server } = createFixture();
    const info = await server.start();
    const controller = new AbortController();
    const stream = await request(info, '/v1/events', { signal: controller.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(': connected');
    const nextToken = server.rotateToken();
    expect(nextToken).not.toBe(info.token);
    const event = new TextDecoder().decode((await reader.read()).value);
    expect(event).toContain('event: token.rotated');
    expect((await request(info, '/v1/health')).status).toBe(401);
    expect((await request({ ...info, token: nextToken }, '/v1/health')).status).toBe(200);
    controller.abort();
  });

  it('rejects non-loopback binding before opening a socket', () => {
    expect(() => createAutomationServer({
      core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } }, dataDir: tmpdir(), owner: 'desktop-app', appVersion: 'x', host: '0.0.0.0',
    })).toThrowError(AutomationError);
  });
});
