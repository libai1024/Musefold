import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { PromptGateway } from "@musefold/domain";
import {
  LIBRARY_PAGE_SEARCH_DEBOUNCE_MS,
  asPagedItems,
  dropListCache,
  itemsFromQueryData,
  libraryPageListKey,
  upsertListCache,
} from "./paged-items";
import { musefoldQueryKeys } from "./query-client";
import { requirePageControllerDeps, type LibraryPageControllerDeps } from "./types";

export type { LibraryPageControllerDeps };

type PromptDocument = Awaited<ReturnType<PromptGateway["getPrompt"]>>;
type NewPromptDocument = Parameters<PromptGateway["createPrompt"]>[0];
type UpdatePromptDocument = Parameters<PromptGateway["updatePrompt"]>[1];

export interface LibraryPageController<TItem extends { id: string } = PromptDocument> {
  items: TItem[];
  nextCursor: string | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  refetch: () => Promise<unknown>;
  query: string;
  setQuery: (query: string) => void;
  selectedId: string | null;
  selected: TItem | null;
  select: (id: string | null) => void;
  create: (input: NewPromptDocument) => Promise<PromptDocument>;
  get: (id: string) => Promise<PromptDocument>;
  update: (id: string, input: UpdatePromptDocument) => Promise<PromptDocument>;
  remove: (id: string, expectedVersion: number) => Promise<PromptDocument>;
  restore: (id: string, expectedVersion: number) => Promise<PromptDocument>;
  listTrash: () => Promise<PromptDocument[]>;
  copyText: (text: string) => Promise<void>;
}

type LibraryListResult<TItem> = TItem[] | { items: TItem[]; nextCursor?: string | null };

export function useLibraryPageController<TItem extends { id: string } = PromptDocument>(
  deps: LibraryPageControllerDeps & {
    listFn?: () => Promise<LibraryListResult<TItem>>;
  },
): LibraryPageController<TItem> {
  const wired = requirePageControllerDeps(deps, "useLibraryPageController");
  const queryClient = useQueryClient();
  const [internalQuery, setInternalQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = wired.query ?? internalQuery;
  const setQuery = wired.onQueryChange ?? setInternalQuery;
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const delay = wired.searchDebounceMs ?? LIBRARY_PAGE_SEARCH_DEBOUNCE_MS;
    const handle = window.setTimeout(() => setDebouncedQuery(query), delay);
    return () => window.clearTimeout(handle);
  }, [query, wired.searchDebounceMs]);

  const listKey = wired.listKey ?? libraryPageListKey(debouncedQuery);
  const queryKey = musefoldQueryKeys.library.list(listKey);

  const result = useQuery<unknown, Error>({
    queryKey,
    queryFn: () =>
      wired.listFn
        ? wired.listFn()
        : wired.prompts.listPrompts(libraryPageListKey(debouncedQuery)),
    placeholderData: keepPreviousData,
    enabled: wired.listEnabled ?? true,
  });

  const page = asPagedItems<TItem>(result.data);
  const items = itemsFromQueryData<TItem>(result.data);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: musefoldQueryKeys.library.all }),
    [queryClient],
  );

  const patchItem = useCallback(
    (item: { id: string }) => {
      queryClient.setQueryData(queryKey, (current) => upsertListCache(current, item));
    },
    [queryClient, queryKey],
  );

  const create = useCallback(
    async (input: NewPromptDocument) => {
      const created = await wired.prompts.createPrompt(input);
      patchItem(created);
      setSelectedId(created.id);
      await invalidate();
      return created;
    },
    [invalidate, patchItem, wired.prompts],
  );

  const get = useCallback(
    async (id: string) => {
      const latest = await wired.prompts.getPrompt(id);
      patchItem(latest);
      return latest;
    },
    [patchItem, wired.prompts],
  );

  const update = useCallback(
    async (id: string, input: UpdatePromptDocument) => {
      const next = await wired.prompts.updatePrompt(id, input);
      patchItem(next);
      await invalidate();
      return next;
    },
    [invalidate, patchItem, wired.prompts],
  );

  const remove = useCallback(
    async (id: string, expectedVersion: number) => {
      const deleted = await wired.prompts.deletePrompt(id, expectedVersion);
      queryClient.setQueryData(queryKey, (current) => dropListCache(current, id));
      setSelectedId((current) => (current === id ? null : current));
      void invalidate();
      return deleted;
    },
    [invalidate, queryClient, queryKey, wired.prompts],
  );

  const restore = useCallback(
    async (id: string, expectedVersion: number) => {
      const restored = await wired.prompts.restorePrompt(id, expectedVersion);
      patchItem(restored);
      await invalidate();
      return restored;
    },
    [invalidate, patchItem, wired.prompts],
  );

  const listTrash = useCallback(async () => {
    const trashPage = await wired.prompts.listPrompts({
      includeDeleted: true,
      limit: 100,
      sort: "updated-desc",
    });
    return trashPage.items.filter((item) => Boolean(item.deletedAt));
  }, [wired.prompts]);

  const copyText = useCallback(
    (text: string) => wired.platform.writeClipboard(text),
    [wired.platform],
  );

  return {
    items,
    nextCursor: page.nextCursor,
    loading: result.isFetching,
    initialized: result.isFetched,
    error: result.error instanceof Error ? result.error.message : result.error ? "加载提示词失败" : null,
    refetch: result.refetch,
    query,
    setQuery,
    selectedId,
    selected,
    select: setSelectedId,
    create,
    get,
    update,
    remove,
    restore,
    listTrash,
    copyText,
  };
}
