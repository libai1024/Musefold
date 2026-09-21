import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AccountSummary } from '@musefold/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  available: true,
  rename: vi.fn<typeof import('node:fs/promises').rename>(),
  unlink: vi.fn<typeof import('node:fs/promises').unlink>(),
  realRename: null as typeof import('node:fs/promises').rename | null,
  realUnlink: null as typeof import('node:fs/promises').unlink | null,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }));
vi.mock('../../../security/e2e-safe-storage', () => ({
  resolveSafeStorage: () => ({
    isEncryptionAvailable: () => mocks.available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  }),
}));
vi.mock('../../../system/logger', () => ({ createLogger: () => mocks.logger }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  mocks.realRename = actual.rename;
  mocks.realUnlink = actual.unlink;
  return { ...actual, rename: mocks.rename, unlink: mocks.unlink };
});

const issuerA = 'https://account-a.example.test';
const issuerB = 'https://account-b.example.test';
let domain: typeof import('../account-domain');
let store: typeof import('../account-session-store');
const tokenFile = () => join(mocks.userData, 'v25-account-session.json');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function summary(principalId: string, apiIssuer = issuerA): AccountSummary {
  return {
    id: 'upstream-owner',
    username: 'creator',
    displayName: null,
    quota: 10,
    quotaUnit: 'points',
    canGenerate: true,
    identity: { apiIssuer, principalId, status: 'active', identityVersion: 1 },
    recovery: null,
  };
}
function restricted(): AccountSummary {
  const active = summary('legacy-principal');
  if (!active.identity) throw new Error('Missing fixture identity');
  return {
    ...active,
    canGenerate: false,
    identity: { ...active.identity, status: 'recovery_required' },
    recovery: {
      requestId: 'recovery-request',
      expiresAt: '2030-01-01T00:00:00Z',
      reason: 'legacy_evidence_missing',
      actions: ['retry', 'create_independent_workspace'],
    },
  };
}
async function save(token = 'session-a', status = summary('principal-a')) {
  if (!status.identity) throw new Error('Missing fixture identity');
  await store.writeStoredSession(store.sessionForAccount(token, status.identity.apiIssuer, status));
}
function call(method: string, input?: unknown) {
  const handler = domain.buildAccountDomainMethods()[`account.${method}`];
  if (!handler) throw new Error(`Missing account.${method}`);
  return handler.handle(input);
}
const login = (username: string) => call('login', { username, password: 'fixture-password' });
function bearer(init: RequestInit | undefined) {
  return new Headers(init?.headers).get('authorization');
}

beforeEach(async () => {
  vi.resetModules();
  mocks.userData = mkdtempSync(join(tmpdir(), 'musefold-account-session-'));
  mocks.available = true;
  mocks.rename.mockReset().mockImplementation((...args) => {
    if (!mocks.realRename) throw new Error('Missing original rename');
    return mocks.realRename(...args);
  });
  mocks.unlink.mockReset().mockImplementation((...args) => {
    if (!mocks.realUnlink) throw new Error('Missing original unlink');
    return mocks.realUnlink(...args);
  });
  vi.stubEnv('MUSEFOLD_API_URL', issuerA);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ success: true })),
  );
  store = await import('../account-session-store');
  domain = await import('../account-domain');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(mocks.userData, { recursive: true, force: true });
});

