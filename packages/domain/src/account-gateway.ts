import type {
  AccountSummary,
  LoginRequest,
  McpConnectionPage,
  RedeemResult,
  RegisterRequest,
  UpdateMcpConnection,
} from '@musefold/contracts';

/**
 * UI 可见的账号摘要与 MCP 连接。HTTP 会话和 CSRF 由 transport adapter 管理，
 * 不进入平台无关端口。
 * updateConnection 的入参对应 WebGateway 的
 * Parameters<MusefoldCloudClient['updateConnection']>[1]
 * （即 contracts 的 UpdateMcpConnection）。
 */
export interface AccountGateway {
  getAccount(): Promise<AccountSummary>;
  login(input: LoginRequest): Promise<AccountSummary>;
  register(input: RegisterRequest): Promise<AccountSummary>;
  redeem(code: string): Promise<RedeemResult>;
  logout(): Promise<void>;
  listConnections(): Promise<McpConnectionPage>;
  updateConnection(
    id: string,
    input: UpdateMcpConnection,
  ): Promise<McpConnectionPage>;
  revokeConnection(id: string): Promise<void>;
}
