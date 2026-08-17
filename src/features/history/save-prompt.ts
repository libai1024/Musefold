// History -> Prompt 入库映射（TASK-HIS-07）
// 详见 docs/product/13-history-deep-dive.md §4.3 / TASK-HIS-07

import type { HistoryRecord, NewPrompt } from '@shared/types/models';

const FALLBACK_TITLE_PREFIX = '生成历史';

export function defaultHistoryPromptTitle(
  record: Pick<HistoryRecord, 'id' | 'promptText'>
): string {
  const compact = record.promptText.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, 20) : `${FALLBACK_TITLE_PREFIX} ${record.id.slice(0, 8)}`;
}

export function historyRecordToPromptInput(
  record: HistoryRecord,
  title?: string
): NewPrompt {
  return {
    title: title?.trim() || defaultHistoryPromptTitle(record),
    content: record.promptText,
    contentNegative: record.negativeText ?? undefined,
    params: record.params ?? undefined,
    source: 'import',
    sourceUrl: `history://${record.id}`,
  };
}
