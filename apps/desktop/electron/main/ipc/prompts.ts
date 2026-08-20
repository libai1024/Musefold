// electron/main/ipc/prompts.ts
// 提示词 IPC handler —— 详见 docs/07-ipc-contracts.md §3.1

import { ipcMain } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import { promptsRepo } from "@musefold/core/db/repositories/prompts";
import { scheduleCloudSync } from "../../cloud-sync";

export function registerPromptHandlers(): void {
  ipcMain.handle(IPC.PROMPTS_LIST, (_e, q) => promptsRepo.list(q));
  ipcMain.handle(IPC.PROMPTS_GET, (_e, id: string) => promptsRepo.get(id));
  ipcMain.handle(IPC.PROMPTS_CREATE, (_e, p) => {
    const value = promptsRepo.create(p);
    scheduleCloudSync();
    return value;
  });
  ipcMain.handle(IPC.PROMPTS_UPDATE, (_e, id: string, patch) => {
    const value = promptsRepo.update(id, patch);
    scheduleCloudSync();
    return value;
  });
  ipcMain.handle(IPC.PROMPTS_DELETE, (_e, id: string) => {
    promptsRepo.softDelete(id);
    scheduleCloudSync();
    return { ok: true as const };
  });
  ipcMain.handle(IPC.PROMPTS_TOGGLE_PIN, (_e, id: string, pinned: boolean) => {
    const value = promptsRepo.togglePin(id, pinned);
    scheduleCloudSync();
    return value;
  });
  ipcMain.handle(IPC.PROMPTS_REORDER_PINS, (_e, ids: string[]) => {
    promptsRepo.reorderPins(ids);
    scheduleCloudSync();
    return { ok: true as const };
  });
  ipcMain.handle(
    IPC.PROMPTS_INCREMENT_USAGE,
    (_e, id: string, action?: "copy" | "apply" | "generate") => {
      promptsRepo.incrementUsage(id, action ?? "apply");
      scheduleCloudSync();
      return { ok: true as const };
    },
  );
  // 回收站
  ipcMain.handle(IPC.PROMPTS_LIST_DELETED, () => promptsRepo.listDeleted());
  ipcMain.handle(IPC.PROMPTS_RESTORE, (_e, id: string) => {
    const value = promptsRepo.restore(id);
    scheduleCloudSync();
    return value;
  });
  ipcMain.handle(IPC.PROMPTS_PURGE, (_e, id: string) => {
    promptsRepo.purge(id);
    scheduleCloudSync();
    return { ok: true as const };
  });
  ipcMain.handle(IPC.PROMPTS_PURGE_ALL, () => {
    const value = { purged: promptsRepo.purgeAllDeleted() };
    scheduleCloudSync();
    return value;
  });
  // 侧栏计数
  ipcMain.handle(IPC.PROMPTS_STATS, () => promptsRepo.stats());
}
