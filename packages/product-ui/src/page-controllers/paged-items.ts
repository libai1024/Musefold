/**
 * 列表 Query 缓存形状：Web HistoryGateway 返回 `{ items, nextCursor }`，
 * 桌面 extras（listHistory / listLibraryPrompts）返回裸数组。
 * 编排 hook 与宿主 setQueryData 必须按实际缓存形状读写，不能把 page
 * 写进桌面数组 key（STATE-02 `cachedHistoryRecords` 按数组合并）。
 */

export type PagedItems<TItem> = {
  items: TItem[];
  nextCursor: string | null;
};

export const DEFAULT_HISTORY_PAGE_LIST_KEY = { limit: 20 } as const;

export const DEFAULT_LIBRARY_PAGE_LIST_KEY = {
  limit: 20,
  sort: "updated-desc",
} as const;

export const LIBRARY_PAGE_SEARCH_DEBOUNCE_MS = 220;

export function libraryPageListKey(query: string): {
  limit: 20;
  sort: "updated-desc";
  q?: string;
} {
  const q = query.trim();
  return q
    ? { limit: 20, sort: "updated-desc", q }
    : { limit: 20, sort: "updated-desc" };
}

export function asPagedItems<TItem extends { id: string }>(
  current: unknown,
): PagedItems<TItem> {
  if (!current) return { items: [], nextCursor: null };
  if (Array.isArray(current)) {
    return { items: current as TItem[], nextCursor: null };
  }
  if (typeof current === "object" && current !== null && "items" in current) {
    const page = current as { items?: TItem[]; nextCursor?: string | null };
    return {
      items: page.items ?? [],
      nextCursor: page.nextCursor ?? null,
    };
  }
  return { items: [], nextCursor: null };
}

export function itemsFromQueryData<TItem extends { id: string }>(
  current: unknown,
): TItem[] {
  return asPagedItems<TItem>(current).items;
}

export function upsertPagedItem<TItem extends { id: string }>(
  page: PagedItems<TItem>,
  item: TItem,
): PagedItems<TItem> {
  return {
    items: [item, ...page.items.filter((entry) => entry.id !== item.id)],
    nextCursor: page.nextCursor,
  };
}

export function dropPagedItem<TItem extends { id: string }>(
  page: PagedItems<TItem>,
  id: string,
): PagedItems<TItem> {
  return {
    items: page.items.filter((entry) => entry.id !== id),
    nextCursor: page.nextCursor,
  };
}

export function upsertListCache<TItem extends { id: string }>(
  current: unknown,
  item: TItem,
): unknown {
  if (Array.isArray(current)) {
    return [item, ...(current as TItem[]).filter((entry) => entry.id !== item.id)];
  }
  return upsertPagedItem(asPagedItems<TItem>(current), item);
}

export function dropListCache<TItem extends { id: string }>(
  current: unknown,
  id: string,
): unknown {
  if (Array.isArray(current)) {
    return (current as TItem[]).filter((entry) => entry.id !== id);
  }
  return dropPagedItem(asPagedItems<TItem>(current), id);
}