describe('authenticated local session storage', () => {
  it('uses the deployed official cloud endpoint when no override is configured', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const defaultStore = await import('../account-session-store');
    expect(defaultStore.apiBase()).toBe('https://zhaozhaoyue.top');
  });

  it('persists offline logout encrypted, survives a fresh module process state and retries only the original issuer', async () => {
    await save('offline-session-a');
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await call('logout');
    expect(await store.readStoredSession()).toBeNull();
    expect(await call('getLoginReleaseStatus')).toEqual({ pending: 1 });
    const file = join(mocks.userData, 'v25-account-pending-releases.json');
    expect(readFileSync(file, 'utf8')).not.toContain('offline-session-a');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    await save('new-account-token', summary('new-account', issuerB));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6_000);
    vi.resetModules();
    const restartedQueue = await import('../account-release-queue');
    const sent: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`${issuerA}/api/auth/sign-out`);
      sent.push(bearer(init) ?? '');
      return json({ success: true });
    });
    try {
      await restartedQueue.retryAccountReleases();
      expect(sent).toEqual(['Bearer offline-session-a']);
      expect(await restartedQueue.pendingAccountReleaseCount()).toBe(0);
      expect((await store.readStoredSession())?.token).toBe('new-account-token');
    } finally {
      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('does not revoke a candidate that became the current login before a crash', async () => {
    const queue = await import('../account-release-queue');
    await queue.enqueueAccountRelease('accepted-candidate', issuerA, true);
    await save('accepted-candidate');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 301_000);
    try {
      await queue.retryAccountReleases();
      expect(fetch).not.toHaveBeenCalled();
      expect(await queue.pendingAccountReleaseCount()).toBe(0);
      expect((await store.readStoredSession())?.token).toBe('accepted-candidate');
    } finally {
      clock.mockRestore();
    }
  });

  it('retains an issuerless legacy file without ever forwarding its bearer', async () => {
    const legacy = JSON.stringify({
      encrypted: Buffer.from('encrypted:old-raw-bearer').toString('base64'),
      ownerId: 'old-owner',
    });
    writeFileSync(tokenFile(), legacy);
    await expect(call('getStatus')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(tokenFile(), 'utf8')).toBe(legacy);
  });

  it('takes issuer and principal only from encrypted payload and stores no plaintext metadata', async () => {
    await save();
    const raw = JSON.parse(readFileSync(tokenFile(), 'utf8'));
    expect(Object.keys(raw)).toEqual(['encrypted']);
    expect(statSync(tokenFile()).mode & 0o777).toBe(0o600);
    writeFileSync(
      tokenFile(),
      JSON.stringify({ ...raw, ownerId: 'attacker', apiIssuer: issuerB, principalId: 'attacker' }),
    );
    await expect(store.readSessionCredentials()).resolves.toMatchObject({
      apiIssuer: issuerA,
      principalId: 'principal-a',
    });
    expect((await store.readSessionCredentials())?.ownerId).toBe(
      store.accountWorkspaceOwner(summary('principal-a')),
    );
  });

  it('isolates equal upstream owners by both service issuer and internal principal', () => {
    const scopes = [
      summary('principal-a'),
      summary('principal-b'),
      summary('principal-a', issuerB),
    ].map((status) => store.accountWorkspaceOwner(status));
    expect(new Set(scopes).size).toBe(3);
    expect(scopes.every((scope) => /^[a-f0-9]{64}$/.test(scope))).toBe(true);
  });

  it('refuses a response identity from another service', () => {
    expect(() =>
      store.sessionForAccount('candidate', issuerA, summary('principal-b', issuerB)),
    ).toThrow(/服务来源/);
  });

  it('never sends the old bearer to a newly configured issuer and allows explicit fresh login', async () => {
    await save();
    vi.stubEnv('MUSEFOLD_API_URL', issuerB);
    await expect(call('getStatus')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url).startsWith(issuerB)).toBe(true);
      expect(bearer(init)).not.toBe('Bearer session-a');
      if (String(url).endsWith('/sign-in/new-api')) return json({ token: 'session-b' });
      return json(summary('principal-b', issuerB));
    });
    await expect(login('creator-b')).resolves.toEqual(summary('principal-b', issuerB));
    await expect(store.readSessionCredentials()).resolves.toMatchObject({
      token: 'session-b',
      apiIssuer: issuerB,
    });
  });
});

