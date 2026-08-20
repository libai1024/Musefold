import type { HistoryRecord } from '@shared/types/models';
import type {
  HistoryLinkPromptResult,
  RelatedHistoryQuery,
  RelatedHistoryResult,
} from '@shared/types/ipc';
import api from '../../lib/ipc';

const RELATED_HISTORY_DB_VERSION = 9;
const HISTORY_LINK_PROMPT_DB_VERSION = 10;

interface RelatedHistoryClient {
  history: {
    list: typeof api.history.list;
    related?: typeof api.history.related;
    linkPrompt?: typeof api.history.linkPrompt;
  };
  system: {
    getVersion: typeof api.system.getVersion;
  };
}

export async function linkHistoriesToPrompt(
  promptId: string,
  historyIds: string[],
  client: RelatedHistoryClient = api,
): Promise<HistoryLinkPromptResult | null> {
  const uniqueIds = [...new Set(historyIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { linked: 0, alreadyLinked: 0, conflicts: [], missing: [] };
  }
  const version = await client.system.getVersion().catch(() => null);
  if ((version?.db ?? 0) < HISTORY_LINK_PROMPT_DB_VERSION || !client.history.linkPrompt) return null;
  try {
    return await client.history.linkPrompt({ promptId, historyIds: uniqueIds });
  } catch (error) {
    if (isMissingRelatedHistoryHandler(error)) return null;
    throw error;
  }
}

export interface RelatedHistoryLoadResult extends RelatedHistoryResult {
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
  records: HistoryRecord[],
  query: RelatedHistoryQuery,
): RelatedHistoryResult {
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
  client: RelatedHistoryClient,
  runtimeDbVersion: number | null,
): Promise<RelatedHistoryLoadResult> {
  const records = await client.history.list({ status: query.status });
  return {
    ...directHistoryFallback(records, query),
    coverage: 'direct-only',
    runtimeDbVersion,
  };
}

export async function loadRelatedHistory(
  query: RelatedHistoryQuery,
  client: RelatedHistoryClient = api,
): Promise<RelatedHistoryLoadResult> {
  const version = await client.system.getVersion().catch(() => null);
  const runtimeDbVersion = version?.db ?? null;

  // During development the renderer can hot-reload while Electron's main
  // process remains on DB v8. Avoid invoking a channel that cannot exist yet.
  if (runtimeDbVersion != null && runtimeDbVersion < RELATED_HISTORY_DB_VERSION) {
    return loadDirectHistoryFallback(query, client, runtimeDbVersion);
  }

  try {
    if (!client.history.related) {
      return loadDirectHistoryFallback(query, client, runtimeDbVersion);
    }
    return {
      ...(await client.history.related(query)),
      coverage: 'full',
      runtimeDbVersion,
    };
  } catch (error) {
    if (isMissingRelatedHistoryHandler(error)) {
      return loadDirectHistoryFallback(query, client, runtimeDbVersion);
    }
    throw new Error('作品索引暂时无法读取，请重试。', { cause: error });
  }
}
