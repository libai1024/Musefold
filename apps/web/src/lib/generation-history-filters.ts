import type { GenerationHistoryQuery, GenerationJob } from '@musefold/contracts';
import { DEFAULT_HISTORY_FILTERS, type HistoryFilters } from '@musefold/domain/history-filters';

export function matchesGenerationHistoryQuery(
  job: GenerationJob,
  query: GenerationHistoryQuery,
): boolean {
  const includeDeleted = query.includeDeleted ?? false;
  const search = query.search?.trim().toLocaleLowerCase();
  const from = query.from ? Date.parse(query.from) : undefined;
  const to = query.to ? Date.parse(query.to) : undefined;
  const createdAt = Date.parse(job.createdAt);
  const haystack = [job.request.prompt, job.request.negative, job.providerModel, job.error?.message]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

  return (
    (includeDeleted || !job.deletedAt) &&
    (!query.sessionId || job.sessionId === query.sessionId) &&
    (!query.status || job.status === query.status) &&
    (from == null || createdAt >= from) &&
    (to == null || createdAt <= to) &&
    (!query.providerModel || job.providerModel === query.providerModel) &&
    (!search || haystack.includes(search))
  );
}

export function isHistoryFilterActive(filters: HistoryFilters, searchQuery: string): boolean {
  return Boolean(
    filters.status ||
      filters.providerId ||
      filters.providerModel ||
      filters.datePreset !== DEFAULT_HISTORY_FILTERS.datePreset ||
      filters.customFrom != null ||
      filters.customTo != null ||
      searchQuery.trim(),
  );
}
