import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  syncBootstrapPageSchema,
  syncDeviceSchema,
  syncMutationSchema,
  syncPullResultSchema,
  syncPushRequestSchema,
  syncPushResultSchema,
  type SyncMutation,
} from '@musefold/contracts';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDesktopSyncApp } from '../fixtures/desktop-sync-app.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const identitySchema = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string().min(1) }),
});
type Identity = z.infer<typeof identitySchema> & { deviceId: string };
const kinds = ['folder', 'tag'] as const;

describeDb('permanent taxonomy identity over actual HTTP and worker retention', () => {
  let app: Awaited<ReturnType<typeof startDesktopSyncApp>>;
  let evidence: Record<string, unknown>;
  beforeEach(async () => {
    evidence = { startedAt: new Date().toISOString() };
    app = await startDesktopSyncApp();
    evidence.backend = app.ready;
  }, 180000);
  afterEach(async () => {
    try {
      if (app) evidence.final = await app.snapshot();
    } finally {
      if (app) evidence.cleanup = await app.close();
      const root = fileURLToPath(
        new URL('../../../../../tests/v25/.results/b75/retention-http-evidence/', import.meta.url),
      );
      mkdirSync(root, { recursive: true });
      const directory = mkdtempSync(join(root, 'run-'));
      writeFileSync(join(directory, 'result.json'), JSON.stringify(evidence, null, 2));
    }
  });
  async function request(
    identity: Identity | undefined,
    path: string,
    method = 'GET',
    body?: unknown,
  ) {
    return fetch(`${app.ready.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: app.ready.baseUrl,
        'x-musefold-login-binding': 'synthetic-taxonomy-main-process-binding-123456',
        ...(identity ? { authorization: `Bearer ${identity.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  }
  async function login(username: 'b67-alice' | 'b67-bob'): Promise<Identity> {
    const response = await request(undefined, '/api/auth/sign-in/new-api', 'POST', {
      email: username,
      password: 'fixture-password',
    });
    expect(response.status).toBe(200);
    const identity = { ...identitySchema.parse(await response.json()), deviceId: randomUUID() };
    expect(
      (
        await request(identity, '/api/v1/account/login-sessions/touch', 'POST', {
          acknowledge: true,
        })
      ).status,
    ).toBe(200);
    const registered = await request(identity, '/api/v1/sync/devices', 'POST', {
      deviceId: identity.deviceId,
      name: 'Owned retention client',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    expect(registered.status).toBe(201);
    expect(syncDeviceSchema.parse(await registered.json()).deviceId).toBe(identity.deviceId);
    return identity;
  }
  async function push(identity: Identity, mutations: SyncMutation[]) {
    const response = await request(
      identity,
      '/api/v1/sync/push',
      'POST',
      syncPushRequestSchema.parse({ deviceId: identity.deviceId, mutations }),
    );
    expect(response.status).toBe(200);
    return syncPushResultSchema.parse(await response.json()).results;
  }
  async function bootstrap(identity: Identity, kind: 'folder' | 'tag', limit = 7, after?: string) {
    const query = new URLSearchParams({
      entity: kind,
      limit: String(limit),
      ...(after ? { after } : {}),
    });
    const response = await request(identity, `/api/v1/sync/bootstrap?${query}`);
    expect(response.status).toBe(200);
    return syncBootstrapPageSchema.parse(await response.json());
  }
  const create = (kind: 'folder' | 'tag', id: string, name: string) =>
    syncMutationSchema.parse({
      mutationId: randomUUID(),
      entityType: kind,
      entityId: id,
      operation: 'create',
      baseVersion: null,
      payload:
        kind === 'folder'
          ? { name, parentId: null, sortOrder: 0 }
          : { name, group: null, color: null },
    });

  it.each(kinds)(
    '%s preserves original receipts, rejects expired replay and isolates another owner reusing the ID',
    async (kind) => {
      const alice = await login('b67-alice');
      const bob = await login('b67-bob');
      const id = randomUUID();
      const original = create(kind, id, 'Original private name');
      const [accepted] = await push(alice, [original]);
      expect(accepted).toMatchObject({ status: 'applied', version: 1 });
      const beforeDeletion = await bootstrap(alice, kind);
      const deleted = await request(
        alice,
        `/api/v1/${kind === 'folder' ? 'folders' : 'tags'}/${id}`,
        'DELETE',
        { expectedVersion: 1 },
      );
      expect(deleted.status).toBe(200);
      const deletion = await deleted.json();
      expect(deletion).toMatchObject({ id, version: 2, deletedAt: expect.any(String) });
      const originalReceipt = (await app.snapshot()).receipts.find(
        (r) => r.mutationId === original.mutationId,
      );

      // An existing receipt stays the historical result; replay must not re-execute its create.
      expect((await push(alice, [original]))[0]).toEqual({ ...accepted, status: 'duplicate' });
      expect((await app.snapshot()).classifications).toEqual([]);
      expect(
        (await app.snapshot()).receipts.find((r) => r.mutationId === original.mutationId),
      ).toEqual(originalReceipt);
      expect(
        (
          await push(alice, [
            { ...original, payload: { ...original.payload, name: 'Changed payload' } },
          ])
        )[0],
      ).toMatchObject({
        status: 'rejected',
        errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
        snapshot: null,
      });
      const restore = syncMutationSchema.parse({
        ...original,
        mutationId: randomUUID(),
        operation: 'restore',
        baseVersion: 2,
        payload: {},
      });
      expect((await push(alice, [restore]))[0]).toMatchObject({
        status: 'rejected',
        errorCode: 'VALIDATION_FAILED',
      });

      // Persistent deletion identity is owner-scoped. Reuse in another owner must not leak names or mutate their row.
      const bobCreate = create(kind, id, 'Other owner private name');
      expect((await push(bob, [bobCreate]))[0]).toMatchObject({ status: 'applied', version: 1 });
      const beforeTrim = await app.snapshot();
      const trim = await app.trimSyncHistory();
      evidence.retention = trim;
      expect(trim.pid).not.toBe(app.ready.apiPid);
      expect(trim.pid).not.toBe(process.pid);
      expect(trim.counts).toEqual({ logs: 0, receipts: 0, markers: 1 });
      expect(trim.stats.mutationResults).toBe(beforeTrim.receipts.length);
      expect(trim.stats.changeLogs).toBeGreaterThan(0);
      expect((await app.snapshot()).taxonomyTombstones).toEqual(beforeTrim.taxonomyTombstones);
      const expired = await request(
        alice,
        `/api/v1/sync/pull?cursor=${beforeDeletion.snapshotCursor}&deviceId=${alice.deviceId}`,
      );
      expect(expired.status).toBe(410);
      expect(await expired.json()).toMatchObject({ error: { code: 'SYNC_CURSOR_EXPIRED' } });

      const page = await bootstrap(alice, kind);
      expect(page.items).toEqual([
        expect.objectContaining({
          id,
          version: 2,
          deletedAt: expect.any(String),
          name: kind === 'folder' ? '已删除文件夹' : '已删除标签',
        }),
      ]);
      expect(JSON.stringify(page)).not.toContain('private name');
      expect(Number(page.snapshotCursor)).toBeGreaterThanOrEqual(trim.stats.minAvailableCursor);
      const pull = await request(
        alice,
        `/api/v1/sync/pull?cursor=${page.snapshotCursor}&deviceId=${alice.deviceId}`,
      );
      expect(pull.status).toBe(200);
      expect(syncPullResultSchema.parse(await pull.json()).changes).toEqual([]);
      for (const retry of [original, { ...original, mutationId: randomUUID() }]) {
        expect((await push(alice, [retry]))[0]).toMatchObject({
          status: 'conflict',
          errorCode: 'SYNC_MUTATION_CONFLICT',
          version: 2,
          snapshot: { id, deletedAt: expect.any(String) },
        });
      }
      expect((await push(alice, [restore]))[0]).toMatchObject({
        status: 'rejected',
        errorCode: 'VALIDATION_FAILED',
      });
      expect((await bootstrap(bob, kind)).items).toEqual([
        expect.objectContaining({
          id,
          name: 'Other owner private name',
          version: 1,
          deletedAt: null,
        }),
      ]);
      expect((await app.snapshot()).classifications).toEqual([
        expect.objectContaining({ ownerId: bob.user.id, id, kind }),
      ]);
      expect((await app.snapshot()).apiOutputSafe).toBe(true);
      expect((await app.snapshot()).unknownUpstreamRequests).toBe(0);
    },
    60000,
  );

  it('paginates mixed live/deleted identities beyond 200 entries per type after log expiry, without omissions or cross-owner leakage', async () => {
    const alice = await login('b67-alice');
    const bob = await login('b67-bob');
    for (const kind of kinds) {
      const mutations = Array.from({ length: 205 }, (_, n) =>
        create(kind, `${kind}-${String(n).padStart(4, '0')}`, `Item ${n}`),
      );
      for (let offset = 0; offset < mutations.length; offset += 100) {
        expect(
          (await push(alice, mutations.slice(offset, offset + 100))).every(
            (r) => r.status === 'applied',
          ),
        ).toBe(true);
      }
      const deletions = mutations
        .filter((_, n) => n % 2 === 0)
        .map((m) =>
          syncMutationSchema.parse({
            ...m,
            mutationId: randomUUID(),
            operation: 'delete',
            baseVersion: 1,
            payload: {},
          }),
        );
      for (let offset = 0; offset < deletions.length; offset += 100) {
        expect(
          (await push(alice, deletions.slice(offset, offset + 100))).every(
            (r) => r.status === 'applied',
          ),
        ).toBe(true);
      }
      await push(bob, [create(kind, `${kind}-0000`, 'Bob private')]);
    }
    const trim = await app.trimSyncHistory();
    evidence.retention = trim;
    expect(trim.counts).toEqual({ logs: 0, receipts: 0, markers: 206 });
    for (const kind of kinds) {
      const all: ReturnType<typeof syncBootstrapPageSchema.parse>['items'] = [];
      let after: string | undefined;
      let pages = 0;
      do {
        const page = await bootstrap(alice, kind, 37, after);
        expect(page.items.length).toBeLessThanOrEqual(37);
        expect(page.snapshotCursor).toBe(String(trim.stats.minAvailableCursor));
        all.push(...page.items);
        after = page.nextPage ?? undefined;
        if (++pages > 10) throw new Error('Bootstrap did not terminate');
      } while (after);
      expect(pages).toBe(6);
      expect(all.map((item) => item.id)).toEqual(
        Array.from({ length: 205 }, (_, n) => `${kind}-${String(n).padStart(4, '0')}`),
      );
      expect(all.filter((item) => item.deletedAt !== null)).toHaveLength(103);
      expect(all.filter((item) => item.deletedAt === null)).toHaveLength(102);
      expect(JSON.stringify(all)).not.toContain('Bob private');
      expect((await bootstrap(bob, kind)).items).toHaveLength(1);
    }
  }, 120000);
});
