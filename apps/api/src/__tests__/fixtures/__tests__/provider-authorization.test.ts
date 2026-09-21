import { describe, it, expect } from 'vitest';
import { providerAuthorizationFixture } from '../provider-authorization.js';
import { textModelFixture } from '../text-model.js';

describe('controlled provider credential revocation', () => {
  it('rejects a previously accepted key over HTTP without revoking another key or exposing either', async () => {
    const authority = providerAuthorizationFixture();
    const server = await textModelFixture(authority.authorize);
    const first = 'Bearer sk-full-123-1';
    const other = 'Bearer sk-full-456-1';
    const get = (authorization?: string) =>
      fetch(`${server.endpoint}/v1/models`, {
        headers: authorization ? { authorization } : {},
      });
    try {
      expect(() => authority.revokeObservedKeys()).toThrow('No provider credential');
      expect((await get(first)).status).toBe(200);
      const revoked = authority.revokeObservedKeys();
      expect(revoked).toHaveLength(1);
      expect((await get(first)).status).toBe(401);
      expect((await get(other)).status).toBe(200);
      expect((await get()).status).toBe(401);
      const evidence = authority.snapshot();
      expect(evidence.requests.map((r) => r.authorized)).toEqual([true, false, true, false]);
      expect(evidence.requests[0].keyHash).toBe(evidence.requests[1].keyHash);
      expect(evidence.requests[2].keyHash).not.toBe(evidence.requests[0].keyHash);
      expect(evidence.requests[3].keyHash).toBeNull();
      expect(JSON.stringify(evidence)).not.toContain('sk-full-');
      authority.restoreKeys();
      expect((await get(first)).status).toBe(200);
      expect(authority.snapshot().revoked).toEqual([]);
      expect(evidence.revoked).toEqual(revoked);
      expect(evidence.requests).toHaveLength(4);
    } finally {
      await server.close();
    }
  });
});
