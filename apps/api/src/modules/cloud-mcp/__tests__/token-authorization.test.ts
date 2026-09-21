import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';
import { CloudMcpService } from '../service.js';

const CLAIMS = {
  sub: 'principal-a',
  client_id: 'https://client.example/mcp.json',
  sid: 'session-a',
  scope: 'account:read prompts:read',
  mf_consent_id: 'consent-new',
  iat: 1_789_000_000,
  jti: 'signed-jwt-id',
};

function database(rows: [string, string[]][] = []) {
  // Real Drizzle SQL construction; only the pg transport is substituted.
  const query = vi.fn(async () => ({ rows }));
  const db = drizzle({ client: { query } as never });
  return { service: new CloudMcpService(db as never), query };
}

describe('Cloud MCP token authorization', () => {
  it('requires the exact persistent consent ID and one live normal session/principal', async () => {
    const { service, query } = database([['consent-new', ['account:read', 'prompts:read']]]);
    await expect(service.hasActiveTokenAuthorization(CLAIMS)).resolves.toBe(true);
    const [config, parameters] = query.mock.calls[0] as unknown as [{ text: string }, unknown[]];
    expect(config.text).toContain('inner join "oauth_client"');
    expect(config.text).toContain('inner join "session"');
    expect(config.text).toContain('inner join "account_session_authorizations"');
    expect(config.text).toContain('inner join "account_identities"');
    expect(config.text).toContain('"oauth_consent"."id" =');
    expect(config.text).toContain('"session"."expires_at" >');
    expect(config.text).toContain('"session"."user_id" = "oauth_consent"."user_id"');
    expect(config.text).toContain(
      '"account_session_authorizations"."user_id" = "session"."user_id"',
    );
    expect(parameters).toEqual(
      expect.arrayContaining([
        CLAIMS.sub,
        CLAIMS.client_id,
        CLAIMS.sid,
        CLAIMS.mf_consent_id,
        'normal',
        'active',
        false,
      ]),
    );
    expect(parameters).not.toContain(CLAIMS.jti);
  });

  it.each(['sub', 'client_id', 'sid', 'scope', 'mf_consent_id'] as const)(
    'rejects legacy/malformed claims missing %s before querying PG',
    async (field) => {
      const { service, query } = database();
      const claims: Record<string, unknown> = { ...CLAIMS };
      delete claims[field];
      await expect(service.hasActiveTokenAuthorization(claims)).resolves.toBe(false);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('does not accept a later consent merely because owner/client and iat still match', async () => {
    const { service, query } = database();
    await expect(
      service.hasActiveTokenAuthorization({ ...CLAIMS, mf_consent_id: 'consent-old' }),
    ).resolves.toBe(false);
    const [, parameters] = query.mock.calls[0] as unknown as [unknown, unknown[]];
    expect(parameters).toContain('consent-old');
    expect(parameters).not.toContain('consent-new');
    expect(parameters).not.toContain(CLAIMS.iat);
  });

  it('rejects a valid token whose scopes exceed the current consent', async () => {
    const { service } = database([['consent-new', ['account:read']]]);
    await expect(service.hasActiveTokenAuthorization(CLAIMS)).resolves.toBe(false);
  });

  it('permits the exact scope subset and does not add tools from wider consent', async () => {
    const { service } = database([
      ['consent-new', ['account:read', 'prompts:read', 'skills:read']],
    ]);
    await expect(service.hasActiveTokenAuthorization(CLAIMS)).resolves.toBe(true);
  });

  it('binds newly issued tokens to the matching consent without retaining bearer material', async () => {
    const { service, query } = database([['consent-new', ['account:read', 'prompts:read']]]);
    const result = await service.createAccessTokenClaims({
      userId: CLAIMS.sub,
      clientId: CLAIMS.client_id,
      sessionId: CLAIMS.sid,
      scopes: ['account:read'],
      referenceId: 'musefold-consent:consent-new',
    });
    expect(result).toEqual({ mf_consent_id: 'consent-new' });
    const [config, parameters] = query.mock.calls[0] as unknown as [{ text: string }, unknown[]];
    expect(config.text).toContain('"oauth_consent"."id" =');
    expect(parameters).toContain('consent-new');
    expect(JSON.stringify(result)).not.toMatch(/token|session|jwt|refresh/i);
  });

  it('does not borrow a consent for a different authorization reference', async () => {
    const { service, query } = database();
    await expect(
      service.createAccessTokenClaims({
        userId: CLAIMS.sub,
        clientId: CLAIMS.client_id,
        sessionId: CLAIMS.sid,
        scopes: ['account:read'],
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses issuing a broader scope than the currently authorized grant', async () => {
    const { service } = database([['consent-new', ['account:read']]]);
    await expect(
      service.createAccessTokenClaims({
        userId: CLAIMS.sub,
        clientId: CLAIMS.client_id,
        sessionId: CLAIMS.sid,
        scopes: ['prompts:read'],
        referenceId: 'musefold-consent:consent-new',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 403 });
  });

  it('refuses issuing a token without a session before querying PG', async () => {
    const { service, query } = database();
    await expect(
      service.createAccessTokenClaims({
        userId: CLAIMS.sub,
        clientId: CLAIMS.client_id,
        sessionId: '',
        scopes: ['account:read'],
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it('freezes the original consent in the durable authorization-code value', async () => {
    const { service, query } = database([['consent-new', ['account:read']]]);
    const original = {
      type: 'authorization_code',
      userId: CLAIMS.sub,
      sessionId: CLAIMS.sid,
      query: {
        client_id: CLAIMS.client_id,
        scope: 'account:read',
        code_challenge: 'preserved-pkce',
      },
      resource: ['https://api.example/mcp'],
      authTime: 1234,
    };
    const result = JSON.parse(await service.freezeAuthorizationCode(JSON.stringify(original)));
    expect(result).toEqual({ ...original, referenceId: 'musefold-consent:consent-new' });
    const [config] = query.mock.calls[0] as unknown as [{ text: string }];
    expect(config.text).toContain('"oauth_consent"."reference_id" is null');
  });

  it('leaves unrelated verification values alone but rejects malformed OAuth codes', async () => {
    const { service, query } = database();
    await expect(service.freezeAuthorizationCode('opaque-other-verification')).resolves.toBe(
      'opaque-other-verification',
    );
    await expect(service.freezeAuthorizationCode('{"type":"other"}')).resolves.toBe(
      '{"type":"other"}',
    );
    await expect(
      service.freezeAuthorizationCode('{"type":"authorization_code"}'),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['old-reference', 'musefold-consent:', undefined])(
    'rejects legacy refresh lineage %s without borrowing a new consent',
    async (referenceId) => {
      const { service, query } = database();
      query.mockResolvedValueOnce({
        rows: [
          ['principal-a', CLAIMS.client_id, 'session-a', referenceId, ['account:read']],
        ] as never,
      });
      await expect(service.hasActiveRefreshTokenAuthorization('hashed-refresh')).resolves.toBe(
        false,
      );
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
});
