import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createNewApiClient } from '../index';

// Against the pinned, patched Go controllers, not a JavaScript transport mock.
// Start the disposable controller fixture documented in infra/new-api/README.md.
const baseUrl = process.env.MUSEFOLD_SESSION_HTTP_FIXTURE_URL;
const live = baseUrl ? describe : describe.skip;
live('managed sessions over real Go HTTP', () => {
  const url = baseUrl ?? 'http://127.0.0.1:18089';
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('Fixture must be local');
  const client = createNewApiClient(url);
  const managed = client.managedSessions;
  if (!managed) throw new Error('Missing managed protocol');
  const credentials = { username: 'session-creator', password: 'synthetic-session-password' };
  afterAll(async () => {
    await fetch(`${url}/__finish`, { method: 'POST' });
  });
  it('password gate, capacity selection, replay, activation, revoke and refresh-safe cleanup', async () => {
    await expect(managed.begin({ ...credentials, password: 'wrong' })).rejects.toMatchObject({
      code: 'credentials',
    });
    const grantA = await managed.begin(credentials);
    expect(grantA.sessions).toMatchObject({ total: 0, limit: 2, required: 0 });
    const a = await managed.complete(grantA.flow_token, randomUUID(), [], 'Musefold macOS');
    await managed.touch(a.jwt, true);
    const grantB = await managed.begin(credentials);
    const b = await managed.complete(grantB.flow_token, randomUUID(), [], 'Firefox Linux');
    await managed.touch(b.jwt, true);
    const full = await managed.begin(credentials);
    expect(full.sessions).toMatchObject({ total: 2, required: 1 });
    const aRow = full.sessions.items.find((item) => item.sid === a.cleanup?.sid);
    expect(aRow).toBeDefined();
    if (!aRow || !a.cleanup || !b.cleanup) throw new Error('Incomplete server protocol');
    const operation = randomUUID();
    await expect(managed.complete(full.flow_token, operation, [])).rejects.toMatchObject({
      code: 'AUTH_SESSION_LIMIT',
    });
    const selected = [{ sid: aRow.sid, version: aRow.version }];
    const c = await managed.complete(full.flow_token, operation, selected, 'Safari iOS');
    const replay = await managed.complete(full.flow_token, operation, selected);
    expect(replay.refreshToken).toBe(c.refreshToken);
    expect(replay.cleanup).toEqual(c.cleanup);
    expect(c.revokedSessionIds).toEqual([aRow.sid]);
    expect(replay.revokedSessionIds).toEqual(c.revokedSessionIds);
    await expect(managed.list(a.jwt)).rejects.toMatchObject({ code: 'auth' });
    await expect(client.refresh(a.refreshToken)).rejects.toMatchObject({ code: 'auth' });
    await managed.touch(c.jwt, true);
    const sessions = await managed.list(c.jwt);
    expect(sessions.total).toBe(2);
    expect(sessions.items.filter((row) => row.current)).toHaveLength(1);
    const other = sessions.items.find((row) => !row.current);
    if (!other || !c.cleanup) throw new Error('Missing other session');
    const revoke = {
      operationId: randomUUID(),
      selected: [{ sid: other.sid, version: other.version }],
    };
    expect(await managed.revoke(c.jwt, revoke)).toBe(1);
    expect(await managed.revoke(c.jwt, revoke)).toBe(1);
    expect((await managed.list(c.jwt)).total).toBe(1);
    await expect(managed.list(b.jwt)).rejects.toMatchObject({ code: 'auth' });
    const refreshed = await client.refresh(c.refreshToken);
    await managed.release(c.cleanup);
    await managed.release(c.cleanup);
    await expect(managed.list(refreshed.jwt)).rejects.toMatchObject({ code: 'auth' });
    const cancelled = await managed.begin(credentials);
    expect(cancelled.sessions.total).toBe(0);
    await managed.cancel(cancelled.flow_token);
    await expect(managed.review(cancelled.flow_token)).rejects.toMatchObject({
      code: 'AUTH_LOGIN_CHALLENGE_EXPIRED',
    });
  }, 30_000);
});
