import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFICIAL_CLOUD_API_BASE } from '@musefold/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  rename: vi.fn<(...args: Parameters<typeof import('node:fs/promises').rename>) => Promise<void>>(),
  realRename: null as typeof import('node:fs/promises').rename | null,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }));
vi.mock('../../../security/e2e-safe-storage', () => ({
  resolveSafeStorage: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  }),
}));
vi.mock('../../../system/logger', () => ({ createLogger: () => mocks.logger }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  mocks.realRename = actual.rename;
  return { ...actual, rename: mocks.rename };
});

import {
  accountWorkspaceOwner,
  buildAccountDomainMethods,
  captureManagedAccountSession,
  onAccountChangeCancelled,
  onAccountChanged,
  onBeforeAccountChange,
  readSessionCredentials,
} from '../account-domain';
import { sessionForAccount, writeStoredSession } from '../account-session-store';

const accountB = {
  id: 'owner-b',
  username: 'account-b',
  displayName: null,
  quota: 10,
  quotaUnit: 'points',
  canGenerate: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  mocks.userData = mkdtempSync(join(tmpdir(), 'musefold-account-domain-'));
  mocks.rename.mockReset().mockImplementation((...args) => {
    if (!mocks.realRename) throw new Error('real rename not initialized');
    return mocks.realRename(...args);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => jsonResponse({ success: true })),
  );
  await writeStoredSession(
    sessionForAccount('token-a', OFFICIAL_CLOUD_API_BASE, {
      ...accountB,
      id: 'owner-a',
      username: 'account-a',
    }),
  );
});

