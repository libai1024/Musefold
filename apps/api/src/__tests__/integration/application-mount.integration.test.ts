import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPackageExchangeApp } from '../fixtures/package-exchange-app.js';

const origin = 'https://shared.example.test';
const mount = '/Musefold/v25';
const base = `${origin}${mount}`;
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('path-mounted product on a shared domain (real auth and PostgreSQL)', () => {
  let fixture: Awaited<ReturnType<typeof startPackageExchangeApp>>;
  beforeAll(async () => {
    fixture = await startPackageExchangeApp({ publicBaseUrl: base });
  }, 120_000);
  afterAll(async () => fixture?.close());

  it('mounts login, cookie sessions and protected writes without claiming other apps', async () => {
    expect((await fixture.app.request(`${base}/healthz`)).status).toBe(200);
    expect((await fixture.app.request(`${origin}/api/auth/get-session`)).status).toBe(404);
    expect((await fixture.app.request(`${origin}/OtherApp/api/auth/get-session`)).status).toBe(404);
    const login = await fixture.app.request(`${base}/api/auth/sign-in/new-api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: 'tester@musefold.app', password: 'correct-password' }),
    });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    const sessionCookie = cookies.find((cookie) => cookie.includes('session_token='));
    expect(sessionCookie).toContain(`Path=${mount}`);
    expect(sessionCookie).toMatch(/musefold_[a-f0-9]{12}\.session_token=/);
    const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
    const status = await fixture.app.request(`${base}/api/v1/account/status`, {
      headers: { cookie },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      username: 'tester',
      identity: { apiIssuer: base },
    });
    const create = await fixture.app.request(`${base}/api/v1/prompts`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Mounted prompt',
        content: 'Shared domain verification',
        description: null,
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    expect(create.status).toBe(201);
    const logout = await fixture.app.request(`${base}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(logout.status).toBe(200);
    expect(
      (await fixture.app.request(`${base}/api/v1/account/status`, { headers: { cookie } })).status,
    ).toBe(401);
  });

  it('publishes path-specific OAuth discovery without taking the domain root document', async () => {
    const resource = await fixture.app.request(
      `${origin}/.well-known/oauth-protected-resource${mount}/mcp`,
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: `${base}/mcp`,
      authorization_servers: [`${base}/api/auth`],
    });
    const authorization = await fixture.app.request(
      `${origin}/.well-known/oauth-authorization-server${mount}/api/auth`,
    );
    expect(authorization.status).toBe(200);
    expect(await authorization.json()).toMatchObject({
      issuer: `${base}/api/auth`,
      authorization_endpoint: `${base}/api/auth/oauth2/authorize`,
    });
    expect(
      (await fixture.app.request(`${origin}/.well-known/oauth-authorization-server`)).status,
    ).toBe(404);
  });
});
