import { randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  designSchemePackageStageSchema,
  designSchemePackageRecoverySchema,
  designSchemePackageRecoveryPageSchema,
} from '@musefold/contracts';
import { startPackageExchangeApp } from '../fixtures/package-exchange-app.js';
import { packageExchangeContent } from '../fixtures/package-exchange-content.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('package routes through actual Better Auth and production app assembly', () => {
  let fixture: Awaited<ReturnType<typeof startPackageExchangeApp>>;
  let bytes: Buffer;
  let owner: string;
  let other: string;
  const origin = 'http://127.0.0.1:3399';
  const request = (cookie: string, path: string, init: RequestInit = {}) =>
    fixture.app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', origin, cookie, ...init.headers },
    });
  async function login(email: string, signup = true) {
    const response = await request('', `/api/auth/${signup ? 'sign-up' : 'sign-in'}/new-api`, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'correct-password' }),
    });
    expect(response.status).toBe(200);
    return (response.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');
  }
  async function begin(cookie = owner) {
    const response = await request(cookie, '/api/v1/design-schemes/packages', {
      method: 'POST',
      body: JSON.stringify({
        requestId: randomUUID(),
        packageHash: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
        formatVersion: 2,
      }),
    });
    expect(response.status).toBe(200);
    return designSchemePackageStageSchema.parse(await response.json());
  }
  beforeAll(async () => {
    fixture = await startPackageExchangeApp();
    bytes = await (await packageExchangeContent()).encode();
    owner = await login('exchange-owner@example.test');
    other = await login('exchange-recipient@example.test');
  }, 180000);
  afterAll(async () => {
    await fixture?.close();
  });

  it('actual signed cookie admits owner history and upload; recipient cannot read/write the stage', async () => {
    const stage = await begin();
    const path = `/api/v1/design-schemes/packages/${stage.stagedPackageId}`;
    for (const suffix of ['', '/recovery'])
      expect((await request(other, path + suffix)).status).toBe(404);
    expect(
      (
        await request(other, `${path}/content`, {
          method: 'PUT',
          body: bytes,
          headers: { 'content-type': 'application/octet-stream' },
        })
      ).status,
    ).toBe(404);
    const upload = await request(owner, `${path}/content`, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(upload.status).toBe(200);
    expect(designSchemePackageStageSchema.parse(await upload.json()).status).toBe('ready');
    const history = await request(other, '/api/v1/design-schemes/packages');
    expect(history.status).toBe(200);
    expect(designSchemePackageRecoveryPageSchema.parse(await history.json()).items).toEqual([]);
  });
  it('no cookie or a forged owner header cannot access package history or start an export', async () => {
    for (const path of [
      '/api/v1/design-schemes/packages',
      '/api/v1/design-schemes/package-exports',
    ]) {
      expect(
        (await request('', path, { headers: { 'x-package-fixture-owner': 'exchange-owner' } }))
          .status,
      ).toBe(401);
      expect((await request('better-auth.session_token=forged', path)).status).toBe(401);
    }
    expect(
      (await request('', '/api/v1/design-schemes/package-exports', { method: 'POST', body: '{}' }))
        .status,
    ).toBe(401);
  });
  it('cookie from a hostile Origin cannot cancel or upload; owner state is unchanged', async () => {
    const stage = await begin();
    const path = `/api/v1/design-schemes/packages/${stage.stagedPackageId}`;
    const writes = fixture.s3.writes.length;
    expect(
      (
        await request(owner, path, {
          method: 'DELETE',
          headers: { origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(owner, `${path}/content`, {
          method: 'PUT',
          body: bytes,
          headers: {
            origin: 'https://untrusted.example',
            'content-type': 'application/octet-stream',
          },
        })
      ).status,
    ).toBe(403);
    expect(
      designSchemePackageStageSchema.parse(await (await request(owner, path)).json()).status,
    ).toBe(stage.status);
    expect(fixture.s3.writes.length).toBe(writes);
  });
  it('actual sign-out revokes the old cookie for both recovery histories and writes', async () => {
    const cookie = await login('exchange-signout@example.test');
    const stage = await begin(cookie);
    expect(
      (await request(cookie, '/api/auth/sign-out', { method: 'POST', body: '{}' })).status,
    ).toBe(200);
    for (const path of [
      '/api/v1/design-schemes/packages',
      '/api/v1/design-schemes/package-exports',
      `/api/v1/design-schemes/packages/${stage.stagedPackageId}/recovery`,
    ])
      expect((await request(cookie, path)).status).toBe(401);
    expect(
      (
        await request(cookie, `/api/v1/design-schemes/packages/${stage.stagedPackageId}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(401);
  });
  it('a fresh actual login discovers the original upload but does not inherit its authority', async () => {
    const email = 'exchange-relogin@example.test';
    const previous = await login(email);
    const stage = await begin(previous);
    await request(previous, '/api/auth/sign-out', { method: 'POST', body: '{}' });
    const current = await login(email, false);
    const path = `/api/v1/design-schemes/packages/${stage.stagedPackageId}`;
    const recovery = await request(current, `${path}/recovery`);
    expect(recovery.status).toBe(200);
    const record = designSchemePackageRecoverySchema.parse(await recovery.json());
    expect(record.canContinue).toBe(false);
    expect(record.blockedReason).toBe('session_changed');
    const writes = fixture.s3.writes.length;
    expect(
      (
        await request(current, `${path}/content`, {
          method: 'PUT',
          body: bytes,
          headers: { 'content-type': 'application/octet-stream' },
        })
      ).status,
    ).toBe(409);
    expect(fixture.s3.writes.length).toBe(writes);
  });
});
