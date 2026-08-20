// packages/desktop-contracts/src/ipc/account.ts
// account / cloudSync / cloudConnections 域：Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type {
  AccountCredentialsInput,
  AccountRedeemResult,
  AccountStatus,
} from "../account";
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from "../cloud-sync";
import type { McpConnectionPage, UpdateMcpConnection } from "@musefold/contracts";

export interface AccountApi {
  status: () => Promise<AccountStatus>;
  /** 注册成功即登录（US-01），返回登录后的完整状态 */
  register: (input: AccountCredentialsInput) => Promise<AccountStatus>;
  login: (input: AccountCredentialsInput) => Promise<AccountStatus>;
  logout: () => Promise<AccountStatus>;
  redeem: (code: string) => Promise<AccountRedeemResult>;
  refreshQuota: () => Promise<AccountStatus>;
  /** 要求未登录态；已登录调用抛 ACCOUNT/MANAGED_READONLY */
  setServerUrl: (url: string) => Promise<AccountStatus>;
  /** 订阅账号状态变化（登录/登出/额度/健康度/公告），返回取消订阅函数 */
  onChanged: (cb: (status: AccountStatus) => void) => () => void;
}

export interface CloudSyncApi {
  status: () => Promise<CloudSyncSummary>;
  setEnabled: (enabled: boolean) => Promise<CloudSyncSummary>;
  syncNow: () => Promise<CloudSyncSummary>;
  conflicts: () => Promise<CloudSyncConflictSummary[]>;
  resolve: (
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ) => Promise<CloudSyncSummary>;
  onChanged: (cb: (status: CloudSyncSummary) => void) => () => void;
}

export interface CloudConnectionsApi {
  list: () => Promise<McpConnectionPage>;
  update: (id: string, input: UpdateMcpConnection) => Promise<McpConnectionPage>;
  revoke: (id: string) => Promise<void>;
}
