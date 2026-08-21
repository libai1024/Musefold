import { musefoldQueryKeys } from '@musefold/product-ui';
import { desktopQueryClient } from './query-client';

/**
 * Workbench 写完成后的跨域副作用。放在 runtime 而不是 generation feature，
 * 避免 workbench store 直连 account/history feature（SPLIT-03）。
 *
 * `history.load()` 仍是 invalidate 别名；此处直接走同一 Query 前缀。
 * 豆包用量仍由 doubao-store 刷新（尚未进 Query）。
 */
export function notifyWorkbenchHistoryChanged(): void {
  void desktopQueryClient.invalidateQueries({ queryKey: musefoldQueryKeys.history.all });
}

export function notifyWorkbenchDoubaoUsageChanged(): void {
  void import('../features/account/doubao-store')
    .then(({ useDoubaoAccountStore }) =>
      useDoubaoAccountStore.getState().refreshUsage(),
    )
    .catch(() => undefined);
}

export function notifyWorkbenchGenerationSettled(options?: {
  refreshDoubaoUsage?: boolean;
}): void {
  notifyWorkbenchHistoryChanged();
  if (options?.refreshDoubaoUsage) notifyWorkbenchDoubaoUsageChanged();
}
