import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_MCP_CUSTOM_SERVER_CODE,
  OFFICIAL_CLOUD_API_BASE,
  V25_METHODS_BY_DOMAIN,
} from '@musefold/contracts';
import { BridgeError, type MethodDef } from '../envelope';
import { buildCloudMcpDomainMethods } from '../cloud-mcp-domain';

const LIST = {
  items: [
    {
      clientId: 'cursor-mcp-client',
      name: 'Cursor',
      uri: null,
      scopes: ['account:read'],
      authorizedAt: '2026-08-01T12:00:00.000+00:00',
      lastUsedAt: '2026-09-06T08:30:00.000+00:00',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function call(methods: Record<string, MethodDef>, method: string, payload?: unknown) {
  const def = methods[method];
  if (!def) throw new Error(`missing ${method}`);
  const parsed = def.input.safeParse(payload);
  if (!parsed.success) throw new Error(`VALIDATION_FAILED: ${method}`);
  return def.handle(parsed.data);
}

describe('cloudMcp 域桥', () => {
  it('registers exactly the contract method set', () => {
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => OFFICIAL_CLOUD_API_BASE,
      readSessionToken: async () => 'session-token',
    });
    expect(Object.keys(methods).sort()).toEqual([...V25_METHODS_BY_DOMAIN.cloudMcp].sort());
  });

  it('lists authorizations on the official cloud and keeps the payload secret-free', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(LIST));
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => OFFICIAL_CLOUD_API_BASE,
      readSessionToken: async () => 'session-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(call(methods, 'cloudMcp.listAuthorizations')).resolves.toEqual(LIST);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${OFFICIAL_CLOUD_API_BASE}/api/v1/mcp/authorizations`,
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer session-token' },
      }),
    );
    expect(JSON.stringify(LIST)).not.toMatch(/access_token|refresh_token|client_secret|\//);
  });

  it('revokes by clientId on the official cloud', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ revoked: true, clientId: 'cursor-mcp-client' }),
    );
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => OFFICIAL_CLOUD_API_BASE,
      readSessionToken: async () => 'session-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      call(methods, 'cloudMcp.revokeAuthorization', { clientId: 'cursor-mcp-client' }),
    ).resolves.toEqual({ revoked: true, clientId: 'cursor-mcp-client' });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${OFFICIAL_CLOUD_API_BASE}/api/v1/mcp/authorizations/cursor-mcp-client`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('rejects a custom account server with a stable code (UI 暂不支持)', async () => {
    const fetchImpl = vi.fn();
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => 'https://self-host.example',
      readSessionToken: async () => 'session-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(call(methods, 'cloudMcp.listAuthorizations')).rejects.toMatchObject({
      name: 'BridgeError',
      code: CLOUD_MCP_CUSTOM_SERVER_CODE,
      message: '自定义账号服务器暂不支持 Cloud MCP 连接管理',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires a session before talking to the official cloud', async () => {
    const fetchImpl = vi.fn();
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => OFFICIAL_CLOUD_API_BASE,
      readSessionToken: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(call(methods, 'cloudMcp.listAuthorizations')).rejects.toBeInstanceOf(BridgeError);
    await expect(call(methods, 'cloudMcp.listAuthorizations')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a list envelope that leaks a token or a host path', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            ...LIST.items[0],
            access_token: 'tok',
            path: '/Users/creator/.config/musefold',
          },
        ],
      }),
    );
    const methods = buildCloudMcpDomainMethods({
      apiBase: () => OFFICIAL_CLOUD_API_BASE,
      readSessionToken: async () => 'session-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(call(methods, 'cloudMcp.listAuthorizations')).rejects.toThrow();
  });
});
