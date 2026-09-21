import { requireMcpAuth } from '@better-auth/mcp';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { MusefoldAuth } from '../../auth/index.js';
import { cloudMcpUnauthorizedResponse } from '../cloud-mcp/service.js';
import { type CloudMcpAuth, type CloudMcpDependencies, enabledCloudMcpTools } from './manifest.js';

/**
 * 云端 MCP 入口(Streamable HTTP,仅 POST,legacy 协议一律拒绝)。
 * requireMcpAuth 验证 Better Auth 签发的 JWT;按授权 scope 动态注册白名单工具。
 */
export function createCloudMcpRequestHandler(
  auth: MusefoldAuth,
  deps: CloudMcpDependencies,
): (request: Request) => Promise<Response> {
  const handleAuthed = async (request: Request, claims: Record<string, unknown>) => {
    const callerAuth: CloudMcpAuth = {
      userId: typeof claims.sub === 'string' ? claims.sub : '',
      clientId: typeof claims.client_id === 'string' ? claims.client_id : '',
      scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    };
    if (!deps.isAuthorizationActive || !callerAuth.userId || !callerAuth.clientId)
      return cloudMcpUnauthorizedResponse();
    const active = await deps.isAuthorizationActive(claims);
    if (!active) return cloudMcpUnauthorizedResponse();
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'musefold-cloud', version: '2.5.0' });
        for (const entry of enabledCloudMcpTools(callerAuth.scopes)) {
          entry.register(server, callerAuth, deps);
        }
        return server;
      },
      { legacy: 'reject' },
    );
    try {
      return await handler.fetch(request, {
        authInfo: {
          token: '',
          clientId: callerAuth.clientId,
          scopes: [...callerAuth.scopes],
        },
      });
    } finally {
      await handler.close();
    }
  };
  return requireMcpAuth(auth, handleAuthed, { resource: deps.resourceUrl });
}
