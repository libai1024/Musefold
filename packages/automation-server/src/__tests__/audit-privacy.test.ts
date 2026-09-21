import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationError, createAutomationServer, type AuditRecord } from '../server';

const resources: Array<{ dir: string; stop: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.stop();
    rmSync(resource.dir, { recursive: true, force: true });
  }
});
const marker = 'synthetic-private-audit-marker';

async function fixture(rateLimit = 60, rejectAudit = false) {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-audit-privacy-'));
  const records: AuditRecord[] = [];
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = createAutomationServer({
    core: {
      version: 'synthetic',
      status: {
        snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }),
      },
    },
    dataDir: dir,
    owner: 'desktop-app',
    appVersion: 'synthetic',
    rateLimit,
    logger,
    routes: {
      'GET /v1/prompts/:id': ({ params }) => ({ id: params.id }),
      'POST /v1/prompts/:id': ({ body }) => ({ body }),
      'GET /v1/fail/:id': () => {
        throw new AutomationError('SYNTHETIC_ERROR', marker, 409);
      },
      'GET /v1/exact': () => ({ ok: true }),
    },
    onAudit: (record) => {
      if (rejectAudit) throw new Error(marker);
      records.push(record);
    },
  });
  resources.push({ dir, stop: () => server.stop() });
  return { info: await server.start(), records, logger };
}

describe('endpoint audit privacy over actual HTTP', () => {
  it.each([
    ['dynamic', `/v1/prompts/${marker}`, 200, '/v1/prompts/:id'],
    ['encoded', `/v1/prompts/${marker}%2Fpart`, 200, '/v1/prompts/:id'],
    ['handler-error', `/v1/fail/${marker}`, 409, '/v1/fail/:id'],
    ['unknown', `/unknown/${marker}`, 404, '/<unmatched>'],
    ['unauthorized', `/v1/prompts/${marker}`, 401, '/<unmatched>'],
    ['origin', `/v1/prompts/${marker}`, 403, '/<unmatched>'],
    ['rate-limit', `/v1/prompts/${marker}`, 429, '/<unmatched>'],
    ['bad-encoding', '/v1/prompts/%FF', 500, '/<unmatched>'],
    ['exact', `/v1/exact?query=${marker}`, 200, '/v1/exact'],
    ['health', `/v1/health?query=${marker}`, 200, '/v1/health'],
    ['body', `/v1/prompts/${marker}`, 200, '/v1/prompts/:id'],
  ] as const)('%s emits only a trusted route identity', async (kind, path, status, auditPath) => {
    const f = await fixture(kind === 'rate-limit' ? 0 : 60);
    const headers: Record<string, string> = {
      'x-musefold-local-proof': marker,
      'x-client-name': marker,
    };
    if (kind !== 'unauthorized') headers.authorization = `Bearer ${f.info.token}`;
    if (kind === 'origin') headers.origin = 'https://synthetic.example';
    if (kind === 'body') headers['content-type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${f.info.port}${path}`, {
      method: kind === 'body' ? 'POST' : 'GET',
      headers,
      ...(kind === 'body' ? { body: JSON.stringify({ prompt: marker }) } : {}),
    });
    expect(response.status).toBe(status);
    await response.text();
    await vi.waitFor(() => expect(f.records).toHaveLength(1));
    expect(f.records[0]).toMatchObject({
      path: auditPath,
      status,
      method: kind === 'body' ? 'POST' : 'GET',
    });
    const serialized = JSON.stringify(f.records);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain(f.info.token);
    expect(serialized).not.toContain('%FF');
  });

  it('audit I/O failure is visible without forwarding raw error details or breaking the response', async () => {
    const f = await fixture(60, true);
    const response = await fetch(`http://127.0.0.1:${f.info.port}/v1/exact`, {
      headers: { authorization: `Bearer ${f.info.token}` },
    });
    expect(response.status).toBe(200);
    await response.text();
    await vi.waitFor(() => expect(f.logger.warn).toHaveBeenCalled());
    expect(f.logger.warn).toHaveBeenCalledWith('automation audit failed');
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain(marker);
  });
});
