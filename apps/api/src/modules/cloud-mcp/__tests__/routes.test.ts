import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { cloudMcpRoutes } from '../routes.js';
import type { CloudMcpService } from '../service.js';

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

function testApp(service: CloudMcpService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'cloud-mcp-routes-user');
    c.set('sessionId', 'cloud-mcp-routes-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, 'cloud-mcp-routes-request'), error.status as 400);
    }
    throw error;
  });
  app.route('/', cloudMcpRoutes(service));
  return app;
}

describe('cloud MCP authorization routes', () => {
  it('lists authorizations for the authenticated owner', async () => {
    const listAuthorizations = vi.fn().mockResolvedValue(LIST);
    const app = testApp({ listAuthorizations } as unknown as CloudMcpService);

    const response = await app.request('http://localhost/mcp/authorizations');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(LIST);
    expect(listAuthorizations).toHaveBeenCalledWith('cloud-mcp-routes-user');
    expect(JSON.stringify(LIST)).not.toMatch(/access_token|refresh_token|client_secret/);
  });

  it('revokes by clientId for the authenticated owner', async () => {
    const revokeAuthorization = vi.fn().mockResolvedValue({
      revoked: true,
      clientId: 'cursor-mcp-client',
    });
    const app = testApp({ revokeAuthorization } as unknown as CloudMcpService);

    const response = await app.request('http://localhost/mcp/authorizations/cursor-mcp-client', {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      revoked: true,
      clientId: 'cursor-mcp-client',
    });
    expect(revokeAuthorization).toHaveBeenCalledWith('cloud-mcp-routes-user', 'cursor-mcp-client');
  });

  it('rejects an empty clientId before touching the service', async () => {
    const revokeAuthorization = vi.fn();
    const app = testApp({ revokeAuthorization } as unknown as CloudMcpService);

    const response = await app.request('http://localhost/mcp/authorizations/%20', {
      method: 'DELETE',
    });
    expect(response.status).toBe(400);
    expect(revokeAuthorization).not.toHaveBeenCalled();
  });
});
