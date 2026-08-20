// electron/main/ipc/smartSets.ts
// 智能集合 + 搜索历史 IPC（TASK-DIF-06）

import { ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type { NewSmartSet } from '@musefold/desktop-contracts/models';
import type { UpdateSmartSetPatch } from '@musefold/desktop-contracts/ipc';
import { smartSetsRepo, searchHistoryRepo } from '@musefold/core/db/repositories/smartSets';

export function registerSmartSetHandlers(): void {
  ipcMain.handle(IPC.SMART_SETS_LIST, () => smartSetsRepo.list());
  ipcMain.handle(IPC.SMART_SETS_CREATE, (_e, input: NewSmartSet) => smartSetsRepo.create(input));
  ipcMain.handle(IPC.SMART_SETS_UPDATE, (_e, id: string, patch: UpdateSmartSetPatch) =>
    smartSetsRepo.update(id, patch)
  );
  ipcMain.handle(IPC.SMART_SETS_DELETE, (_e, id: string) => {
    smartSetsRepo.delete(id);
    return { ok: true as const };
  });

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
