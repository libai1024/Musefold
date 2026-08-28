import {
  generationHistoryQuerySchema,
  type GenerationHistoryQuery,
} from '@musefold/contracts';

export function serializeGenerationHistoryQuery(
  query: GenerationHistoryQuery,
): string {
  const parsed = generationHistoryQuerySchema.parse(query);
  const search = new URLSearchParams({
    limit: String(parsed.limit),
    includeDeleted: String(parsed.includeDeleted),
  });
  if (parsed.cursor) search.set('cursor', parsed.cursor);
  if (parsed.sessionId) search.set('sessionId', parsed.sessionId);
  if (parsed.status) search.set('status', parsed.status);
  if (parsed.from) search.set('from', parsed.from);
  if (parsed.to) search.set('to', parsed.to);
  if (parsed.providerModel) search.set('providerModel', parsed.providerModel);
  if (parsed.search) search.set('search', parsed.search);
  return search.toString();
}
