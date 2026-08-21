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
 * 细粒度 key 在 STATE-02 读路径落地时扩展，前缀保持稳定。
 */
export const musefoldQueryKeys = {
  history: { all: ["history"] as const },
  library: { all: ["library"] as const },
  account: { all: ["account"] as const },
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
