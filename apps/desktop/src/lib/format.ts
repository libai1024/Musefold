// src/lib/format.ts
// 时间/成本等格式化工具

import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts/billing.js';

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

/** 服务器 quota 原值 → 用户侧「积分」数值（1 积分 = ¥0.1 = 50000 quota）。 */
export function quotaToPoints(quota: number): number {
  return quota / ACCOUNT_QUOTA_PER_POINT;
}

/** 积分展示：最多 2 位小数（一张图约 0.4 积分，四舍五入到整数会看不见变化）。 */
export function formatPoints(quota: number): string {
  return quotaToPoints(quota).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function formatCost(
  value: number | null | undefined,
  _unit: import('@musefold/desktop-contracts/models').CostUnit = 'point',
): string {
  if (value == null) return '—';
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })} 积分`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
