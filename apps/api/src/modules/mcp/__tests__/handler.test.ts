import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
  registered: [] as string[],
  fetch: vi.fn(async () => new Response('{"jsonrpc":"2.0","result":{}}')),
  close: vi.fn(async () => undefined),
}));

vi.mock('@better-auth/mcp', () => ({
  // SDK JWT verification is outside this unit. Pass only its verified claims seam.
  requireMcpAuth:
    (
      _auth: unknown,
      handler: (request: Request, claims: Record<string, unknown>) => Promise<Response>,
    ) =>
    (request: Request) =>
      handler(request, mocks.claims),
}));
vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: class {
    registerTool(name: string) {
      mocks.registered.push(name);
    }
  },
  createMcpHandler: (factory: () => unknown) => {
    factory();
    return { fetch: mocks.fetch, close: mocks.close };
  },
}));

import { createCloudMcpRequestHandler } from '../handler.js';
import { CLOUD_MCP_TOOL_NAMES, type CloudMcpDependencies } from '../manifest.js';

function dependencies(
  isAuthorizationActive?: CloudMcpDependencies['isAuthorizationActive'],
): CloudMcpDependencies {
  return {
    prompts: {} as never,
    skills: {} as never,
    account: {} as never,
    resourceUrl: 'https://api.example/mcp',
    modelAliases: ['musefold-image-pro'],
    isAuthorizationActive,
  };
}
const request = () => new Request('https://api.example/mcp', { method: 'POST', body: '{}' });

beforeEach(() => {
  mocks.claims = {
    sub: 'principal-a',
    client_id: 'client-a',
    sid: 'session-a',
    scope: 'account:read prompts:read skills:read',
    mf_consent_id: 'consent-a',
    jti: 'jwt-a',
  };
  mocks.registered.length = 0;
  mocks.fetch.mockClear();
  mocks.close.mockClear();
});

describe('Cloud MCP persistent token gate', () => {
  it('passes all verified claims to the gate before exposing the unchanged seven read tools', async () => {
    const gate = vi.fn(async () => true);
    const handler = createCloudMcpRequestHandler({} as never, dependencies(gate));
    expect((await handler(request())).status).toBe(200);
    expect(gate).toHaveBeenCalledExactlyOnceWith(mocks.claims);
    expect(mocks.registered).toEqual(CLOUD_MCP_TOOL_NAMES);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.any(Request), {
      authInfo: {
        token: '',
        clientId: 'client-a',
        scopes: ['account:read', 'prompts:read', 'skills:read'],
      },
    });
  });

  it('keeps registration limited to token scopes even when the grant is broader', async () => {
    mocks.claims.scope = 'prompts:read';
    const handler = createCloudMcpRequestHandler(
      {} as never,
      dependencies(async () => true),
    );
    expect((await handler(request())).status).toBe(200);
    expect(mocks.registered).toEqual(['search_prompts', 'get_prompt']);
  });

  it('rechecks every request so revocation affects an already constructed handler', async () => {
    const gate = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const handler = createCloudMcpRequestHandler({} as never, dependencies(gate));
    expect((await handler(request())).status).toBe(200);
    const revoked = await handler(request());
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({
      error: 'invalid_token',
      error_description: 'authorization revoked',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('fails closed when persistent authorization is unavailable', async () => {
    const handler = createCloudMcpRequestHandler({} as never, dependencies());
    expect((await handler(request())).status).toBe(401);
    expect(mocks.registered).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['sub', 'client_id'])('rejects empty %s without registering tools', async (field) => {
    mocks.claims[field] = '';
    const gate = vi.fn(async () => true);
    const handler = createCloudMcpRequestHandler({} as never, dependencies(gate));
    expect((await handler(request())).status).toBe(401);
    expect(gate).not.toHaveBeenCalled();
    expect(mocks.registered).toEqual([]);
  });
});
