import { describe, expect, it, vi } from 'vitest';
import {
  assembleCloudMcpAuthorizations,
  CloudMcpService,
  cloudMcpUnauthorizedResponse,
} from '../service.js';

const OWNER = 'owner-1';
const OTHER = 'owner-2';
const CLIENT = 'cursor-mcp-client';

describe('assembleCloudMcpAuthorizations', () => {
  it('joins display name fallback, lastUsedAt, and keeps the payload secret-free', () => {
    const list = assembleCloudMcpAuthorizations(
      [
        {
          clientId: CLIENT,
          name: null,
          uri: ' https://cursor.com ',
          scopes: ['account:read', 'prompts:read'],
          authorizedAt: new Date('2026-08-01T12:00:00.000Z'),
          authorizedUpdatedAt: null,
        },
        {
          clientId: 'claude-desktop',
          name: 'Claude',
          uri: null,
          scopes: ['account:read'],
          authorizedAt: new Date('2026-09-01T00:00:00.000Z'),
          authorizedUpdatedAt: null,
        },
      ],
      [
        { clientId: CLIENT, createdAt: new Date('2026-08-10T00:00:00.000Z') },
        { clientId: CLIENT, createdAt: new Date('2026-09-06T08:30:00.000Z') },
      ],
    );

    expect(list.items.map((item) => item.clientId)).toEqual(['claude-desktop', CLIENT]);
    expect(list.items[1]).toMatchObject({
      clientId: CLIENT,
      name: 'cursor-m',
      uri: 'https://cursor.com',
      lastUsedAt: '2026-09-06T08:30:00.000+00:00',
    });
    expect(JSON.stringify(list)).not.toMatch(/access_token|refresh_token|client_secret/);
  });

  it('keeps lastUsedAt null when every access token is missing', () => {
    const list = assembleCloudMcpAuthorizations(
      [
        {
          clientId: CLIENT,
          name: 'Cursor',
          uri: null,
          scopes: [],
          authorizedAt: new Date('2026-08-01T12:00:00.000Z'),
          authorizedUpdatedAt: null,
        },
      ],
      [],
    );
    expect(list.items[0]?.lastUsedAt).toBeNull();
    expect(list.items[0]?.name).toBe('Cursor');
  });
});

describe('CloudMcpService', () => {
  it('lists only the owner consents and never returns token plaintext', async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce([
        {
          clientId: CLIENT,
          name: 'Cursor',
          uri: null,
          scopes: ['account:read'],
          authorizedAt: new Date('2026-08-01T12:00:00.000Z'),
          authorizedUpdatedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        { clientId: CLIENT, createdAt: new Date('2026-09-06T08:30:00.000Z') },
      ]);

    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: select,
          }),
          where: select,
        }),
      }),
    };
    const service = new CloudMcpService(db as never);
    const list = await service.listAuthorizations(OWNER);

    expect(list).toMatchObject({
      items: [
        {
          clientId: CLIENT,
          name: 'Cursor',
          lastUsedAt: '2026-09-06T08:30:00.000+00:00',
        },
      ],
    });
    expect(select).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(list)).not.toMatch(/access_token|refresh_token|client_secret/);
  });

  it('revokes by deleting consent and stamping access/refresh tokens', async () => {
    const deleted: unknown[] = [];
    const updates: Array<{ set: unknown; where: unknown }> = [];
    const tx = {
      delete: () => ({
        where: (where: unknown) => {
          deleted.push(where);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (set: unknown) => ({
          where: (where: unknown) => {
            updates.push({ set, where });
            return Promise.resolve();
          },
        }),
      }),
    };
    const db = {
      transaction: async (fn: (inner: typeof tx) => Promise<void>) => fn(tx),
    };
    const service = new CloudMcpService(db as never);

    await expect(service.revokeAuthorization(OWNER, CLIENT)).resolves.toEqual({
      revoked: true,
      clientId: CLIENT,
    });
    expect(deleted).toHaveLength(1);
    expect(updates).toHaveLength(2);
    expect(updates.every((entry) => entry.set && typeof entry.set === 'object')).toBe(true);
    for (const entry of updates) {
      expect((entry.set as { revoked: Date }).revoked).toBeInstanceOf(Date);
    }
  });

  it('treats a missing consent row as inactive (MCP JWT must 401 after revoke)', async () => {
    const where = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });
    const db = {
      select: () => ({
        from: () => ({ where }),
      }),
    };
    const service = new CloudMcpService(db as never);
    await expect(service.hasActiveAuthorization(OWNER, CLIENT)).resolves.toBe(false);
    await expect(service.hasActiveAuthorization(OTHER, CLIENT)).resolves.toBe(false);
    await expect(service.hasActiveAuthorization('', CLIENT)).resolves.toBe(false);
  });
});

describe('cloudMcpUnauthorizedResponse', () => {
  it('returns 401 without leaking secrets', async () => {
    const response = cloudMcpUnauthorizedResponse();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({
      error: 'invalid_token',
      error_description: 'authorization revoked',
    });
    expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|client_secret/);
  });
});
