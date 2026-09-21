import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { MusefoldAuth } from '../index.js';
import { type AuthedEnv, requireSession } from '../middleware.js';
import { AppError } from '../../lib/errors.js';

describe('same-origin Web cookie writes through the production proxy', () => {
  function appForOrigin(origin: string) {
    const auth = {
      api: { getSession: async () => ({ user: { id: 'test-owner' }, session: { id: 'session' } }) },
    } as unknown as MusefoldAuth;
    const app = new Hono<AuthedEnv>();
    app.onError((error, c) =>
      c.json({ error: 'rejected' }, error instanceof AppError ? (error.status as 403) : 500),
    );
    app.use('*', requireSession(auth, [origin]));
    app.post('/api/v1/example', (c) => c.json({ owner: c.get('userId') }));
    return app;
  }

  it('accepts the public Web origin even when the internal API port differs', async () => {
    const app = appForOrigin('http://127.0.0.1:3000');
    const res = await app.request('http://api:8787/api/v1/example', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', cookie: 'session=fixture' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ owner: 'test-owner' });
  });

  it('rejects an untrusted browser origin instead of trusting the API host', async () => {
    const app = appForOrigin('https://app.example.test');
    const res = await app.request('http://api:8787/api/v1/example', {
      method: 'POST',
      headers: { origin: 'https://untrusted.example.test', cookie: 'session=fixture' },
    });
    expect(res.status).toBe(403);
  });
});
