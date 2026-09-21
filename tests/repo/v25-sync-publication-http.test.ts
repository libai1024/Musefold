import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  newPromptDocumentSchema,
  syncBootstrapPageSchema,
  syncPullResultSchema,
} from '@musefold/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startPackageExchangeApp } from '../../apps/api/src/__tests__/fixtures/package-exchange-app';
import { PromptService } from '../../apps/api/src/modules/prompts/service';

const describeDb = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const input = newPromptDocumentSchema.parse({
  title: 'Synthetic late publication',
  description: null,
  content: 'Synthetic',
  negative: null,
  folderId: null,
  modelId: null,
  params: null,
});

describeDb('sync publication over authenticated HTTP and real PostgreSQL', () => {
  let backend: Awaited<ReturnType<typeof startPackageExchangeApp>>;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string, cookie: string, owner: string;
  beforeEach(async () => {
    backend = await startPackageExchangeApp();
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value))
            value.forEach((v) => {
              headers.append(key, v);
            });
          else if (value !== undefined) headers.set(key, value);
        }
        const bytes = Buffer.concat(chunks);
        const result = await backend.app.fetch(
          new Request(`http://127.0.0.1:3399${incoming.url}`, {
            method: incoming.method,
            headers,
            ...(bytes.length ? { body: bytes } : {}),
          }),
        );
        outgoing.statusCode = result.status;
        result.headers.forEach((value, key) => {
          if (key !== 'set-cookie') outgoing.setHeader(key, value);
        });
        outgoing.setHeader('set-cookie', result.headers.getSetCookie());
        outgoing.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        outgoing.statusCode = 500;
        outgoing.end('Fixture transport failure');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${baseUrl}/api/auth/sign-up/new-api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3399' },
      body: JSON.stringify({ email: 'publication@musefold.app', password: 'correct-password' }),
    });
    expect(login.status).toBe(200);
    await login.arrayBuffer();
    cookie = login.headers
      .getSetCookie()
      .map((part) => part.split(';')[0])
      .join('; ');
    expect(Boolean(cookie)).toBe(true);
    owner = String((await backend.database.pool.query('SELECT id FROM "user"')).rows[0].id);
  }, 180_000);
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    await backend?.close();
  }, 30_000);
  const request = (path: string, body?: unknown) =>
    fetch(`${baseUrl}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: 'http://127.0.0.1:3399', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  async function waitFor(query: string, values: unknown[] = []) {
    const until = Date.now() + 3000;
    do {
      if ((await backend.database.pool.query(query, values)).rowCount) return;
      await delay(10);
    } while (Date.now() < until);
    throw new Error('Expected real PostgreSQL lock wait was not observed');
  }

  it.each(['pull', 'bootstrap'] as const)(
    '%s includes a delayed REST commit before advancing the cursor',
    async (kind) => {
      const holder = await backend.database.pool.connect();
      let late: Promise<Response> | undefined, read: Promise<Response> | undefined;
      try {
        await backend.database.pool.query(`CREATE FUNCTION hold_publication() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.snapshot->>'title'='Synthetic late publication' THEN
          PERFORM pg_advisory_xact_lock(77400077); END IF; RETURN NEW; END $$;
        CREATE TRIGGER hold_publication AFTER INSERT ON sync_change_log
        FOR EACH ROW EXECUTE FUNCTION hold_publication()`);
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(77400077)');
        const pid = Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        late = request('/prompts', input);
        await waitFor('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid]);
        const early = await request('/prompts', { ...input, title: 'Synthetic early publication' });
        expect(early.status).toBe(201);
        const earlyBody = await early.json();
        read = request(
          kind === 'pull'
            ? '/sync/pull?cursor=0&limit=100'
            : '/sync/bootstrap?entity=prompt&limit=100',
        );
        await waitFor(
          "SELECT 1 FROM pg_locks WHERE relation='sync_change_log'::regclass AND mode='ShareLock' AND NOT granted",
        );
        await holder.query('COMMIT');
        const created = await late;
        expect(created.status).toBe(201);
        const lateBody = await created.json();
        const response = await read;
        expect(response.status).toBe(200);
        const body = await response.json();
        const page =
          kind === 'pull' ? syncPullResultSchema.parse(body) : syncBootstrapPageSchema.parse(body);
        const ids =
          'changes' in page ? page.changes.map((x) => x.entityId) : page.items.map((x) => x.id);
        expect(new Set(ids)).toEqual(new Set([lateBody.id, earlyBody.id]));
        const cursor = 'changes' in page ? page.nextCursor : page.snapshotCursor;
        const next = await request(`/sync/pull?cursor=${cursor}&limit=100`);
        expect(next.status).toBe(200);
        expect(syncPullResultSchema.parse(await next.json()).changes).toEqual([]);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        await Promise.allSettled([late, read]);
        await backend.database.pool.query('DROP FUNCTION IF EXISTS hold_publication() CASCADE');
      }
    },
    15_000,
  );

  it('returns a safe retryable HTTP 503 while a writer is pending and preserves the device cursor', async () => {
    const deviceId = randomUUID(),
      id = randomUUID();
    const registered = await request('/sync/devices', {
      deviceId,
      name: 'Synthetic',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    expect(registered.status).toBe(201);
    await registered.arrayBuffer();
    let release!: () => void, signal!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const writer = backend.database.db.transaction(async (tx) => {
      await new PromptService(backend.database.db).createPrompt(owner, input, id, { tx });
      signal();
      await gate;
    });
    void writer.catch(() => {});
    try {
      await Promise.race([ready, writer]);
      const response = await request(`/sync/pull?cursor=0&limit=100&deviceId=${deviceId}`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: 'INTERNAL_ERROR', retryable: true, message: '同步数据正在提交，请稍后重试' },
      });
      expect(
        (
          await backend.database.pool.query(
            'SELECT last_pull_cursor FROM sync_devices WHERE device_id=$1',
            [deviceId],
          )
        ).rows,
      ).toEqual([{ last_pull_cursor: '0' }]);
      release();
      await writer;
      const resumed = await request(`/sync/pull?cursor=0&limit=100&deviceId=${deviceId}`);
      expect(resumed.status).toBe(200);
      expect(
        syncPullResultSchema.parse(await resumed.json()).changes.map((x) => x.entityId),
      ).toEqual([id]);
    } finally {
      release();
      await writer;
    }
  }, 15_000);
});
