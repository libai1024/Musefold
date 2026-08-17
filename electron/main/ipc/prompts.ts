// electron/main/ipc/prompts.ts
// 提示词 IPC handler —— 详见 docs/07-ipc-contracts.md §3.1

import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';

export function registerPromptHandlers(): void {
  ipcMain.handle(IPC.PROMPTS_LIST, (_e, q) => promptsRepo.list(q));
  ipcMain.handle(IPC.PROMPTS_GET, (_e, id: string) => promptsRepo.get(id));
  ipcMain.handle(IPC.PROMPTS_CREATE, (_e, p) => promptsRepo.create(p));
  ipcMain.handle(IPC.PROMPTS_UPDATE, (_e, id: string, patch) => promptsRepo.update(id, patch));
  ipcMain.handle(IPC.PROMPTS_DELETE, (_e, id: string) => { promptsRepo.softDelete(id); return { ok: true as const }; });
  ipcMain.handle(IPC.PROMPTS_BATCH_ADD_TAGS, (_e, ids: string[], tagIds: string[]) =>
    promptsRepo.batchAddTags(ids, tagIds)
  );
  ipcMain.handle(IPC.PROMPTS_BATCH_MOVE, (_e, ids: string[], folderId: string | null) =>
    promptsRepo.batchMove(ids, folderId)
  );
  ipcMain.handle(IPC.PROMPTS_BATCH_SET_PIN, (_e, ids: string[], pinned: boolean) =>
    promptsRepo.batchSetPin(ids, pinned)
  );
  ipcMain.handle(IPC.PROMPTS_BATCH_DELETE, (_e, ids: string[]) => promptsRepo.batchDelete(ids));
  ipcMain.handle(IPC.PROMPTS_TOGGLE_PIN, (_e, id: string, pinned: boolean) => promptsRepo.togglePin(id, pinned));
  ipcMain.handle(IPC.PROMPTS_REORDER_PINS, (_e, ids: string[]) => { promptsRepo.reorderPins(ids); return { ok: true as const }; });
  ipcMain.handle(IPC.PROMPTS_INCREMENT_USAGE, (_e, id: string) => { promptsRepo.incrementUsage(id); return { ok: true as const }; });
  // 回收站
  ipcMain.handle(IPC.PROMPTS_LIST_DELETED, () => promptsRepo.listDeleted());
  ipcMain.handle(IPC.PROMPTS_RESTORE, (_e, id: string) => promptsRepo.restore(id));
  ipcMain.handle(IPC.PROMPTS_PURGE, (_e, id: string) => { promptsRepo.purge(id); return { ok: true as const }; });
  ipcMain.handle(IPC.PROMPTS_PURGE_ALL, () => ({ purged: promptsRepo.purgeAllDeleted() }));
  // 侧栏计数
  ipcMain.handle(IPC.PROMPTS_STATS, () => promptsRepo.stats());
}
