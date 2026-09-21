import { describe, expect, it } from 'vitest';
import {
  CLOUD_MCP_CUSTOM_SERVER_CODE,
  OFFICIAL_CLOUD_API_BASE,
  cloudMcpAuthorizationListSchema,
  cloudMcpAuthorizationSchema,
  cloudMcpClientDisplayName,
  cloudMcpRevokeInputSchema,
  cloudMcpRevokeResultSchema,
  isOfficialCloudApiBase,
  toCloudMcpIso,
} from '../cloud-mcp';
import { V25_METHODS_BY_DOMAIN } from '../gateway-methods';

const AUTHORIZED_AT = '2026-08-01T12:00:00.000+00:00';
const LAST_USED_AT = '2026-09-06T08:30:00.000+00:00';

const READY = {
  clientId: 'cursor-mcp-client',
  name: 'Cursor',
  uri: 'https://cursor.com',
  scopes: ['account:read', 'prompts:read', 'skills:read'],
  authorizedAt: AUTHORIZED_AT,
  lastUsedAt: LAST_USED_AT,
};

describe('cloudMcp authorization contracts(secret-free)', () => {
  it('accepts the list/revoke shapes and keeps extra secret fields out', () => {
    expect(cloudMcpAuthorizationSchema.parse(READY)).toEqual(READY);
    expect(
      cloudMcpAuthorizationSchema.parse({ ...READY, uri: null, lastUsedAt: null }),
    ).toMatchObject({ uri: null, lastUsedAt: null });
    expect(cloudMcpAuthorizationListSchema.parse({ items: [READY] })).toEqual({ items: [READY] });
    expect(cloudMcpAuthorizationListSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(cloudMcpRevokeInputSchema.parse({ clientId: 'cursor-mcp-client' })).toEqual({
      clientId: 'cursor-mcp-client',
    });
    expect(
      cloudMcpRevokeResultSchema.parse({ revoked: true, clientId: 'cursor-mcp-client' }),
    ).toEqual({ revoked: true, clientId: 'cursor-mcp-client' });

    for (const leaked of [
      { ...READY, access_token: 'tok' },
      { ...READY, refresh_token: 'tok' },
      { ...READY, client_secret: 'sec' },
      { ...READY, accessToken: 'tok' },
      { ...READY, token: 'tok' },
    ]) {
      expect(cloudMcpAuthorizationSchema.safeParse(leaked).success, JSON.stringify(leaked)).toBe(
        false,
      );
    }
    expect(
      cloudMcpAuthorizationListSchema.safeParse({
        items: [READY],
        client_secret: 'sec',
      }).success,
    ).toBe(false);
    expect(cloudMcpRevokeResultSchema.safeParse({ revoked: false, clientId: 'x' }).success).toBe(
      false,
    );
    expect(cloudMcpRevokeInputSchema.safeParse({}).success).toBe(false);
    expect(cloudMcpRevokeInputSchema.safeParse({ clientId: 'x', extra: true }).success).toBe(false);
    expect(
      cloudMcpAuthorizationSchema.safeParse({ ...READY, authorizedAt: '2026-08-01' }).success,
    ).toBe(false);
  });

  it('falls back to a clientId prefix when the stored name is empty', () => {
    expect(cloudMcpClientDisplayName('Cursor', 'cursor-mcp-client')).toBe('Cursor');
    expect(cloudMcpClientDisplayName('  ', 'abcdefghijklmnop')).toBe('abcdefgh');
    expect(cloudMcpClientDisplayName(null, 'short')).toBe('short');
    expect(cloudMcpClientDisplayName(undefined, 'xy')).toBe('xy');
  });

  it('emits offset ISO and recognizes only the official cloud API base', () => {
    expect(OFFICIAL_CLOUD_API_BASE).toBe('https://zhaozhaoyue.top/Musefold/v25');
    expect(toCloudMcpIso(new Date('2026-09-06T08:30:00.000Z'))).toBe(
      '2026-09-06T08:30:00.000+00:00',
    );
    expect(isOfficialCloudApiBase(OFFICIAL_CLOUD_API_BASE)).toBe(true);
    expect(isOfficialCloudApiBase(`${OFFICIAL_CLOUD_API_BASE}/`)).toBe(true);
    expect(isOfficialCloudApiBase('https://self-host.example')).toBe(false);
    expect(CLOUD_MCP_CUSTOM_SERVER_CODE).toBe('CLOUD_MCP_CUSTOM_SERVER');
  });
});

describe('cloudMcp gateway method table', () => {
  it('registers list/revoke and stays bidirectional with the domain table', () => {
    expect(V25_METHODS_BY_DOMAIN.cloudMcp).toEqual([
      'cloudMcp.listAuthorizations',
      'cloudMcp.revokeAuthorization',
    ]);
    expect(V25_METHODS_BY_DOMAIN.cloudMcp).not.toContain('cloudMcp.getToken');
    expect(V25_METHODS_BY_DOMAIN.cloudMcp).not.toContain('cloudMcp.revealSecret');
    for (const name of V25_METHODS_BY_DOMAIN.cloudMcp) {
      expect(name.startsWith('cloudMcp.')).toBe(true);
    }
    expect(Object.keys(V25_METHODS_BY_DOMAIN)).toContain('cloudMcp');
  });
});
