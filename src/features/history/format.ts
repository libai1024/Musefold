// src/features/history/format.ts
// 历史详情展示格式化 —— 纯逻辑可单测（TASK-HIS-03）

import type { PromptParams } from '@shared/types/models';
import { formatCost } from '../../lib/format';

/** 历史账本中的成本文案；成功但 cost=null 表示该 Provider 未配置单价。 */
export function formatHistoryCost(
  cost: number | null | undefined,
  unit: import('@shared/types/models').CostUnit = 'point',
): string {
  return cost == null ? '未配单价' : formatCost(cost, unit);
}

/** 把 PromptParams 收成一行可读摘要 */
export function formatParamsSummary(params: PromptParams | null | undefined): string {
  if (!params) return '—';
  const parts: string[] = [];
  if (params.size) parts.push(String(params.size));
  if (params.quality) parts.push(String(params.quality));
  if (params.n != null) parts.push(`n=${params.n}`);
  if (params.background) parts.push(`bg=${params.background}`);
  if (params.moderation) parts.push(`mod=${params.moderation}`);
  if (params.steps != null) parts.push(`steps=${params.steps}`);
  if (params.cfg != null) parts.push(`cfg=${params.cfg}`);
  if (params.sampler) parts.push(String(params.sampler));
  if (params.seed != null) parts.push(`seed=${params.seed}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** 来源行文案 */
export function formatSourceLabel(opts: {
  promptTitle?: string | null;
  promptId?: string | null;
}): string {
  if (opts.promptTitle) return `库「${opts.promptTitle}」`;
  if (opts.promptId) return '库（原条目已删除）';
  return '—';
}
