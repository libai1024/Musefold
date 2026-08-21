// History -> Prompt 入库映射（TASK-HIS-07）
// 详见 docs/product/13-history-deep-dive.md §4.3 / TASK-HIS-07

import type { NewPrompt } from '@musefold/desktop-contracts/desktop-extras';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';

const FALLBACK_TITLE_PREFIX = '生成历史';

export function defaultHistoryPromptTitle(
  record: Pick<DesktopGenerationEntry, 'id' | 'request'>,
): string {
  const compact = record.request.prompt.trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, 20) : `${FALLBACK_TITLE_PREFIX} ${record.id.slice(0, 8)}`;
}

export function historyRecordToPromptInput(
  record: DesktopGenerationEntry,
  title?: string
): NewPrompt {
  return {
    title: title?.trim() || defaultHistoryPromptTitle(record),
    content: record.request.prompt,
    contentNegative: record.request.negative ?? undefined,
    params: record.params ?? undefined,
    source: 'import',
    sourceUrl: `history://${record.id}`,
  };
}
