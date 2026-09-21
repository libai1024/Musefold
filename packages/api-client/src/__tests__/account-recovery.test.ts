import { describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';

const account = {
  id: 'owner-a',
  username: 'test-a',
  displayName: null,
  quota: 0,
  quotaUnit: 'points',
  canGenerate: false,
  identity: {
    apiIssuer: 'https://api.example.test',
    principalId: 'principal-a',
    status: 'recovery_required',
    identityVersion: 1,
  },
  recovery: {
    requestId: 'request-a',
    reason: 'legacy_evidence_missing',
    expiresAt: '2099-01-01T00:00:00.000Z',
    actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
  },
};

function fixture(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  return { fetch, gateway: createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch }) };
}

describe('account recovery HTTP gateway', () => {
  it.each([
    ['retryRecovery', 'retry'],
    ['verifyOriginalSession', 'verify-original-session'],
    ['createIndependentWorkspace', 'independent-workspace'],
  ] as const)(
    'sends %s once with only the request identity and parses restricted status',
    async (method, path) => {
      const { gateway, fetch } = fixture(account);
      expect(await gateway.account[method]?.({ requestId: 'request-a' })).toEqual(account);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `https://api.example.test/api/v1/account/recovery/${path}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: 'request-a' }),
        },
      );
    },
  );

  it('inspects the candidate under the existing cookie session without proving it locally', async () => {
    const review = {
      requestId: 'request-a',
      expiresAt: account.recovery.expiresAt,
      candidate: {
        issuer: 'https://identity.example.test',
        ownerId: 'owner-a',
        username: 'test-a',
        displayName: 'Test A',
      },
    };
    const { gateway, fetch } = fixture(review);
    expect(await gateway.account.inspectRecovery?.({ requestId: 'request-a' })).toEqual(review);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/account\/recovery\/inspect$/);
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads unavailable execution binding without making a generation request', async () => {
    const binding = {
      status: 'unavailable',
      apiIssuer: 'https://api.example.test',
      principalId: 'principal-a',
      reason: 'IDENTITY_UNVERIFIED',
    };
    const { gateway, fetch } = fixture(binding);
    expect(await gateway.account.getExecutionBinding?.()).toEqual(binding);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/v1/account/execution-binding',
      { method: 'GET', credentials: 'include', headers: {}, body: undefined },
    );
  });

  it.each([
    'ACCOUNT_IDENTITY_UNVERIFIED',
    'ACCOUNT_RECOVERY_CONFLICT',
    'ACCOUNT_RECOVERY_EXPIRED',
    'ACCOUNT_IDENTITY_SOURCE_CHANGED',
  ])('preserves %s without automatically retrying a recovery write', async (code) => {
    const { gateway, fetch } = fixture(
      {
        error: {
          code,
          message: 'Recovery unavailable',
          requestId: 'http-request-a',
          retryable: false,
        },
      },
      409,
    );
    await expect(gateway.account.retryRecovery?.({ requestId: 'request-a' })).rejects.toMatchObject(
      { code, status: 409 },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects forwarding extra secret fields before HTTP dispatch', () => {
    const { gateway, fetch } = fixture(account);
    const invalid = { requestId: 'request-a', sessionToken: 'synthetic-not-for-forwarding' };
    expect(() => gateway.account.inspectRecovery?.(invalid)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a contradictory recovery response that claims it can generate', async () => {
    const { gateway } = fixture({ ...account, canGenerate: true });
    await expect(gateway.account.retryRecovery?.({ requestId: 'request-a' })).rejects.toThrow();
  });
});
