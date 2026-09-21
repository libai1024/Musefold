import { createNewApiClient, type NewApiClient } from '@musefold/new-api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type NewApiIdentityFixture,
  startNewApiIdentityFixture,
} from '../new-api-identity-fixture.js';

describe('New API identity HTTP fixture', () => {
  let fixture: NewApiIdentityFixture;
  let client: NewApiClient;

  beforeEach(async () => {
    fixture = await startNewApiIdentityFixture();
    fixture.addOwner({ id: 101, username: 'owner-alpha' });
    fixture.addOwner({ id: 202, username: 'owner-beta' });
    fixture.mapUsername('login-alias', 101);
    client = createNewApiClient(fixture.baseUrl);
  });

  afterEach(async () => {
    await fixture.close();
  });

  const login = () => ({ username: 'login-alias', password: 'fixture-password' });

  it('remaps login aliases without changing an issued JWT or refresh owner', async () => {
    const a = await client.login(login());
    fixture.mapUsername('login-alias', 202);
    const b = await client.login(login());
    expect(a.user.id).toBe(101);
    expect(b.user.id).toBe(202);
    expect((await client.getSelf(a.jwt)).id).toBe(101);
    expect((await client.getSelf(b.jwt)).id).toBe(202);
    expect((await client.refresh(a.refreshToken)).user.id).toBe(101);
    expect(fixture.count({ operation: 'login', username: 'login-alias', ownerId: 101 })).toBe(1);
    expect(fixture.count({ operation: 'login', ownerId: 202 })).toBe(1);
  });

  it('keeps token creation, listing and key retrieval inside the authenticated owner', async () => {
    const a = fixture.issueSession(101);
    const b = fixture.issueSession(202);
    await client.createToken(a.jwt, { name: 'alpha-token' });
    await client.createToken(b.jwt, { name: 'beta-token' });
    const [aTokens, bTokens] = await Promise.all([
      client.listTokens(a.jwt),
      client.listTokens(b.jwt),
    ]);
    expect(aTokens.map((token) => token.name)).toEqual(['alpha-token']);
    expect(bTokens.map((token) => token.name)).toEqual(['beta-token']);
    const aId = aTokens[0]?.id;
    const bId = bTokens[0]?.id;
    if (!aId || !bId) throw new Error('Expected configured token IDs');
    const aKey = await client.fetchTokenKey(a.jwt, aId);
    const bKey = await client.fetchTokenKey(b.jwt, bId);
    expect(aKey).not.toBe(bKey);
    await expect(client.fetchTokenKey(a.jwt, bId)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(client.fetchTokenKey(b.jwt, aId)).rejects.toMatchObject({ httpStatus: 404 });
    expect(aTokens[0]?.keyMasked).toBe('sk-***');
    expect(JSON.stringify(aTokens)).not.toContain(aKey);
    expect(fixture.isTokenKeyActive(202, aKey)).toBe(false);
  });

  it('isolates even deliberately equal token IDs and rejects invalidated keys', async () => {
    const a = fixture.issueSession(101);
    const b = fixture.issueSession(202);
    const old = fixture.seedToken(101, { id: 77 });
    const other = fixture.seedToken(202, { id: 77 });
    expect(await client.fetchTokenKey(a.jwt, 77)).toBe(old.key);
    expect(await client.fetchTokenKey(b.jwt, 77)).toBe(other.key);
    const next = fixture.rotateToken(101, 77);
    expect(await client.fetchTokenKey(a.jwt, 77)).toBe(next.key);
    expect(next.key).not.toBe(old.key);
    expect(fixture.isTokenKeyActive(101, old.key)).toBe(false);
    fixture.invalidateToken(101, 77);
    await expect(client.fetchTokenKey(a.jwt, 77)).rejects.toMatchObject({ httpStatus: 403 });
    expect(await client.fetchTokenKey(b.jwt, 77)).toBe(other.key);
  });

  it('freezes an already produced key response while a later rotation completes', async () => {
    const a = fixture.issueSession(101);
    const old = fixture.seedToken(101);
    const barrier = fixture.pauseNext(
      { operation: 'fetchTokenKey', ownerId: 101, tokenId: old.id },
      { phase: 'after' },
    );
    const delayed = client.fetchTokenKey(a.jwt, old.id);
    const entered = await barrier.reached;
    expect(entered.completed).toBe(false);
    const next = fixture.rotateToken(101, old.id);
    expect(await client.fetchTokenKey(a.jwt, old.id)).toBe(next.key);
    barrier.release();
    expect(await delayed).toBe(old.key);
    expect(fixture.count({ operation: 'fetchTokenKey', ownerId: 101 })).toBe(2);
  });

  it('captures a login owner before a barrier instead of rereading a changed alias', async () => {
    const barrier = fixture.pauseNext({ operation: 'login', ownerId: 101 });
    const delayed = client.login(login());
    await barrier.reached;
    fixture.mapUsername('login-alias', 202);
    expect((await client.login(login())).user.id).toBe(202);
    barrier.release();
    expect((await delayed).user.id).toBe(101);
  });

  it('assigns both barriers to the arriving request before another request can overtake it', async () => {
    const a = fixture.issueSession(101);
    const token = fixture.seedToken(101);
    const match = { operation: 'fetchTokenKey' as const, ownerId: 101, tokenId: token.id };
    const before = fixture.pauseNext(match);
    const after = fixture.pauseNext(match, { phase: 'after' });
    const delayed = client.fetchTokenKey(a.jwt, token.id);
    const first = await before.reached;
    const next = fixture.rotateToken(101, token.id);
    expect(await client.fetchTokenKey(a.jwt, token.id)).toBe(next.key);
    before.release();
    expect((await after.reached).sequence).toBe(first.sequence);
    fixture.rotateToken(101, token.id);
    after.release();
    expect(await delayed).toBe(next.key);
  });

  it('makes single-use refresh competition deterministic across two real HTTP requests', async () => {
    const a = fixture.issueSession(101);
    const barrier = fixture.pauseNext({ operation: 'refresh', ownerId: 101 });
    const delayed = client.refresh(a.refreshToken).then(
      () => ({ code: 'unexpected-success' }),
      (error: unknown) => error,
    );
    await barrier.reached;
    const winner = await client.refresh(a.refreshToken);
    barrier.release();
    expect(await delayed).toMatchObject({ code: 'auth', httpStatus: 401 });
    expect(winner.user.id).toBe(101);
    expect(winner.refreshToken).not.toBe(a.refreshToken);
    expect((await client.getSelf(winner.jwt)).id).toBe(101);
    expect(fixture.count({ operation: 'refresh', ownerId: 101 })).toBe(2);
  });

  it('can inject getSelf and refresh owner mismatches without modifying existing JWT ownership', async () => {
    const a = fixture.issueSession(101);
    const token = fixture.seedToken(101);
    fixture.setGetSelfOwner(a.jwt, 202);
    expect((await client.getSelf(a.jwt)).id).toBe(202);
    expect(await client.fetchTokenKey(a.jwt, token.id)).toBe(token.key);
    fixture.setGetSelfOwner(a.jwt, null);
    expect((await client.getSelf(a.jwt)).id).toBe(101);
    fixture.setRefreshOwner(a.refreshToken, 202);
    const changed = await client.refresh(a.refreshToken);
    expect(changed.user.id).toBe(202);
    expect((await client.getSelf(a.jwt)).id).toBe(101);
    expect((await client.getSelf(changed.jwt)).id).toBe(202);
  });

  it('fails a selected owner once before token mutation and permits a later controlled retry', async () => {
    const a = fixture.issueSession(101);
    const b = fixture.issueSession(202);
    fixture.failNext({ operation: 'createToken', ownerId: 101 }, { status: 503 });
    await client.createToken(b.jwt, { name: 'other-owner' });
    await expect(client.createToken(a.jwt, { name: 'blocked' })).rejects.toMatchObject({
      code: 'server',
      httpStatus: 503,
    });
    expect(await client.listTokens(a.jwt)).toEqual([]);
    await client.createToken(a.jwt, { name: 'allowed' });
    expect((await client.listTokens(a.jwt)).map((token) => token.name)).toEqual(['allowed']);
  });

  it('models a lost response after token creation without automatically repeating the operation', async () => {
    const a = fixture.issueSession(101);
    fixture.failNext(
      { operation: 'createToken', ownerId: 101 },
      { phase: 'after', disconnect: true },
    );
    await expect(client.createToken(a.jwt, { name: 'already-created' })).rejects.toMatchObject({
      code: 'network',
    });
    expect((await client.listTokens(a.jwt)).map((token) => token.name)).toEqual([
      'already-created',
    ]);
    expect(fixture.count({ operation: 'createToken', ownerId: 101 })).toBe(1);
    expect(fixture.requests.find((request) => request.operation === 'createToken')).toMatchObject({
      status: 200,
      completed: false,
    });
  });

  it('supports expired JWT refresh, explicit invalidation and fixture-only logout', async () => {
    const a = fixture.issueSession(101, { expiresInSeconds: 0 });
    await expect(client.getSelf(a.jwt)).rejects.toMatchObject({ code: 'auth' });
    const active = await client.refresh(a.refreshToken);
    fixture.failNext({ operation: 'logout', ownerId: 101 }, { status: 503 });
    const invokeFixtureLogout = () =>
      fetch(`${fixture.baseUrl}/__fixture/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${active.jwt}` },
      });
    expect((await invokeFixtureLogout()).status).toBe(503);
    expect((await client.getSelf(active.jwt)).id).toBe(101);
    expect((await invokeFixtureLogout()).status).toBe(200);
    await expect(client.getSelf(active.jwt)).rejects.toMatchObject({ code: 'auth' });
    await expect(client.refresh(active.refreshToken)).rejects.toMatchObject({ code: 'auth' });
    const b = fixture.issueSession(202);
    fixture.invalidateJwt(b.jwt);
    fixture.invalidateRefresh(b.refreshToken);
    await expect(client.getSelf(b.jwt)).rejects.toMatchObject({ code: 'auth' });
    await expect(client.refresh(b.refreshToken)).rejects.toMatchObject({ code: 'auth' });
  });

  it('records only nonsecret observations and returns copies', async () => {
    const password = 'fixture-password-canary';
    fixture.mapUsername('login-alias', 101, password);
    const a = await client.login({ username: 'login-alias', password });
    const token = fixture.seedToken(101, { key: 'sk-fixture-key-canary' });
    await client.fetchTokenKey(a.jwt, token.id);
    await client.refresh(a.refreshToken);
    const encoded = JSON.stringify(fixture.requests);
    for (const secret of [password, a.jwt, a.refreshToken, token.key])
      expect(encoded).not.toContain(secret);
    expect(fixture.requests[1]?.sessionNumber).toBeTypeOf('number');
    const copy = fixture.requests;
    if (copy[0]) copy[0].ownerId = 999;
    expect(fixture.requests[0]?.ownerId).toBe(101);
  });

  it('closes with pending barriers without waiting for a caller to release them', async () => {
    const a = fixture.issueSession(101);
    const barrier = fixture.pauseNext({ operation: 'getSelf' });
    const pending = client.getSelf(a.jwt).catch((error: unknown) => error);
    await barrier.reached;
    await fixture.close();
    expect(await pending).toMatchObject({ code: 'network' });
    await fixture.close();
  });
});
