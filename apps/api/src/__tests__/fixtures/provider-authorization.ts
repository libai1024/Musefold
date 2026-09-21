import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Controlled provider key state, independent of Musefold's database/session authorization. */
export function providerAuthorizationFixture() {
  const observed = new Set<string>();
  const revoked = new Set<string>();
  const requests: Array<{
    method: string;
    endpoint: string;
    keyHash: string | null;
    authorized: boolean;
  }> = [];
  return {
    authorize(value: string | undefined, request: Pick<IncomingMessage, 'method' | 'url'>) {
      const valid = /^Bearer sk-full-\d+-\d+$/.test(value ?? '');
      const keyHash = valid
        ? createHash('sha256')
            .update(value as string)
            .digest('hex')
        : null;
      if (keyHash) observed.add(keyHash);
      const authorized = keyHash !== null && !revoked.has(keyHash);
      requests.push({
        method: request.method ?? '',
        endpoint: request.url ?? '',
        keyHash,
        authorized,
      });
      return authorized;
    },
    revokeObservedKeys() {
      if (observed.size === 0) throw new Error('No provider credential has been observed');
      for (const hash of observed) revoked.add(hash);
      return [...revoked];
    },
    restoreKeys() {
      revoked.clear();
    },
    snapshot() {
      return { revoked: [...revoked], requests: requests.map((request) => ({ ...request })) };
    },
  };
}
