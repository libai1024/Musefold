import type {
  AccountSession,
  LoginRequest,
  McpConnectionPage,
  UpdateMcpConnection,
} from '@musefold/contracts';

/**
 * 账号会话与 MCP 连接。配额摘要在 AccountSession.account 上，无独立方法。
 * updateConnection 的入参对应 WebGateway 的
 * Parameters<MusefoldCloudClient['updateConnection']>[1]
 * （即 contracts 的 UpdateMcpConnection）。
 */
export interface AccountGateway {
  getSession(): Promise<AccountSession>;
  login(input: LoginRequest): Promise<AccountSession>;
  logout(): Promise<void>;
  listConnections(): Promise<McpConnectionPage>;
  updateConnection(
    id: string,
    input: UpdateMcpConnection,
  ): Promise<McpConnectionPage>;
  revokeConnection(id: string): Promise<void>;
}
