// src/lib/format.ts
// 时间/成本等格式化工具（积分换算见 `@musefold/domain` 的 formatPoints）

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function formatCost(
  value: number | null | undefined,
  _unit: import('@musefold/desktop-contracts/generation-snapshots').CostUnit = 'point',
): string {
  if (value == null) return '—';
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })} 积分`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
