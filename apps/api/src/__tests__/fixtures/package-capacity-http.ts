import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { designSchemePackageStageSchema } from '@musefold/contracts';
import type { expect as defaultExpect } from 'vitest';
import type { CapacityCase } from './package-capacity-corpus.js';
import { startPackageExchangeApp } from './package-exchange-app.js';

/** Real TCP/auth/PG/S3; no synthetic owner headers or canonical database writes. */
export async function startCapacityHttp(expect: typeof defaultExpect) {
  const fixture = await startPackageExchangeApp();
  const server = serve({ fetch: fixture.app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing capacity HTTP server');
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = '';
  async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    return fetch(base + path, {
      method,
      signal,
      headers: {
        cookie,
        origin: 'http://127.0.0.1:3399',
        'content-type':
          body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
      },
      body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
  }
  async function begin(item: CapacityCase) {
    if (!cookie) {
      const login = await request('/api/auth/sign-up/new-api', 'POST', {
        email: `capacity-${randomUUID()}@example.test`,
        password: 'correct-password',
      });
      expect(login.status).toBe(200);
      await login.json();
      cookie = (login.headers.get('set-cookie') ?? '')
        .split(/,(?=[^;]+=)/)
        .map((part) => part.split(';')[0])
        .join('; ');
      expect(cookie).not.toBe('');
    }
    const begin = await request('/api/v1/design-schemes/packages', 'POST', {
      requestId: randomUUID(),
      packageHash: item.sha256,
      sizeBytes: item.bytes,
      formatVersion: item.formatVersion,
    });
    expect(begin.status).toBe(200);
    const stage = designSchemePackageStageSchema.parse(await begin.json());
    return stage;
  }
  return {
    fixture,
    request,
    begin,
    async confirmed(item: CapacityCase) {
      const stage = await begin(item);
      const path = `/api/v1/design-schemes/packages/${stage.stagedPackageId}`;
      const upload = await request(`${path}/content`, 'PUT', await readFile(item.path));
      expect(upload.status).toBe(200);
      const ready = designSchemePackageStageSchema.parse(await upload.json());
      const decision = await request(`${path}/decision`, 'POST', {
        packageHash: ready.packageHash,
        formatVersion: ready.formatVersion,
        parserVersion: ready.parserVersion,
        confirmationHash: ready.confirmationHash,
        decision: 'confirm',
      });
      expect(decision.status).toBe(200);
      expect(designSchemePackageStageSchema.parse(await decision.json()).status).toBe('confirmed');
      return {
        stagedPackageId: stage.stagedPackageId,
        packageHash: item.sha256,
        formatVersion: item.formatVersion,
      };
    },
    async maintenance() {
      const result = await fixture.database.pool.query(
        "SELECT (graphile_worker.add_job('maintenance/cleanup', '{}'::json, max_attempts := 1, job_key := $1)).id",
        [`capacity-maintenance:${randomUUID()}`],
      );
      const jobId = String(result.rows[0].id);
      await expect
        .poll(
          async () => {
            const jobs = await fixture.database.pool.query(
              'SELECT id FROM graphile_worker._private_jobs WHERE id=$1',
              [jobId],
            );
            return jobs.rowCount;
          },
          { timeout: 20000 },
        )
        .toBe(0);
      return { jobId, completedAt: new Date().toISOString() };
    },
    async close() {
      fixture.s3.releaseHolds();
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.close();
    },
  };
}
