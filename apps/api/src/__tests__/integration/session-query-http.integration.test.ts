import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  workbenchSessionPageSchema,
  workbenchSessionSchema,
  workbenchSessionCleanupResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDesktopSyncApp } from '../fixtures/desktop-sync-app.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const identitySchema = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string().min(1) }),
});
type Identity = z.infer<typeof identitySchema>;

describeDb('Session query through actual API bin, Better Auth and PostgreSQL', () => {
  let app: Awaited<ReturnType<typeof startDesktopSyncApp>>;
  let evidence: Record<string, unknown>;
  beforeEach(async () => {
    evidence = {
      startedAt: new Date().toISOString(),
      scope:
        'Actual HTTP/API bin/Better Auth/PG; controlled account provider, no paid generation; microsecond fixtures separately tested at the service layer.',
    };
    app = await startDesktopSyncApp();
    evidence.backend = app.ready;
  }, 180000);
  afterEach(async () => {
    try {
      if (app) evidence.final = await app.snapshot();
    } finally {
      if (app) evidence.cleanup = await app.close();
      const root = fileURLToPath(
        new URL('../../../../../tests/v25/.results/b76/session-http-evidence/', import.meta.url),
      );
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(mkdtempSync(join(root, 'run-')), 'result.json'),
        JSON.stringify(evidence, null, 2),
      );
    }
  });
  const request = (identity: Identity | undefined, path: string, method = 'GET', body?: unknown) =>
    fetch(`${app.ready.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: app.ready.baseUrl,
        'x-musefold-login-binding': 'synthetic-session-query-main-binding-123456',
        ...(identity ? { authorization: `Bearer ${identity.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  async function login(username: string) {
    const response = await request(undefined, '/api/auth/sign-in/new-api', 'POST', {
      email: username,
      password: 'fixture-password',
    });
    expect(response.status).toBe(200);
    const identity = identitySchema.parse(await response.json());
    expect(
      (
        await request(identity, '/api/v1/account/login-sessions/touch', 'POST', {
          acknowledge: true,
        })
      ).status,
    ).toBe(200);
    return identity;
  }
  async function create(identity: Identity, title: string) {
    const response = await request(identity, '/api/v1/workbench/sessions', 'POST', { title });
    expect(response.status).toBe(201);
    return workbenchSessionSchema.parse(await response.json());
  }
  async function list(identity: Identity, query: Record<string, string> = {}) {
    const response = await request(
      identity,
      `/api/v1/workbench/sessions?${new URLSearchParams(query)}`,
    );
    expect(response.status).toBe(200);
    return workbenchSessionPageSchema.parse(await response.json());
  }

  it('purges and clears trash over actual authenticated HTTP, isolates owners and rejects live deletion', async () => {
    const alice = await login('b67-alice');
    const bob = await login('b67-bob');
    const live = await create(alice, 'Retained live Session');
    const single = await create(alice, 'Single purge');
    const archived = await create(alice, 'Archived trash');
    const other = await create(bob, 'Other owner trash');
    expect(
      (
        await request(alice, `/api/v1/workbench/sessions/${archived.id}`, 'PATCH', {
          expectedVersion: 1,
          archived: true,
        })
      ).status,
    ).toBe(200);
    for (const [identity, id] of [
      [alice, single.id],
      [alice, archived.id],
      [bob, other.id],
    ] as const) {
      expect((await request(identity, `/api/v1/workbench/sessions/${id}`, 'DELETE')).status).toBe(
        200,
      );
    }
    const purgePath = `/api/v1/workbench/sessions/${single.id}/purge`;
    expect((await request(undefined, purgePath, 'POST')).status).toBe(401);
    expect(
      (await request(undefined, '/api/v1/workbench/sessions/empty-trash', 'POST')).status,
    ).toBe(401);
    const foreign = await request(bob, purgePath, 'POST');
    expect(foreign.status).toBe(200);
    expect(workbenchSessionCleanupResultSchema.parse(await foreign.json())).toEqual({ purged: 0 });
    const liveResponse = await request(
      alice,
      `/api/v1/workbench/sessions/${live.id}/purge`,
      'POST',
    );
    expect(liveResponse.status).toBe(400);
    expect(await liveResponse.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    for (const count of [1, 0]) {
      const response = await request(alice, purgePath, 'POST');
      expect(response.status).toBe(200);
      expect(workbenchSessionCleanupResultSchema.parse(await response.json())).toEqual({
        purged: count,
      });
    }
    for (const count of [1, 0]) {
      const response = await request(alice, '/api/v1/workbench/sessions/empty-trash', 'POST');
      expect(response.status).toBe(200);
      expect(workbenchSessionCleanupResultSchema.parse(await response.json())).toEqual({
        purged: count,
      });
    }
    expect(
      (await list(alice, { includeArchived: 'true', includeDeleted: 'true' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([live.id]);
    expect((await list(bob, { deletedOnly: 'true' })).items.map((item) => item.id)).toEqual([
      other.id,
    ]);
    expect((await request(alice, `/api/v1/workbench/sessions/${single.id}`)).status).toBe(404);
    expect(
      (await request(alice, `/api/v1/workbench/sessions/${single.id}/restore`, 'POST')).status,
    ).toBe(404);
    expect((await app.snapshot()).counts?.generations).toBe(0);
    evidence.cleanupActions = {
      single: single.id,
      archived: archived.id,
      live: live.id,
      foreign: other.id,
      purgeCounts: [1, 0],
      emptyCounts: [1, 0],
    };
  }, 60_000);

  it('pages trash including archived Sessions, rejects stale query scope, preserves archive on restore and isolates another owner', async () => {
    const alice = await login('b67-alice');
    const bob = await login('b67-bob');
    const active = await create(alice, 'Active Session');
    const trash = await create(alice, 'Deleted Session');
    const archived = await create(alice, 'Archived and deleted Session');
    const foreign = await create(bob, 'Other owner Session');
    const archiveResponse = await request(
      alice,
      `/api/v1/workbench/sessions/${archived.id}`,
      'PATCH',
      { expectedVersion: archived.version, archived: true },
    );
    expect(archiveResponse.status).toBe(200);
    const beforeDelete = workbenchSessionSchema.parse(await archiveResponse.json());
    for (const item of [trash, beforeDelete]) {
      const response = await request(alice, `/api/v1/workbench/sessions/${item.id}`, 'DELETE', {
        expectedVersion: item.version,
      });
      expect(response.status).toBe(200);
    }
    expect((await list(alice)).items.map((item) => item.id)).toEqual([active.id]);
    const first = await list(alice, { deletedOnly: 'true', archivedOnly: 'true', limit: '1' });
    expect(first.nextCursor).not.toBeNull();
    const second = await list(alice, {
      deletedOnly: 'true',
      limit: '1',
      cursor: first.nextCursor ?? '',
    });
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
      new Set([trash.id, archived.id]),
    );
    expect(second.nextCursor).toBeNull();
    const changedScope = await request(
      alice,
      `/api/v1/workbench/sessions?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(changedScope.status).toBe(400);
    expect(await changedScope.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    for (const cursor of ['0', 'not-a-cursor']) {
      const response = await request(alice, `/api/v1/workbench/sessions?cursor=${cursor}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect((await request(undefined, '/api/v1/workbench/sessions?deletedOnly=true')).status).toBe(
      401,
    );
    expect((await request(bob, `/api/v1/workbench/sessions/${archived.id}`)).status).toBe(404);
    expect(
      (await list(bob, { includeArchived: 'true', includeDeleted: 'true' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([foreign.id]);
    const restoredResponse = await request(
      alice,
      `/api/v1/workbench/sessions/${archived.id}/restore`,
      'POST',
    );
    expect(restoredResponse.status).toBe(200);
    const restored = workbenchSessionSchema.parse(await restoredResponse.json());
    expect(restored.archivedAt).toBe(beforeDelete.archivedAt);
    expect(restored.deletedAt).toBeNull();
    expect((await list(alice, { archivedOnly: 'true' })).items.map((item) => item.id)).toEqual([
      archived.id,
    ]);
    expect((await list(alice, { deletedOnly: 'true' })).items.map((item) => item.id)).toEqual([
      trash.id,
    ]);
    expect((await app.snapshot()).counts?.generations).toBe(0);
    evidence.sessions = {
      active: active.id,
      trash: trash.id,
      restoredArchive: restored.id,
      retainedArchiveTime: restored.archivedAt,
    };
    evidence.pages = [first.items.map((item) => item.id), second.items.map((item) => item.id)];
  }, 60000);
});
