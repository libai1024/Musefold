// v2.5 桌面 Cloud MCP 已连接应用域:列出/撤销走官方云 API,凭据与账号域同一套。
// 自定义账号服务器(MUSEFOLD_API_URL ≠ 官方基址)不转发,抛稳定码供 UI 显示「暂不支持」。
// 出参 secret-free / path-free:契约层挡住 token/secret,错误文案不含本机路径。

import {
  CLOUD_MCP_CUSTOM_SERVER_CODE,
  cloudMcpAuthorizationListSchema,
  cloudMcpRevokeInputSchema,
  cloudMcpRevokeResultSchema,
  isOfficialCloudApiBase,
} from '@musefold/contracts';
import { z } from 'zod';
import { apiBase, readSessionToken } from './account-domain';
import { BridgeError, type MethodDef } from './envelope';

export interface CloudMcpDomainDeps {
  apiBase(): string;
  readSessionToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
}

async function extractError(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string }; code?: string; message?: string }
    | undefined;
  const code = body?.error?.code ?? body?.code;
  const message = body?.error?.message ?? body?.message;
  return {
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message: typeof message === 'string' ? message : `云服务请求失败(HTTP ${response.status})`,
  };
}

export function buildCloudMcpDomainMethods(
  deps: CloudMcpDomainDeps = { apiBase, readSessionToken },
): Record<string, MethodDef> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function cloudFetch(path: string, method: 'GET' | 'DELETE', token: string) {
    try {
      return await fetchImpl(`${deps.apiBase()}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new BridgeError('ACCOUNT_SERVICE_UNAVAILABLE', '无法连接 Musefold 云服务,请检查网络');
    }
  }

  async function requireOfficialSession(): Promise<string> {
    if (!isOfficialCloudApiBase(deps.apiBase())) {
      throw new BridgeError(
        CLOUD_MCP_CUSTOM_SERVER_CODE,
        '自定义账号服务器暂不支持 Cloud MCP 连接管理',
      );
    }
    const token = await deps.readSessionToken();
    if (!token) throw new BridgeError('AUTH_REQUIRED', '桌面端尚未登录');
    return token;
  }

  async function parseOk<T>(response: Response, parse: (body: unknown) => T): Promise<T> {
    if (response.status === 401) {
      throw new BridgeError('AUTH_REQUIRED', '登录状态已失效,请重新登录');
    }
    if (!response.ok) {
      const { code, message } = await extractError(response);
      throw new BridgeError(code, message);
    }
    return parse(await response.json());
  }

  return {
    'cloudMcp.listAuthorizations': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const token = await requireOfficialSession();
        const response = await cloudFetch('/api/v1/mcp/authorizations', 'GET', token);
        return parseOk(response, (body) => cloudMcpAuthorizationListSchema.parse(body));
      },
    },
    'cloudMcp.revokeAuthorization': {
      input: cloudMcpRevokeInputSchema,
      handle: async (input) => {
        const { clientId } = input as { clientId: string };
        const token = await requireOfficialSession();
        const response = await cloudFetch(
          `/api/v1/mcp/authorizations/${encodeURIComponent(clientId)}`,
          'DELETE',
          token,
        );
        return parseOk(response, (body) => cloudMcpRevokeResultSchema.parse(body));
      },
    },
  };
}
