import type {
  DesktopGenerationEntry,
  DesktopRelatedHistoryResult,
} from '@musefold/desktop-contracts/history-documents';
import type {
  HistoryLinkPromptResult,
  RelatedHistoryQuery,
} from '@musefold/desktop-contracts/ipc';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import { desktopGateway } from '../runtime';

const RELATED_HISTORY_DB_VERSION = 9;
const HISTORY_LINK_PROMPT_DB_VERSION = 10;

/** 关联历史只需 extras 的 related / link / list / 版本；测试可注入子集。 */
interface RelatedHistoryExtras {
  relatedHistory?: DesktopExtras['relatedHistory'];
  linkHistoryPrompt?: DesktopExtras['linkHistoryPrompt'];
  listHistory: DesktopExtras['listHistory'];
  getSystemVersion: DesktopExtras['getSystemVersion'];
}

export async function linkHistoriesToPrompt(
  promptId: string,
  historyIds: string[],
  extras: RelatedHistoryExtras = desktopGateway,
): Promise<HistoryLinkPromptResult | null> {
  const uniqueIds = [...new Set(historyIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { linked: 0, alreadyLinked: 0, conflicts: [], missing: [] };
  }
  const version = await extras.getSystemVersion().catch(() => null);
  if ((version?.db ?? 0) < HISTORY_LINK_PROMPT_DB_VERSION || !extras.linkHistoryPrompt) return null;
  try {
    return await extras.linkHistoryPrompt({ promptId, historyIds: uniqueIds });
  } catch (error) {
    if (isMissingRelatedHistoryHandler(error)) return null;
    throw error;
  }
}

export interface RelatedHistoryLoadResult extends DesktopRelatedHistoryResult {
  coverage: 'full' | 'direct-only';
  runtimeDbVersion: number | null;
}

export function isMissingRelatedHistoryHandler(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes("No handler registered for 'db:history:related'") ||
    message.includes("No handler registered for 'db:history:linkPrompt'") ||
    message.includes('history.related is not a function')
  );
}

export function directHistoryFallback(
  records: DesktopGenerationEntry[],
  query: RelatedHistoryQuery,
): DesktopRelatedHistoryResult {
  const matching = records
    .filter((record) => record.promptId === query.promptId)
    .map((record) => ({
      ...record,
      promptRelations: [{ kind: 'source' as const }],
    }));
  const offset = Math.max(query.offset ?? 0, 0);
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  return {
    items: matching.slice(offset, offset + limit),
    total: matching.length,
  };
}

async function loadDirectHistoryFallback(
  query: RelatedHistoryQuery,
  extras: RelatedHistoryExtras,
  runtimeDbVersion: number | null,
): Promise<RelatedHistoryLoadResult> {
  const records = await extras.listHistory({ status: query.status });
  return {
    ...directHistoryFallback(records, query),
    coverage: 'direct-only',
    runtimeDbVersion,
  };
}

export async function loadRelatedHistory(
  query: RelatedHistoryQuery,
  extras: RelatedHistoryExtras = desktopGateway,
): Promise<RelatedHistoryLoadResult> {
  const version = await extras.getSystemVersion().catch(() => null);
  const runtimeDbVersion = version?.db ?? null;

  // 开发时渲染进程可能热更新，而主进程仍停在 DB v8。先别打尚不存在的通道。
  if (runtimeDbVersion != null && runtimeDbVersion < RELATED_HISTORY_DB_VERSION) {
    return loadDirectHistoryFallback(query, extras, runtimeDbVersion);
  }

  try {
    if (!extras.relatedHistory) {
      return loadDirectHistoryFallback(query, extras, runtimeDbVersion);
    }
    return {
      ...(await extras.relatedHistory(query)),
      coverage: 'full',
      runtimeDbVersion,
    };
  } catch (error) {
    if (isMissingRelatedHistoryHandler(error)) {
      return loadDirectHistoryFallback(query, extras, runtimeDbVersion);
    }
    throw new Error('作品索引暂时无法读取，请重试。', { cause: error });
  }
}
