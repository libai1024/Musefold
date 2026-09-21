import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNewApiClient } from '../index';

// Disposable built image + PostgreSQL, initialized with this synthetic account.
// Never point this test at a production authority.
const url = process.env.MUSEFOLD_SESSION_IMAGE_URL;
(url ? describe : describe.skip)('built New API image managed-session smoke', () => {
  it('real router, GORM migration, access/refresh and revoke-only cleanup', async () => {
    if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Local image required');
    const client = createNewApiClient(url);
    const managed = client.managedSessions;
    if (!managed) throw new Error('Managed protocol required');
    const grant = await managed.begin({
      username: 'sessionroot',
      password: 'synthetic-session-password',
    });
    expect(grant.sessions.total).toBe(0);
    expect(grant.sessions.limit).toBe(50);
    const result = await managed.complete(
      grant.flow_token,
      randomUUID(),
      [],
      'Musefold image smoke macOS',
    );
    if (!result.cleanup) throw new Error('Release responsibility missing');
    try {
      await managed.touch(result.jwt, true);
      const listed = await managed.list(result.jwt);
      expect(listed.total).toBe(1);
      expect(listed.items[0]).toMatchObject({ current: true, sid: result.cleanup.sid });
      const refreshed = await client.refresh(result.refreshToken);
      await managed.release(result.cleanup);
      await expect(managed.list(refreshed.jwt)).rejects.toMatchObject({ code: 'auth' });
      await expect(client.refresh(refreshed.refreshToken)).rejects.toMatchObject({ code: 'auth' });
    } finally {
      await managed.release(result.cleanup);
    }
  }, 30_000);
});
