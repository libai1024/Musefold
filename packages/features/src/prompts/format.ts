import type { PromptDocument } from '@musefold/contracts';
import { formatDateTime } from '../history/format';
import { sessionRelativeTime } from '../workbench/SessionListPanel';

/**
 * 行元信息「更新于」的相对时间(刚刚 / n 分钟 / n 小时 / n 天 / M月D日)。
 * 直接复用侧栏 `session-updated-at` 的实现 —— 同一口径只能有一份,不另起平行实现。
 */
export const promptRelativeTime = sessionRelativeTime;

/** 元数据区的绝对时间,与历史屏同格式(今天只显时分,跨年补年份)。 */
export const promptDateTime = formatDateTime;

/** 来源枚举 → 中文(承旧 PromptDetailScreen 的 sourceLabel)。 */
export const PROMPT_SOURCE_LABELS: Record<PromptDocument['source'], string> = {
  manual: '本机创建',
  import: '导入',
  share: '分享导入',
  slip: '笺誊清',
  generation: '生成入库',
};

export function promptSourceLabel(source: PromptDocument['source']): string {
  return PROMPT_SOURCE_LABELS[source];
}
