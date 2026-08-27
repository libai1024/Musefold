// 设置 · 开放能力页的纯格式化/校验 helper(无 React 依赖,可单测)。
// 供 LocalControlCard(token 遮蔽、预算草稿)与 AutomationAuditList(时间列)共用。

/** token 遮蔽(GitHub 风格收紧):前 4 + … + 后 4;≤8 字符全遮蔽,短 token 不再全量可见。 */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * 预算草稿解析:空串/非法输入返回 null(视为未改动,不把清空输入误写成 0);
 * 负数 clamp 到 0(0 = 逐次确认,是合法预算值)。
 */
export function parseBudgetDraft(draft: string): number | null {
  if (draft.trim() === '') return null;
  const value = Number(draft);
  if (Number.isNaN(value)) return null;
  return Math.max(0, value);
}

const AUDIT_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 审计行时间:补日期分量(MM/dd HH:mm),昨天及更早的记录不再显示成「像是今天的时间」。 */
export function formatAuditTime(timestamp: number): string {
  return AUDIT_TIME_FORMAT.format(new Date(timestamp));
}
