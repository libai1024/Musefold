// electron/main/ipc/smartSets.ts
// 搜索历史 IPC（TASK-DIF-06）。智能集合通道已随 UI 退役删除；
// 导入导出与旧备份仍直写 smart_sets 表，不经本文件。

import { ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { searchHistoryRepo } from '@musefold/core/db/repositories/smartSets';

export function registerSmartSetHandlers(): void {
  ipcMain.handle(IPC.SEARCH_HISTORY_LIST, (_e, limit?: number) => searchHistoryRepo.list(limit));
  ipcMain.handle(IPC.SEARCH_HISTORY_ADD, (_e, term: string) => {
    searchHistoryRepo.add(term);
    return { ok: true as const };
  });
  ipcMain.handle(IPC.SEARCH_HISTORY_CLEAR, () => {
    searchHistoryRepo.clear();
    return { ok: true as const };
  });
}
