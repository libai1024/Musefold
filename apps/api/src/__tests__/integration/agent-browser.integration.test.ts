import { describe, it, expect } from 'vitest';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('actual browser Agent app composition', () => {
  it('requires authentication and starts with no paid calls, executions or drafts', async () => {
    const fixture = await startAgentBrowserApp();
    try {
      const response = await fixture.app.request('/api/v1/design-schemes/agent/text-model');
      expect(response.status).toBe(401);
      const snapshot = await fixture.snapshot();
      expect(snapshot.sessions).toEqual([]);
      expect(snapshot.schemes).toEqual([]);
      expect(snapshot.calls).toEqual([]);
      expect(snapshot.modelCalls).toEqual([]);
      const login = await fixture.app.request('/api/auth/sign-up/new-api', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3399' },
        body: JSON.stringify({ email: 'composition@example.test', password: 'correct-password' }),
      });
      expect(login.status).toBe(200);
      const identity = await login.json();
      if (
        !identity ||
        typeof identity !== 'object' ||
        !('user' in identity) ||
        !identity.user ||
        typeof identity.user !== 'object' ||
        !('id' in identity.user) ||
        typeof identity.user.id !== 'string'
      )
        throw new Error('Missing actual authenticated principal');
      const history = await fixture.seedHistory(identity.user.id);
      expect(history.hash).toMatch(/^[a-f0-9]{64}$/);
      expect((await fixture.snapshot()).modelCalls).toEqual([]);
    } finally {
      await fixture.close();
    }
  }, 120000);
});