describe('account domain credential transition', () => {
  const catalog = {
    identity: {
      apiIssuer: OFFICIAL_CLOUD_API_BASE,
      principalId: 'principal-a',
      payer: { issuer: 'https://account.example.test', ownerId: '42' },
      credential: { ref: 'credential-a', version: 1 },
    },
    group: 'vip',
    checkedAt: '2026-09-20T00:00:00.000Z',
    models: [
      {
        model: 'image-a',
        supportedEndpointTypes: ['image-generation'],
        imageGeneration: true,
        pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 1, quotaPerCall: 20000 },
      },
    ],
  };
  async function storeCatalogAccount(principalId = 'principal-a') {
    await writeStoredSession(
      sessionForAccount(`token-${principalId}`, OFFICIAL_CLOUD_API_BASE, {
        ...accountB,
        id: '42',
        identity: {
          apiIssuer: OFFICIAL_CLOUD_API_BASE,
          principalId,
          status: 'active',
          identityVersion: 1,
        },
      }),
    );
  }
  it('reads notices through the pinned service without exposing session credentials', async () => {
    await storeCatalogAccount();
    const feed = {
      apiIssuer: OFFICIAL_CLOUD_API_BASE,
      issuer: 'https://account.example.test',
      items: [{ id: 'n-a', content: 'notice', publishedAt: null }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(feed));
    expect(await buildAccountDomainMethods()['account.getNotices']?.handle(undefined)).toEqual(
      feed,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${OFFICIAL_CLOUD_API_BASE}/api/v1/account/notices`,
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer token-principal-a' },
      }),
    );
  });
  it('rejects notices from another service or a late account response', async () => {
    await storeCatalogAccount();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        apiIssuer: 'https://other.example',
        issuer: 'https://account.example.test',
        items: [],
      }),
    );
    await expect(
      buildAccountDomainMethods()['account.getNotices']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await storeCatalogAccount('principal-b');
      return jsonResponse({
        apiIssuer: OFFICIAL_CLOUD_API_BASE,
        issuer: 'https://account.example.test',
        items: [],
      });
    });
    await expect(
      buildAccountDomainMethods()['account.getNotices']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('does not read notices under an unverified legacy session', async () => {
    await expect(
      buildAccountDomainMethods()['account.getNotices']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'ACCOUNT_IDENTITY_UNVERIFIED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns validated account model prices while keeping the bearer in the main process', async () => {
    await storeCatalogAccount();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(catalog));
    const result = await buildAccountDomainMethods()['account.getModelCatalog']?.handle(undefined);
    expect(result).toEqual(catalog);
    expect(JSON.stringify(result)).not.toContain('token-principal-a');
    expect(fetch).toHaveBeenCalledWith(
      `${OFFICIAL_CLOUD_API_BASE}/api/v1/account/models`,
      expect.objectContaining({
        headers: { authorization: 'Bearer token-principal-a' },
        redirect: 'error',
      }),
    );
  });
  it('rejects a catalog for another principal', async () => {
    await storeCatalogAccount();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...catalog, identity: { ...catalog.identity, principalId: 'other' } }),
    );
    await expect(
      buildAccountDomainMethods()['account.getModelCatalog']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects a late model response when the local account changes', async () => {
    await storeCatalogAccount();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await storeCatalogAccount('principal-b');
      return jsonResponse(catalog);
    });
    await expect(
      buildAccountDomainMethods()['account.getModelCatalog']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('does not query the catalog using an unverified legacy account', async () => {
    await expect(
      buildAccountDomainMethods()['account.getModelCatalog']?.handle(undefined),
    ).rejects.toMatchObject({ code: 'ACCOUNT_IDENTITY_UNVERIFIED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the existing credentials when a candidate login is unauthorized', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: 'token-b' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AUTH_REQUIRED' } }, 401));

    const methods = buildAccountDomainMethods();
    await expect(
      methods['account.login']?.handle({ username: 'account-b', password: 'password-123' }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    await expect(readSessionCredentials()).resolves.toMatchObject({
      token: 'token-a',
      ownerId: accountWorkspaceOwner({ ...accountB, id: 'owner-a' }),
    });
  });

  it('rolls back the transition fence when atomic credential replacement fails', async () => {
    const before = vi.fn();
    const changed = vi.fn();
    const cancelled = vi.fn();
    onBeforeAccountChange(before);
    onAccountChanged(changed);
    onAccountChangeCancelled(cancelled);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: 'token-b' }))
      .mockResolvedValueOnce(jsonResponse(accountB));
    mocks.rename.mockImplementation(async (...args) => {
      if (String(args[1]).endsWith('/v25-account-session.json'))
        throw new Error('forced rename failure');
      if (!mocks.realRename) throw new Error('real rename not initialized');
      return mocks.realRename(...args);
    });

    const methods = buildAccountDomainMethods();
    await expect(
      methods['account.login']?.handle({ username: 'account-b', password: 'password-123' }),
    ).rejects.toThrow('forced rename failure');

    expect(before).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    await expect(readSessionCredentials()).resolves.toMatchObject({
      token: 'token-a',
      ownerId: accountWorkspaceOwner({ ...accountB, id: 'owner-a' }),
    });
  });

  it('atomically stores the validated owner with ciphertext before publishing the identity', async () => {
    const changed = vi.fn();
    onAccountChanged(changed);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: 'token-b' }))
      .mockResolvedValueOnce(jsonResponse(accountB));

    const methods = buildAccountDomainMethods();
    await expect(
      methods['account.login']?.handle({ username: 'account-b', password: 'password-123' }),
    ).resolves.toEqual(accountB);

    await expect(readSessionCredentials()).resolves.toMatchObject({
      token: 'token-b',
      ownerId: accountWorkspaceOwner(accountB),
    });
    expect(changed).toHaveBeenCalledWith(accountB);
    const stored = readFileSync(join(mocks.userData, 'v25-account-session.json'), 'utf8');
    expect(Object.keys(JSON.parse(stored))).toEqual(['encrypted']);
    expect(stored).not.toContain('owner-b');
    expect(stored).not.toContain('token-b');
  });
});

describe('managed account execution capture', () => {
  const identity = {
    apiIssuer: OFFICIAL_CLOUD_API_BASE,
    principalId: 'verified-principal',
    status: 'active' as const,
    identityVersion: 1,
  };
  async function verifiedSession() {
    await writeStoredSession(
      sessionForAccount('synthetic-managed-token', identity.apiIssuer, { ...accountB, identity }),
    );
    return captureManagedAccountSession();
  }

  it('rejects a legacy session without a verified principal', async () => {
    await expect(captureManagedAccountSession()).rejects.toMatchObject({
      code: 'ACCOUNT_IDENTITY_UNVERIFIED',
    });
  });

  it('invalidates synchronous access before awaiting slow account-change subscribers', async () => {
    const captured = await verifiedSession();
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    onBeforeAccountChange(async () => {
      entered();
      await wait;
    });
    const logout = buildAccountDomainMethods()['account.logout']?.handle({});
    try {
      await ready;
      expect(() => captured.assertCurrent()).toThrow();
    } finally {
      release();
      await logout;
    }
  });

  it('does not invalidate a replacement login when an old execution receives 401', async () => {
    const old = await verifiedSession();
    const next = sessionForAccount('synthetic-new-token', identity.apiIssuer, {
      ...accountB,
      identity,
    });
    await writeStoredSession(next);
    await expect(old.assertFresh()).rejects.toThrow();
    await old.invalidate();
    expect((await readSessionCredentials())?.authEpoch).toBe(next.authEpoch);
  });
});
