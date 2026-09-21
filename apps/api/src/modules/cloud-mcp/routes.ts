import {
  cloudMcpAuthorizationListSchema,
  cloudMcpClientIdSchema,
  cloudMcpRevokeInputSchema,
  cloudMcpRevokeResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { CloudMcpService } from './service.js';

const clientIdParams = z.object({ clientId: cloudMcpClientIdSchema }).strict();

export function cloudMcpRoutes(service: CloudMcpService) {
  const app = createAuthedRouter();
  const tags = ['cloud-mcp'];

  route(
    app,
    {
      method: 'get',
      path: '/mcp/authorizations',
      tags,
      summary: '列出当前用户已授权的 Cloud MCP OAuth 客户端(owner 作用域,secret-free)',
      response: cloudMcpAuthorizationListSchema,
    },
    async (c) => c.json(await service.listAuthorizations(c.get('userId'))),
  );

  route(
    app,
    {
      method: 'delete',
      path: '/mcp/authorizations/{clientId}',
      tags,
      summary: '撤销某客户端授权:删 consent 并标记该 user+client 的令牌 revoked',
      params: clientIdParams,
      response: cloudMcpRevokeResultSchema,
    },
    async (c, input) => {
      const { clientId } = cloudMcpRevokeInputSchema.parse(input.params);
      return c.json(await service.revokeAuthorization(c.get('userId'), clientId));
    },
  );

  return app;
}