describe('linear account transitions', () => {
  it.each([200, 401])(
    'rejects a late old-session HTTP %s without changing the newer session',
    async (status) => {
      await save();
      const pending = deferred<Response>();
      const started = deferred<void>();
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (String(url).endsWith('/sign-in/new-api')) return json({ token: 'session-b' });
        if (String(url).endsWith('/status') && bearer(init) === 'Bearer session-a') {
          started.resolve();
          return pending.promise;
        }
        return json(summary('principal-b'));
      });
      const oldResult = call('getStatus').catch((error: unknown) => error);
      await started.promise;
      await login('creator-b');
      const cancelBody = vi.fn();
      pending.resolve(new Response(new ReadableStream({ cancel: cancelBody }), { status }));
      expect(await oldResult).toMatchObject({ code: 'CONFLICT' });
      expect(cancelBody).toHaveBeenCalledOnce();
      await expect(store.readSessionCredentials()).resolves.toMatchObject({
        token: 'session-b',
        principalId: 'principal-b',
      });
    },
  );

  it('lets the latest login win when candidate status responses arrive in reverse order', async () => {
    await save();
    const oldStatus = deferred<Response>();
    const oldStarted = deferred<void>();
    const revoked: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/sign-in/new-api')) {
        const body = JSON.parse(String(init?.body));
        return json({ token: body.email === 'first' ? 'first-token' : 'second-token' });
      }
      if (path.endsWith('/sign-out')) {
        revoked.push(bearer(init) ?? '');
        return json({ success: true });
      }
      if (bearer(init) === 'Bearer first-token') {
        oldStarted.resolve();
        return oldStatus.promise;
      }
      return json(summary('second-principal'));
    });
    const first = login('first').catch((error: unknown) => error);
    await oldStarted.promise;
    await login('second');
    oldStatus.resolve(json(summary('first-principal')));
    expect(await first).toMatchObject({ code: 'CONFLICT' });
    // Successful replacement releases the prior local login as well as the
    // losing candidate, never the new winning device.
    expect(revoked).toEqual(['Bearer session-a', 'Bearer first-token']);
    await expect(store.readSessionCredentials()).resolves.toMatchObject({ token: 'second-token' });
  });

  it('captures the next login after a preceding local commit, even when it starts inside the commit barrier', async () => {
    await save();
    const entered = deferred<void>();
    const release = deferred<void>();
    let transitions = 0;
    domain.onBeforeAccountChange(async () => {
      if (++transitions === 1) {
        entered.resolve();
        await release.promise;
      }
    });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/sign-in/new-api'))
        return json({ token: `${JSON.parse(String(init?.body)).email}-token` });
      return json(
        summary(bearer(init) === 'Bearer first-token' ? 'first-principal' : 'second-principal'),
      );
    });
    const first = login('first');
    await entered.promise;
    const second = login('second');
    release.resolve();
    await expect(first).resolves.toEqual(summary('first-principal'));
    await expect(second).resolves.toEqual(summary('second-principal'));
    await expect(store.readSessionCredentials()).resolves.toMatchObject({ token: 'second-token' });
  });

  it('does not resurrect a candidate after logout and revokes only the two affected tokens', async () => {
    await save();
    const candidate = deferred<Response>();
    const started = deferred<void>();
    const revoked: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/sign-in/new-api')) return json({ token: 'candidate-token' });
      if (String(url).endsWith('/status')) {
        started.resolve();
        return candidate.promise;
      }
      revoked.push(bearer(init) ?? '');
      return json({ success: true });
    });
    const pending = login('creator-b').catch((error: unknown) => error);
    await started.promise;
    await call('logout');
    candidate.resolve(json(summary('principal-b')));
    expect(await pending).toMatchObject({ code: 'CONFLICT' });
    expect(revoked).toEqual(['Bearer session-a', 'Bearer candidate-token']);
    expect(existsSync(tokenFile())).toBe(false);
  });

  it('reports an unlink failure and cancels the transition instead of claiming logout succeeded', async () => {
    await save();
    const changed = vi.fn();
    const cancelled = vi.fn();
    domain.onAccountChanged(changed);
    domain.onAccountChangeCancelled(cancelled);
    mocks.unlink.mockImplementation(async (path) => {
      if (String(path) === tokenFile())
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      if (!mocks.realUnlink) throw new Error('Missing original unlink');
      return mocks.realUnlink(path);
    });
    await expect(call('logout')).rejects.toThrow('permission denied');
    expect(changed).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    await expect(store.readSessionCredentials()).resolves.toMatchObject({ token: 'session-a' });
  });

  it('keeps the original session and revokes only its candidate when secure storage is unavailable', async () => {
    await save();
    mocks.available = false;
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ token: 'candidate-token' }))
      .mockResolvedValueOnce(json(summary('principal-b')));
    await expect(login('creator-b')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(store.readSessionCredentials()).resolves.toMatchObject({ token: 'session-a' });
    expect(vi.mocked(fetch).mock.calls.at(-1)).toEqual([
      `${issuerA}/api/auth/sign-out`,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer candidate-token' }),
      }),
    ]);
  });

  it('rejects an unexpected principal switch during a normal account refresh', async () => {
    await save();
    vi.mocked(fetch).mockResolvedValueOnce(json(summary('different-principal')));
    await expect(call('getStatus')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(store.readSessionCredentials()).resolves.toMatchObject({
      principalId: 'principal-a',
    });
  });
});

