import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  bindSessionOwner,
  buildAccountDomainMethods,
  onAccountChangeCancelled,
  onAccountChanged,
  onBeforeAccountChange,
  readSessionCredentials,
} from '../account-domain';

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
  vi.stubGlobal('fetch', vi.fn());
  await bindSessionOwner('token-a', 'owner-a');
});

describe('account domain credential transition', () => {
  it('keeps the existing credentials when a candidate login is unauthorized', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ token: 'token-b' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AUTH_REQUIRED' } }, 401));

    const methods = buildAccountDomainMethods();
    await expect(
      methods['account.login']?.handle({ username: 'account-b', password: 'password-123' }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    await expect(readSessionCredentials()).resolves.toEqual({
      token: 'token-a',
      ownerId: 'owner-a',
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
    mocks.rename.mockRejectedValueOnce(new Error('forced rename failure'));

    const methods = buildAccountDomainMethods();
    await expect(
      methods['account.login']?.handle({ username: 'account-b', password: 'password-123' }),
    ).rejects.toThrow('forced rename failure');

    expect(before).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    await expect(readSessionCredentials()).resolves.toEqual({
      token: 'token-a',
      ownerId: 'owner-a',
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

    await expect(readSessionCredentials()).resolves.toEqual({
      token: 'token-b',
      ownerId: 'owner-b',
    });
    expect(changed).toHaveBeenCalledWith(accountB);
    const stored = readFileSync(join(mocks.userData, 'v25-account-session.json'), 'utf8');
    expect(stored).toContain('owner-b');
    expect(stored).not.toContain('token-b');
  });
});
