import type { AccountHealth } from "@musefold/desktop-contracts/account";
import type { CloudSyncSummary } from "@musefold/desktop-contracts/cloud-sync";
import { formatPoints } from "@musefold/domain";

export type AuthMode = "login" | "register";
export const NOTICE_READ_KEY = "musefold:account-notices-read";

export function initialReadNotices(): string[] {
  try {
    const value = localStorage.getItem(NOTICE_READ_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function points(value: number): string {
  return `${formatPoints(Math.max(0, value))} 积分`;
}

export function healthLabel(health: AccountHealth): string {
  if (health === "ok") return "在线";
  if (health === "token-invalid") return "登录已失效";
  if (health === "unreachable") return "暂时离线";
  return "待确认";
}

export function cloudSyncLabel(summary: CloudSyncSummary | null): string {
  if (!summary) return "读取中";
  if (!summary.available)
    return summary.unavailableReason === "custom-server"
      ? "自定义服务器不可用"
      : "未登录";
  if (summary.status === "syncing") return "同步中";
  if (summary.status === "conflict") return `${summary.conflicts} 个冲突`;
  if (summary.status === "error") return "同步失败";
  if (summary.pendingMutations > 0)
    return `${summary.pendingMutations} 项等待同步`;
  if (!summary.account?.enabled) return "已关闭";
  if (summary.account?.lastSyncAt)
    return `上次同步 ${new Date(summary.account.lastSyncAt).toLocaleString("zh-CN")}`;
  return "尚未同步";
}
