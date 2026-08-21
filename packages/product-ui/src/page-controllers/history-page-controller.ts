import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { HistoryGateway } from "@musefold/domain";
import { useHistoryInspectorController } from "../history/useHistoryInspectorController";
import {
  DEFAULT_HISTORY_PAGE_LIST_KEY,
  asPagedItems,
  dropListCache,
  itemsFromQueryData,
  upsertListCache,
} from "./paged-items";
import { musefoldQueryKeys } from "./query-client";
import { requirePageControllerDeps, type HistoryPageControllerDeps } from "./types";

export type { HistoryPageControllerDeps };

type HistoryJob = Awaited<
  ReturnType<HistoryGateway["listGenerationHistory"]>
>["items"][number];

export interface HistoryPageController<TItem extends { id: string } = HistoryJob> {
  items: TItem[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<unknown>;
  inspector: ReturnType<typeof useHistoryInspectorController>;
  selectedId: string | null;
  selected: TItem | null;
  select: (id: string | null) => void;
  remove: (id: string) => Promise<HistoryJob>;
  restore: (id: string) => Promise<HistoryJob>;
  listTrash: () => Promise<HistoryJob[]>;
  get: (id: string) => Promise<HistoryJob>;
  retry: (id: string, idempotencyKey: string) => Promise<HistoryJob>;
  cancel: (id: string) => Promise<HistoryJob>;
  upsertItem: (item: { id: string }) => void;
  dropItem: (id: string) => void;
  copyText: (text: string) => Promise<void>;
}

type HistoryListResult<TItem> = TItem[] | { items: TItem[]; nextCursor?: string | null };

export function useHistoryPageController<TItem extends { id: string } = HistoryJob>(
  deps: HistoryPageControllerDeps & {
    listFn?: () => Promise<HistoryListResult<TItem>>;
  },
): HistoryPageController<TItem> {
  const wired = requirePageControllerDeps(deps, "useHistoryPageController");
  const queryClient = useQueryClient();
  const inspector = useHistoryInspectorController();
  const listKey = wired.listKey ?? DEFAULT_HISTORY_PAGE_LIST_KEY;
  const queryKey = musefoldQueryKeys.history.list(listKey);

  const result = useQuery<unknown, Error>({
    queryKey,
    queryFn: () =>
      wired.listFn
        ? wired.listFn()
        : wired.history.listGenerationHistory({ ...DEFAULT_HISTORY_PAGE_LIST_KEY }),
    placeholderData: keepPreviousData,
    enabled: wired.listEnabled ?? true,
  });

  const page = asPagedItems<TItem>(result.data);
  const items = itemsFromQueryData<TItem>(result.data);
  const selected =
    items.find((item) => item.id === inspector.selectedId) ?? null;

  const upsertItem = useCallback(
    (item: { id: string }) => {
      queryClient.setQueryData(queryKey, (current) => upsertListCache(current, item));
    },
    [queryClient, queryKey],
  );

  const dropItem = useCallback(
    (id: string) => {
      queryClient.setQueryData(queryKey, (current) => dropListCache(current, id));
    },
    [queryClient, queryKey],
  );

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: musefoldQueryKeys.history.all }),
    [queryClient],
  );

  const remove = useCallback(
    async (id: string) => {
      const deleted = await wired.history.deleteGeneration(id);
      dropItem(id);
      if (inspector.selectedId === id) inspector.select(null);
      void invalidate();
      return deleted;
    },
    [dropItem, inspector, invalidate, wired.history],
  );

  const restore = useCallback(
    async (id: string) => {
      const restored = await wired.history.restoreGeneration(id);
      upsertItem(restored);
      await invalidate();
      return restored;
    },
    [invalidate, upsertItem, wired.history],
  );

  const listTrash = useCallback(async () => {
    const trashPage = await wired.history.listGenerationHistory({
      includeDeleted: true,
      limit: 100,
    });
    return trashPage.items.filter((item) => Boolean(item.deletedAt));
  }, [wired.history]);

  const get = useCallback(
    async (id: string) => {
      if (!wired.generation) {
        throw new Error("useHistoryPageController.get requires generation deps");
      }
      return wired.generation.getGeneration(id);
    },
    [wired.generation],
  );

  const retry = useCallback(
    async (id: string, idempotencyKey: string) => {
      if (!wired.generation) {
        throw new Error("useHistoryPageController.retry requires generation deps");
      }
      const next = await wired.generation.retryGeneration(id, idempotencyKey);
      upsertItem(next);
      await invalidate();
      return next;
    },
    [invalidate, upsertItem, wired.generation],
  );

  const cancel = useCallback(
    async (id: string) => {
      if (!wired.generation) {
        throw new Error("useHistoryPageController.cancel requires generation deps");
      }
      const next = await wired.generation.cancelGeneration(id);
      upsertItem(next);
      await invalidate();
      return next;
    },
    [invalidate, upsertItem, wired.generation],
  );

  const copyText = useCallback(
    (text: string) => wired.platform.writeClipboard(text),
    [wired.platform],
  );

  return {
    items,
    nextCursor: page.nextCursor,
    loading: result.isFetching,
    error: result.error instanceof Error ? result.error.message : result.error ? "加载历史失败" : null,
    refetch: result.refetch,
    inspector,
    selectedId: inspector.selectedId,
    selected,
    select: inspector.select,
    remove,
    restore,
    listTrash,
    get,
    retry,
    cancel,
    upsertItem,
    dropItem,
    copyText,
  };
}
