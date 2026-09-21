import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncPushResult } from '@musefold/contracts';
import { SyncDeviceProcess } from './fixtures/sync-device-process';
import type { startPackageExchangeApp } from '../../apps/api/src/__tests__/fixtures/package-exchange-app';

const describeDatabase = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase(
  'D03.5 two independent SQLite client processes against authenticated HTTP/PG',
  () => {
    let backend: Awaited<ReturnType<typeof startPackageExchangeApp>>;
    let server: ReturnType<typeof createServer>;
    let directory: string;
    let a: SyncDeviceProcess;
    let b: SyncDeviceProcess;
    let ownerId: string;
    const clients: SyncDeviceProcess[] = [];
    let evidence: Record<string, unknown>;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'musefold-two-sync-'));
      evidence = {
        startedAt: new Date().toISOString(),
        provenance:
          'synthetic data; real core/SQLite/Hono/Better Auth/PG; controlled upstream New API',
      };
      const { startPackageExchangeApp } = await import(
        '../../apps/api/src/__tests__/fixtures/package-exchange-app'
      );
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
          const body = Buffer.concat(chunks);
          const response = await backend.app.fetch(
            new Request(`http://127.0.0.1:3399${incoming.url}`, {
              method: incoming.method,
              headers,
              ...(body.length ? { body } : {}),
            }),
          );
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie') outgoing.setHeader(key, value);
          });
          outgoing.setHeader('set-cookie', response.headers.getSetCookie());
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          outgoing.writeHead(500).end();
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP server port');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      async function authenticate(signup: boolean) {
        const response = await fetch(
          `${baseUrl}/api/auth/${signup ? 'sign-up' : 'sign-in'}/new-api`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3399' },
            body: JSON.stringify({ email: 'tester@musefold.app', password: 'correct-password' }),
          },
        );
        expect(response.status).toBe(200);
        const cookie = response.headers
          .getSetCookie()
          .map((part) => part.split(';')[0])
          .join('; ');
        expect(Boolean(cookie)).toBe(true);
        return cookie;
      }
      const firstCookie = await authenticate(true);
      const secondCookie = await authenticate(false);
      expect(firstCookie === secondCookie).toBe(false);
      ownerId = String((await backend.database.pool.query('SELECT id FROM "user"')).rows[0].id);
      a = new SyncDeviceProcess({
        directory: join(directory, 'a'),
        ownerId,
        deviceId: randomUUID(),
        baseUrl,
        cookie: firstCookie,
      });
      b = new SyncDeviceProcess({
        directory: join(directory, 'b'),
        ownerId,
        deviceId: randomUUID(),
        baseUrl,
        cookie: secondCookie,
      });
      clients.push(a, b);
      const [initialA, initialB] = await Promise.all([a.start(), b.start()]);
      expect(initialA.pid).not.toBe(initialB.pid);
      expect(initialA.pid).not.toBe(process.pid);
      expect(initialA.account?.deviceId).not.toBe(initialB.account?.deviceId);
      evidence.initial = [initialA, initialB];
      await a.sync();
      await b.sync();
    }, 120000);

    afterEach(async (context) => {
      try {
        evidence.test = context.task.name;
        evidence.state = context.task.result?.state;
        evidence.finishedAt = new Date().toISOString();
        evidence.devices = await Promise.all(
          clients.map(async (client) => {
            if (client.child.exitCode !== null || client.child.signalCode !== null)
              return { pid: client.child.pid, exited: await client.closed };
            return client.snapshot();
          }),
        );
        evidence.exits = await Promise.all(clients.splice(0).map((client) => client.stop()));
        const output = process.env.TWO_DEVICE_RESULTS_DIR;
        if (output) {
          await mkdir(output, { recursive: true });
          await writeFile(join(output, `${randomUUID()}.json`), JSON.stringify(evidence, null, 2));
        }
      } finally {
        server?.closeAllConnections();
        if (server)
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        await backend?.close();
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }, 60000);

    async function create(client: SyncDeviceProcess, title: string) {
      return client.request<{ id: string }>({
        action: 'create',
        input: { title, content: `${title} 正文🌱` },
      });
    }

    it('bootstraps paginated folder/tag dependencies and preserves independent offline edits', async () => {
      const taxonomy = await a.request<{ folder: string; tag: string }>({ action: 'taxonomy' });
      await a.request({ action: 'taxonomy' });
      await create(a, '第二页提示词');
      const p = await a.request<{ id: string }>({
        action: 'create',
        input: {
          title: '分类与引用',
          content: '非 ASCII 内容🌱',
          folderId: taxonomy.folder,
          tagIds: [taxonomy.tag],
        },
      });
      await a.sync();
      // New process/empty device B database forces actual multi-entity bootstrap.
      await b.stop();
      b = new SyncDeviceProcess({
        ...b.setup,
        directory: join(directory, 'b-bootstrap'),
        deviceId: randomUUID(),
      });
      clients.push(b);
      await b.start();
      const bootstrapped = await b.sync();
      for (const entity of ['folder', 'tag', 'prompt']) {
        expect(
          bootstrapped.trace.some((entry) => {
            if (!entry.path.startsWith('bootstrap?')) return false;
            const params = new URLSearchParams(entry.path.split('?')[1]);
            return params.get('entity') === entity && params.has('after') && entry.status === 200;
          }),
        ).toBe(true);
      }
      expect(bootstrapped.prompts).toContainEqual(
        expect.objectContaining({
          id: p.id,
          folderId: taxonomy.folder,
          tags: expect.arrayContaining([expect.objectContaining({ id: taxonomy.tag })]),
        }),
      );
      expect(bootstrapped.foreignKeys).toEqual([]);
      expect(bootstrapped.integrity).toBe('ok');
      await a.request({ action: 'fault', offline: true });
      const local = await create(a, '离线新内容');
      const pending = await a.snapshot();
      await expect(a.sync()).rejects.toMatchObject({ code: 'OFFLINE' });
      expect((await a.snapshot()).outbox).toEqual(pending.outbox);
      await a.request({ action: 'fault', offline: false });
      await a.sync();
      expect((await b.sync()).prompts.map((item) => item.id)).toContain(local.id);
    }, 60000);

    for (const resolution of ['remote', 'local', 'duplicate'] as const) {
      it(`resolves ${resolution} conflict after both devices edit the same offline version`, async () => {
        const p = await create(a, '共同版本');
        await a.sync();
        await b.sync();
        await a.request({ action: 'fault', offline: true });
        await b.request({ action: 'fault', offline: true });
        await a.request({
          action: 'update',
          id: p.id,
          patch: { title: '设备 A 修改', content: 'A 本地正文' },
        });
        await b.request({
          action: 'update',
          id: p.id,
          patch: { title: '设备 B 修改', content: 'B 远端正文' },
        });
        await b.request({ action: 'fault', offline: false });
        await b.sync();
        await a.request({ action: 'fault', offline: false });
        const conflict = await a.sync();
        expect(conflict.conflicts).toHaveLength(1);
        expect(conflict.conflicts[0]).toMatchObject({
          entityId: p.id,
          localSnapshot: { content: 'A 本地正文' },
          remoteSnapshot: { content: 'B 远端正文' },
        });
        await a.request({ action: 'resolve', id: conflict.conflicts[0].id, resolution });
        const finalA = await a.sync();
        const finalB = await b.sync();
        const content = (s: typeof finalA) =>
          s.prompts
            .map((item) => ({ id: item.id, title: item.title, content: item.content }))
            .sort((x, y) => x.id.localeCompare(y.id));
        expect(content(finalA)).toEqual(content(finalB));
        expect(finalA.conflicts).toEqual([]);
        expect(finalA.outbox).toEqual([]);
        const expected = resolution === 'local' ? 'A 本地正文' : 'B 远端正文';
        expect(finalA.prompts.find((item) => item.id === p.id)?.content).toBe(expected);
        expect(finalA.prompts).toHaveLength(resolution === 'duplicate' ? 2 : 1);
        if (resolution === 'duplicate')
          expect(finalA.prompts).toContainEqual(
            expect.objectContaining({ title: '设备 A 修改（本地副本）', content: 'A 本地正文' }),
          );
        evidence.conflict = conflict;
      }, 60000);
    }

    it('restarts with the same durable mutation after a committed push response is lost; replay is idempotent', async () => {
      const p = await create(a, '回包丢失');
      const before = await a.snapshot();
      expect(before.outbox).toHaveLength(1);
      await a.request({ action: 'fault', dropNextPush: true });
      await expect(a.sync()).rejects.toMatchObject({ code: 'RESPONSE_LOST' });
      const after = await a.snapshot();
      expect(after.outbox).toEqual(before.outbox);
      expect(
        (await backend.database.pool.query('SELECT id FROM prompts WHERE id=$1', [p.id])).rowCount,
      ).toBe(1);
      expect(await a.crash()).toMatchObject({ signal: 'SIGKILL' });
      const oldPid = after.pid;
      a = new SyncDeviceProcess(a.setup);
      clients.push(a);
      const restarted = await a.start();
      expect(restarted.pid).not.toBe(oldPid);
      expect(restarted.account?.deviceId).toBe(before.account?.deviceId);
      expect(restarted.outbox).toEqual(before.outbox);
      const recovered = await a.sync();
      expect(recovered.conflicts).toEqual([]);
      expect(recovered.outbox).toEqual([]);
      // Exercise the exact original batch again and concurrently, independent of
      // pull reconciliation removing an acknowledged outbox before the next push.
      const input = { deviceId: a.setup.deviceId, mutations: before.outbox };
      const replay = await Promise.all([
        a.request<SyncPushResult>({ action: 'push', input }),
        b.request<SyncPushResult>({ action: 'push', input }),
      ]);
      for (const result of replay) expect(result.results[0].status).toBe('duplicate');
      const changed = await a.request<SyncPushResult>({
        action: 'push',
        input: {
          ...input,
          mutations: [
            {
              ...before.outbox[0],
              payload: { ...before.outbox[0].payload, title: 'changed replay' },
            },
          ],
        },
      });
      expect(changed.results[0].status).toBe('rejected');
      expect(
        (
          await backend.database.pool.query('SELECT seq FROM sync_change_log WHERE entity_id=$1', [
            p.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await backend.database.pool.query(
            'SELECT mutation_id FROM sync_mutation_results WHERE entity_id=$1',
            [p.id],
          )
        ).rowCount,
      ).toBe(1);
      expect((await b.sync()).prompts.filter((item) => item.id === p.id)).toHaveLength(1);
      evidence.restarted = restarted;
      evidence.replay = replay;
    }, 60000);

    it('revokes a device between two real mutation transactions while retaining the partial batch locally', async () => {
      const first = await create(a, '撤销前允许提交');
      const second = await create(a, '撤销后禁止提交');
      const pending = await a.snapshot();
      expect(pending.outbox).toHaveLength(2);
      expect(pending.ready[0].entityId).toBe(first.id);
      const holder = await backend.database.pool.connect();
      const revoker = await backend.database.pool.connect();
      let released = false;
      let sync: Promise<unknown> | undefined;
      let revoke: Promise<unknown> | undefined;
      try {
        await holder.query('SELECT pg_advisory_lock(66001)');
        // Installed only in this disposable database. First mutation already owns
        // the production device row lock when this prompt trigger blocks.
        await backend.database.pool.query(`CREATE FUNCTION block_first_sync_prompt() RETURNS trigger AS $$
        BEGIN IF NEW.id = '${first.id}' THEN PERFORM pg_advisory_xact_lock(66001); END IF; RETURN NEW; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER block_first_sync_prompt BEFORE INSERT ON prompts FOR EACH ROW EXECUTE FUNCTION block_first_sync_prompt()`);
        sync = a.sync().then(
          () => ({ succeeded: true }),
          (error) => ({ code: error.code, message: error.message }),
        );
        async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            const value = await read();
            if (value !== undefined) return value;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error('Expected actual PostgreSQL lock dependency was not observed');
        }
        const blockedPid = await waitFor(async () => {
          const result = await backend.database.pool.query(
            "SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=66001 AND NOT granted",
          );
          return result.rows[0]?.pid as number | undefined;
        });
        const revokerPid = Number(
          (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        // Models the control-plane revocation write; there is no public revoke UI
        // in this acceptance. Real SyncService checks/transactions are unchanged.
        revoke = revoker.query(
          'UPDATE sync_devices SET revoked_at=now() WHERE user_id=$1 AND device_id=$2',
          [ownerId, a.setup.deviceId],
        );
        const observedBlockers = await waitFor(async () => {
          const pids = (
            await backend.database.pool.query('SELECT pg_blocking_pids($1) AS pids', [revokerPid])
          ).rows[0].pids as number[];
          return pids.includes(blockedPid) ? pids : undefined;
        });
        await holder.query('SELECT pg_advisory_unlock(66001)');
        released = true;
        await revoke;
        const result = await sync;
        expect(result).toMatchObject({ code: 'VALIDATION_FAILED' });
        const rows = (await backend.database.pool.query('SELECT id FROM prompts ORDER BY id')).rows;
        expect(rows).toEqual([{ id: first.id }]);
        expect(
          (await backend.database.pool.query('SELECT mutation_id FROM sync_mutation_results'))
            .rowCount,
        ).toBe(1);
        const local = await a.snapshot();
        expect(local.outbox).toEqual(pending.outbox);
        expect(local.prompts.map((p) => p.id)).toContain(second.id);
        await expect(a.sync()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const finalB = await b.sync();
        expect(finalB.prompts.map((p) => p.id)).toEqual([first.id]);
        const bPrompt = await create(b, '另一设备仍可同步');
        await b.sync();
        expect(
          (await backend.database.pool.query('SELECT id FROM prompts WHERE id=$1', [bPrompt.id]))
            .rowCount,
        ).toBe(1);
        expect(
          (await backend.database.pool.query('SELECT id FROM prompts WHERE id=$1', [second.id]))
            .rowCount,
        ).toBe(0);
        evidence.revocation = {
          blockedPid,
          revokerPid,
          observedBlockers,
          result,
          first: first.id,
          denied: second.id,
        };
      } finally {
        if (!released) await holder.query('SELECT pg_advisory_unlock(66001)');
        await Promise.allSettled([sync, revoke]);
        holder.release();
        revoker.release();
      }
    }, 60000);

    it('recovers an expired cursor via real retention and bootstrap without discarding offline content or device watermarks', async () => {
      const p = await create(a, '游标前的共同版本');
      await a.sync();
      await b.sync();
      await a.request({ action: 'fault', offline: true });
      await a.request({ action: 'update', id: p.id, patch: { content: '离线仍需保留的正文' } });
      const newLocal = await create(a, '离线未上传新建');
      const pending = await a.snapshot();
      await b.request({ action: 'update', id: p.id, patch: { content: '云端同时修改的正文' } });
      await b.sync();
      await create(b, '裁剪边界前最后变更');
      await b.sync();
      const cutoff = (
        await backend.database.pool.query('SELECT max(seq) AS seq FROM sync_change_log')
      ).rows[0].seq;
      await create(b, '保留的较新变更');
      await b.sync();
      const beforeDevices = (
        await backend.database.pool.query(
          'SELECT device_id,last_pull_cursor FROM sync_devices ORDER BY device_id',
        )
      ).rows;
      // Synthetic historical dates, explicitly not a natural 90-day wait. The
      // production retention transaction determines the actual server watermark.
      await backend.database.pool.query(
        "UPDATE sync_change_log SET created_at=now()-interval '91 days' WHERE seq <= $1",
        [cutoff],
      );
      const { trimExpiredSyncRecords } = await import('../../apps/worker/src/sync-retention');
      const retention = await trimExpiredSyncRecords(backend.database.db);
      expect(retention.changeLogs).toBe(3);
      expect(BigInt(retention.minAvailableCursor)).toBeGreaterThan(
        BigInt(pending.account?.cursor ?? '0'),
      );
      expect(
        (
          await backend.database.pool.query(
            'SELECT device_id,last_pull_cursor FROM sync_devices ORDER BY device_id',
          )
        ).rows,
      ).toEqual(beforeDevices);
      await a.request({ action: 'fault', offline: false });
      await expect(a.sync()).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED' });
      const reset = await a.snapshot();
      expect(reset.account).toMatchObject({
        deviceId: pending.account?.deviceId,
        cursor: '0',
        bootstrapCompletedAt: null,
        consent: 'enabled',
      });
      expect(reset.outbox).toEqual(pending.outbox);
      const bootstrapped = await a.sync();
      expect(bootstrapped.conflicts).toHaveLength(1);
      expect(bootstrapped.conflicts[0].localSnapshot.content).toBe('离线仍需保留的正文');
      expect(bootstrapped.prompts.find((item) => item.id === newLocal.id)?.title).toBe(
        '离线未上传新建',
      );
      await a.request({ action: 'resolve', id: bootstrapped.conflicts[0].id, resolution: 'local' });
      const finalA = await a.sync();
      const finalB = await b.sync();
      for (const state of [finalA, finalB]) {
        expect(state.conflicts).toEqual([]);
        expect(state.outbox).toEqual([]);
        expect(state.prompts).toHaveLength(4);
        expect(state.prompts.find((item) => item.id === p.id)?.content).toBe('离线仍需保留的正文');
        expect(state.integrity).toBe('ok');
        expect(state.foreignKeys).toEqual([]);
      }
      const finalDevices = (
        await backend.database.pool.query(
          'SELECT device_id,last_pull_cursor FROM sync_devices ORDER BY device_id',
        )
      ).rows;
      expect(finalDevices.map((d) => d.device_id)).toEqual(beforeDevices.map((d) => d.device_id));
      for (let i = 0; i < finalDevices.length; i++)
        expect(BigInt(finalDevices[i].last_pull_cursor)).toBeGreaterThanOrEqual(
          BigInt(beforeDevices[i].last_pull_cursor),
        );
      evidence.retention = { retention, beforeDevices, finalDevices, reset, bootstrapped };
    }, 60000);

    it('recovers after all log rows expire, with a usable bootstrap cursor for existing and empty owners', async () => {
      const p = await create(a, '全日志过期前');
      await a.sync();
      await b.sync();
      const before = await a.snapshot();
      await b.request({ action: 'update', id: p.id, patch: { content: '离线期间的云端第二版' } });
      await b.sync();
      await backend.database.pool.query(
        "UPDATE sync_change_log SET created_at=now()-interval '91 days'",
      );
      const { trimExpiredSyncRecords } = await import('../../apps/worker/src/sync-retention');
      const trim = await trimExpiredSyncRecords(backend.database.db);
      expect(trim).toMatchObject({ changeLogs: 2, minAvailableCursor: 2 });
      await expect(a.sync()).rejects.toMatchObject({ code: 'SYNC_CURSOR_EXPIRED' });
      const recovered = await a.sync();
      expect(recovered.account).toMatchObject({ deviceId: before.account?.deviceId, cursor: '2' });
      expect(recovered.prompts.find((item) => item.id === p.id)?.content).toBe(
        '离线期间的云端第二版',
      );
      expect(recovered.conflicts).toEqual([]);
      expect(recovered.outbox).toEqual([]);
      expect((await b.sync()).account?.cursor).toBe('2');
      const watermark = (await backend.database.pool.query('SELECT * FROM sync_retention_state'))
        .rows;
      const repeated = await Promise.all([
        trimExpiredSyncRecords(backend.database.db),
        trimExpiredSyncRecords(backend.database.db),
      ]);
      expect(repeated).toEqual([
        expect.objectContaining({ purged: 0, minAvailableCursor: 2 }),
        expect.objectContaining({ purged: 0, minAvailableCursor: 2 }),
      ]);
      expect(
        (await backend.database.pool.query('SELECT * FROM sync_retention_state')).rows,
      ).toEqual(watermark);
      const login = await fetch(`${a.setup.baseUrl}/api/auth/sign-up/new-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3399' },
        body: JSON.stringify({ email: 'empty-owner@musefold.app', password: 'correct-password' }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers
        .getSetCookie()
        .map((part) => part.split(';')[0])
        .join('; ');
      const response = await fetch(
        `${a.setup.baseUrl}/api/v1/sync/bootstrap?entity=prompt&limit=1`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      const empty = await response.json();
      expect(empty).toEqual({ snapshotCursor: '2', items: [], nextPage: null });
      const next = await fetch(
        `${a.setup.baseUrl}/api/v1/sync/pull?cursor=${empty.snapshotCursor}&limit=1`,
        { headers: { cookie } },
      );
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ changes: [], nextCursor: '2', hasMore: false });
      evidence.emptyRetention = { trim, repeated, watermark, empty };
    }, 60000);

    it('reads one consistent pull snapshot when retention commits while the device lock is blocked', async () => {
      const p = await create(a, '并发裁剪前');
      await a.sync();
      await b.sync();
      await b.request({ action: 'update', id: p.id, patch: { content: '必须收到的更新' } });
      await b.sync();
      await backend.database.pool.query(
        "UPDATE sync_change_log SET created_at=now()-interval '91 days'",
      );
      const holder = await backend.database.pool.connect();
      let pending: Promise<{ status: number; body: unknown }> | undefined;
      let released = false;
      try {
        await holder.query('BEGIN');
        await holder.query(
          'SELECT device_id FROM sync_devices WHERE user_id=$1 AND device_id=$2 FOR UPDATE',
          [ownerId, a.setup.deviceId],
        );
        const holderPid = Number(
          (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        pending = fetch(
          `${a.setup.baseUrl}/api/v1/sync/pull?cursor=1&limit=100&deviceId=${a.setup.deviceId}`,
          { headers: { cookie: a.setup.cookie }, signal: AbortSignal.timeout(30000) },
        ).then(async (response) => ({ status: response.status, body: await response.json() }));
        const deadline = Date.now() + 15000;
        let blockedPid: number | undefined;
        while (Date.now() < deadline && blockedPid === undefined) {
          const rows = await backend.database.pool.query(
            'SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
            [holderPid],
          );
          blockedPid = rows.rows[0]?.pid;
          if (blockedPid === undefined) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blockedPid).toBeTypeOf('number');
        const { trimExpiredSyncRecords } = await import('../../apps/worker/src/sync-retention');
        const trim = await trimExpiredSyncRecords(backend.database.db);
        expect(trim).toMatchObject({ changeLogs: 2, minAvailableCursor: 2 });
        await holder.query('COMMIT');
        released = true;
        const response = await pending;
        expect(response).toMatchObject({
          status: 200,
          body: {
            nextCursor: '2',
            hasMore: false,
            changes: [
              expect.objectContaining({
                version: 2,
                entityId: p.id,
                snapshot: expect.objectContaining({ content: '必须收到的更新' }),
              }),
            ],
          },
        });
        evidence.pullRetentionRace = { holderPid, blockedPid, trim, response };
      } finally {
        if (!released) await holder.query('ROLLBACK');
        await Promise.allSettled([pending]);
        holder.release();
      }
    }, 60000);
  },
);
