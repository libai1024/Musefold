// electron/main/ipc/folders.ts
// 文件夹 IPC handler —— 详见 docs/07-ipc-contracts.md §3.2

import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import { foldersRepo } from '@musefold/core/db/repositories/folders';

export function registerFolderHandlers(): void {
  // parentId 省略时返回全量（用于侧栏树形展示）
  ipcMain.handle(IPC.FOLDERS_LIST, (_e, parentId?: string) =>
    parentId === undefined ? foldersRepo.listAll() : foldersRepo.list(parentId)
  );
  ipcMain.handle(IPC.FOLDERS_CREATE, (_e, f) => foldersRepo.create(f));
  ipcMain.handle(IPC.FOLDERS_UPDATE, (_e, id: string, patch) => foldersRepo.update(id, patch));
  ipcMain.handle(IPC.FOLDERS_DELETE, (_e, id: string) => { foldersRepo.delete(id); return { ok: true as const }; });
  ipcMain.handle(IPC.FOLDERS_REORDER, (_e, ids: string[]) => { foldersRepo.reorder(ids); return { ok: true as const }; });
}
