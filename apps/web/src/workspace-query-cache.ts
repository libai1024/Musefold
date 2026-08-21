import type { QueryClient } from '@tanstack/react-query';
import type { GenerationHistoryPage, GenerationJob, PromptDocument, PromptPage } from '@musefold/contracts';
import {
  DEFAULT_HISTORY_PAGE_LIST_KEY,
  DEFAULT_LIBRARY_PAGE_LIST_KEY,
  dropListCache,
  musefoldQueryKeys,
  upsertListCache,
} from '@musefold/product-ui';

export const WEB_HISTORY_LIST_KEY = DEFAULT_HISTORY_PAGE_LIST_KEY;
export const WEB_LIBRARY_LIST_KEY = DEFAULT_LIBRARY_PAGE_LIST_KEY;

export function hydrateWorkspaceLists(
  client: QueryClient,
  prompts: PromptPage,
  history: GenerationHistoryPage,
): void {
  client.setQueryData(musefoldQueryKeys.library.list(WEB_LIBRARY_LIST_KEY), prompts);
  client.setQueryData(musefoldQueryKeys.history.list(WEB_HISTORY_LIST_KEY), history);
}

export function patchHistoryJob(client: QueryClient, job: GenerationJob): void {
  client.setQueryData(musefoldQueryKeys.history.list(WEB_HISTORY_LIST_KEY), (current) =>
    upsertListCache(current, job),
  );
}

export function dropHistoryJob(client: QueryClient, id: string): void {
  client.setQueryData(musefoldQueryKeys.history.list(WEB_HISTORY_LIST_KEY), (current) =>
    dropListCache(current, id),
  );
}

export function patchLibraryPrompt(client: QueryClient, prompt: PromptDocument): void {
  client.setQueryData(musefoldQueryKeys.library.list(WEB_LIBRARY_LIST_KEY), (current) =>
    upsertListCache(current, prompt),
  );
}
