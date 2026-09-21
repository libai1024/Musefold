import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@musefold/core/db';
import { DB_NAME } from '@musefold/core/constants';
import { startHeadlessServe } from '../serve-runtime';

afterEach(() => vi.unstubAllEnvs());

describe('actual headless generation lifecycle', () => {
  it('keeps ownership until active generation is cancelled and finalized, and makes stop idempotent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'musefold-serve-lifecycle-'));
    vi.stubEnv('MUSEFOLD_E2E', '1');
    vi.stubEnv('MUSEFOLD_PROVIDER_KEY_SHUTDOWN', 'synthetic-headless-key');
    let upstream: ServerResponse | undefined;
    let sends = 0;
    const errors: string[] = [];
    const provider = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* drain synthetic body */
      }
      sends++;
      upstream = response;
    });
    let handle: Awaited<ReturnType<typeof startHeadlessServe>> | undefined;
    try {
      await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('missing fixture port');
      handle = await startHeadlessServe({
        dataDir: directory,
        port: 0,
        log: (line) => {
          if (line.includes('ERROR')) errors.push(line);
        },
      });
      getDb()
        .prepare(`INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at)
        VALUES('shutdown','synthetic','openai-compatible',?,'fixture-model',1,1,1,1)`)
        .run(`http://127.0.0.1:${address.port}/v1`);
      const response = await fetch(`http://127.0.0.1:${handle.port}/v1/generations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${handle.token}`,
          'content-type': 'application/json',
          'idempotency-key': 'headless-shutdown-test',
        },
        body: JSON.stringify({
          providerId: 'shutdown',
          prompt: 'synthetic',
          consent: 'interactive',
          n: 1,
        }),
      });
      expect(response.status).toBe(202);
      await response.json();
      await vi.waitFor(() => expect(sends).toBe(1));
      const before = getDb().prepare('SELECT id,status FROM generation_runs').get() as {
        id: string;
        status: string;
      };
      expect(before.status).toBe('running');
      const stopping = handle.stop();
      expect(handle.stop()).toBe(stopping);
      expect(existsSync(join(directory, 'owner.lock'))).toBe(true);
      expect(
        getDb().prepare('SELECT status FROM generation_runs WHERE id = ?').get(before.id),
      ).toEqual({ status: 'cancelled' });
      await stopping;
      expect(existsSync(join(directory, 'owner.lock'))).toBe(false);
      expect(existsSync(join(directory, 'automation.json'))).toBe(false);
      const db = new Database(join(directory, DB_NAME), { readonly: true });
      try {
        expect(
          db.prepare('SELECT status,actual_cost FROM generation_runs WHERE id = ?').get(before.id),
        ).toEqual({ status: 'cancelled', actual_cost: null });
        expect(db.prepare('SELECT COUNT(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
      } finally {
        db.close();
      }
      expect(sends).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      upstream?.destroy();
      await handle?.stop();
      provider.closeAllConnections();
      await new Promise<void>((done) => provider.close(() => done()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
