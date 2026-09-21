/** 指标数字:千分位;成功率一位小数百分比;无数据「—」,不伪造 0。 */
export function formatUsageCount(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function formatUsageRate(rate: number | null): string {
  if (rate == null) return '—';
  return `${(rate * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
}

export function formatUsageCost(points: number | null): string {
  if (points == null) return '—';
  return points.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
