import { QueryClient } from "@tanstack/react-query";

/**
 * 双端 Query 配置单点（V13-STATE-01）。
 *
 * 宿主各自 `createMusefoldQueryClient()` 后经 QueryClientProvider 注入；
 * 编排 hook 不感知桌面 / Web。默认偏保守，避免窗口焦点把 IPC/HTTP 打成风暴，
 * 也避免失败查询默认连重试 3 次拖长 E2E。
 */
export const MUSEFOLD_QUERY_STALE_TIME_MS = 30_000;
export const MUSEFOLD_QUERY_GC_TIME_MS = 5 * 60_000;
export const MUSEFOLD_QUERY_RETRY = 1;

/**
 * 写操作失效约定：按域 `invalidateQueries({ queryKey: musefoldQueryKeys.history.all })`。
 * 列表/统计用稳定前缀，便于精确失效。
 */
export const musefoldQueryKeys = {
  history: {
    all: ["history"] as const,
    lists: ["history", "list"] as const,
    list: (query: unknown) => ["history", "list", query] as const,
    stats: (query: unknown) => ["history", "stats", query] as const,
  },
  library: {
    all: ["library"] as const,
    lists: ["library", "list"] as const,
    list: (query: unknown) => ["library", "list", query] as const,
    stats: ["library", "stats"] as const,
    deleted: ["library", "deleted"] as const,
    searchHistory: ["library", "search-history"] as const,
  },
  account: {
    all: ["account"] as const,
    status: ["account", "status"] as const,
  },
};

export function createMusefoldQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: MUSEFOLD_QUERY_STALE_TIME_MS,
        gcTime: MUSEFOLD_QUERY_GC_TIME_MS,
        retry: MUSEFOLD_QUERY_RETRY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
