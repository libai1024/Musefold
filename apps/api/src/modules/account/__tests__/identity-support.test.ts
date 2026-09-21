import { createNewApiClient, type RelayAuthSession } from '@musefold/new-api-client';
import { sealJsonToString } from '@musefold/server-crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  assertRelayUser,
  openRelay,
  safeAccountError,
  verifyFreshRelay,
} from '../identity-support.js';

const user = { id: 42, username: 'fixture-owner', quota: 100, group: 'default' };
const relay: RelayAuthSession = {
  jwt: 'synthetic-only-jwt',
  refreshToken: 'synthetic-only-refresh',
  jwtExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  user,
};

describe('account verification input and secret boundaries', () => {
  it.each([{ id: 0 }, { id: 1.5 }, { username: ' ' }, { quota: Number.NaN }, { quota: -1 }])(
    'rejects invalid upstream identity before use: %j',
    (invalid) => {
      expect(() => assertRelayUser({ ...user, ...invalid })).toThrow();
    },
  );

  it('uses fresh getSelf instead of trusting login username or owner metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, data: { ...user, id: 84 } }),
    );
    const client = createNewApiClient('https://identity.test', { fetchImpl });
    await expect(verifyFreshRelay(client, relay)).rejects.toMatchObject({
      code: 'ACCOUNT_RECOVERY_CONFLICT',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requires a readable encrypted relay and never leaks malformed payload values', () => {
    const marker = 'synthetic-sensitive-envelope-marker';
    const ciphertext = sealJsonToString({ jwt: marker }, 'synthetic-only-encryption');
    let failure: unknown;
    try {
      openRelay({ ciphertext }, 'synthetic-only-encryption');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 'ACCOUNT_IDENTITY_UNVERIFIED',
      details: { reason: 'legacy_evidence_missing' },
    });
    expect(String(failure).includes(marker)).toBe(false);
  });

  it('drops untrusted upstream error text while preserving retry and auth semantics', () => {
    const marker = 'synthetic-sensitive-upstream-marker';
    const server = safeAccountError(
      Object.assign(new Error(marker), { code: 'server', httpStatus: 503 }),
    );
    expect(server).toMatchObject({ status: 503, retryable: true });
    expect(JSON.stringify(server).includes(marker)).toBe(false);
    expect(server.message.includes(marker)).toBe(false);
    expect(safeAccountError({ code: 'auth', message: marker })).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      status: 401,
    });
  });

  it('preserves an explicit upstream 429 without confusing it with network or issuance failures', () => {
    const marker = 'synthetic-private-rate-limit-details';
    const limited = safeAccountError({ code: 'network', httpStatus: 429, message: marker });
    expect(limited).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryable: true });
    expect(limited.message).not.toContain(marker);
    expect(safeAccountError({ code: 'network', httpStatus: null })).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 503,
    });
    expect(
      safeAccountError({ code: 'AUTH_SESSION_ISSUANCE_LIMIT', httpStatus: 429 }),
    ).toMatchObject({
      code: 'AUTH_SESSION_ISSUANCE_LIMIT',
      status: 429,
    });
  });
});