describe('restricted recovery and interrupted remote completion', () => {
  it('does not replace a persisted recovery intent with a second request captured before the first commit', async () => {
    await save('recovery-token', restricted());
    const readCurrent = store.readSessionCredentials;
    const capturedFirst = deferred<void>();
    const capturedSecond = deferred<void>();
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    let snapshots = 0;
    const read = vi.spyOn(store, 'readSessionCredentials').mockImplementation(async () => {
      const current = await readCurrent();
      const snapshot = ++snapshots;
      if (snapshot === 1) {
        capturedFirst.resolve();
        await releaseFirst.promise;
      }
      if (snapshot === 2) {
        capturedSecond.resolve();
        await releaseSecond.promise;
      }
      return current;
    });
    const started = deferred<void>();
    const reply = deferred<Response>();
    const requests: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      started.resolve();
      return requests.length === 1 ? reply.promise : json(summary('independent-principal'));
    });
    const first = call('createIndependentWorkspace', { requestId: 'recovery-request' }).catch(
      (error: unknown) => error,
    );
    await capturedFirst.promise;
    const second = call('createIndependentWorkspace', { requestId: 'other-request' }).catch(
      (error: unknown) => error,
    );
    await capturedSecond.promise;
    releaseFirst.resolve();
    await started.promise;
    releaseSecond.resolve();
    expect(await second).toMatchObject({ code: 'CONFLICT' });
    expect(requests).toEqual([{ requestId: 'recovery-request' }]);
    await expect(store.readStoredSession()).resolves.toMatchObject({
      pendingRecovery: { requestId: 'recovery-request' },
    });
    mocks.rename.mockRejectedValueOnce(new Error('remote completed; local save failed'));
    reply.resolve(json(summary('independent-principal')));
    expect(await first).toMatchObject({ message: 'remote completed; local save failed' });
    read.mockRestore();
    vi.resetModules();
    store = await import('../account-session-store');
    domain = await import('../account-domain');
    await expect(call('getStatus')).resolves.toEqual(summary('independent-principal'));
    expect(requests).toEqual([
      { requestId: 'recovery-request' },
      { requestId: 'recovery-request' },
    ]);
  });

  it('blocks retry while an independent-space intent is pending so a late completion remains recoverable', async () => {
    await save('recovery-token', restricted());
    const started = deferred<void>();
    const reply = deferred<Response>();
    vi.mocked(fetch).mockImplementation(async () => {
      started.resolve();
      return reply.promise;
    });
    const independent = call('createIndependentWorkspace', { requestId: 'recovery-request' });
    await started.promise;
    const before = await store.readStoredSession();
    await expect(call('retryRecovery', { requestId: 'recovery-request' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await store.readStoredSession()).toEqual(before);
    reply.resolve(json(summary('independent-principal')));
    await expect(independent).resolves.toEqual(summary('independent-principal'));
    await expect(store.readStoredSession()).resolves.toMatchObject({
      principalId: 'independent-principal',
      pendingRecovery: null,
      restricted: false,
    });
  });

  it('withholds normal bearer access and redeem while leaving the recovery status reachable', async () => {
    await save('recovery-token', restricted());
    await expect(domain.readSessionToken()).resolves.toBeNull();
    await expect(call('redeem', { code: 'voucher' })).rejects.toMatchObject({
      code: 'ACCOUNT_IDENTITY_UNVERIFIED',
    });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(json(restricted()));
    await expect(call('getStatus')).resolves.toEqual(restricted());
  });

  it('persists independent-space intent before sending and replays the exact request after restart and local commit failure', async () => {
    await save('recovery-token', restricted());
    const requestIds: string[] = [];
    let remoteCompleted = false;
    const independentlyCreated = summary('independent-principal');
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`${issuerA}/api/v1/account/recovery/independent-workspace`);
      expect(bearer(init)).toBe('Bearer recovery-token');
      const request = JSON.parse(String(init?.body));
      requestIds.push(request.requestId);
      expect((await store.readStoredSession())?.pendingRecovery).toEqual({
        requestId: 'recovery-request',
      });
      if (!remoteCompleted) {
        remoteCompleted = true;
        mocks.rename.mockRejectedValueOnce(new Error('disk full after remote completion'));
      }
      return json(independentlyCreated);
    });
    await expect(
      call('createIndependentWorkspace', { requestId: 'recovery-request' }),
    ).rejects.toThrow('disk full after remote completion');
    await expect(store.readStoredSession()).resolves.toMatchObject({
      token: 'recovery-token',
      principalId: 'legacy-principal',
      restricted: true,
      pendingRecovery: { requestId: 'recovery-request' },
    });
    vi.resetModules();
    store = await import('../account-session-store');
    domain = await import('../account-domain');
    await expect(call('getStatus')).resolves.toEqual(independentlyCreated);
    expect(requestIds).toEqual(['recovery-request', 'recovery-request']);
    await expect(store.readStoredSession()).resolves.toMatchObject({
      token: 'recovery-token',
      principalId: 'independent-principal',
      restricted: false,
      pendingRecovery: null,
      ownerId: store.accountWorkspaceOwner(independentlyCreated),
    });
  });

  it('does not begin a remote independent-space transition if its durable intent cannot be saved', async () => {
    await save('recovery-token', restricted());
    mocks.rename.mockRejectedValueOnce(new Error('disk full before send'));
    await expect(
      call('createIndependentWorkspace', { requestId: 'recovery-request' }),
    ).rejects.toThrow('disk full before send');
    expect(fetch).not.toHaveBeenCalled();
    await expect(store.readStoredSession()).resolves.toMatchObject({
      pendingRecovery: null,
      restricted: true,
    });
  });

  it.each([
    { apiIssuer: issuerB, principalId: 'principal-a' },
    { apiIssuer: issuerA, principalId: 'principal-b' },
  ])('rejects execution metadata with a mismatched identity: %j', async (binding) => {
    await save();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ status: 'unavailable', reason: 'CREDENTIAL_UNAVAILABLE', ...binding }),
    );
    await expect(call('getExecutionBinding')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
