// electron/main/ipc/tags.ts
// 标签 IPC handler —— 详见 docs/07-ipc-contracts.md §3.3

import { ipcMain } from "electron";
import { IPC } from "@shared/types/ipc";
import { tagsRepo } from "@musefold/core/db/repositories/tags";
import { promptsRepo } from "@musefold/core/db/repositories/prompts";
import { getDb } from "@musefold/core/db";
import { scheduleCloudSync } from "../../cloud-sync";

/**
 * prompts_fts.tags_index 里含标签名（JS 侧分词），所以任何改动
 * 「标签名」或「prompt↔tag 关联」的写路径都必须重建受影响 prompt 的 FTS 行，
 * 否则搜索会命中已解绑的旧标签词、或搜不到新绑定的标签。
 */
function promptIdsOfTag(tagId: string): string[] {
  const rows = getDb()
    .prepare("SELECT prompt_id FROM prompt_tags WHERE tag_id = ?")
    .all(tagId) as { prompt_id: string }[];
  return rows.map((r) => r.prompt_id);
}

export function registerTagHandlers(): void {
  ipcMain.handle(IPC.TAGS_LIST, (_e, group?) => tagsRepo.list(group));
  ipcMain.handle(IPC.TAGS_CREATE, (_e, t) => {
    const value = tagsRepo.create(t);
    scheduleCloudSync();
    return value;
  });
  ipcMain.handle(IPC.TAGS_UPDATE, (_e, id: string, patch) => {
    const affected = patch?.name !== undefined ? promptIdsOfTag(id) : [];
    const tag = tagsRepo.update(id, patch);
    for (const pid of affected) promptsRepo.resyncFts(pid);
    scheduleCloudSync();
    return tag;
  });
  ipcMain.handle(IPC.TAGS_DELETE, (_e, id: string) => {
    // 必须删前取：DELETE 之后 prompt_tags 已被 CASCADE 清掉，查不到受影响的 prompt
    const affected = promptIdsOfTag(id);
    tagsRepo.delete(id);
    for (const pid of affected) promptsRepo.resyncFts(pid);
    scheduleCloudSync();
    return { ok: true as const };
  });
  ipcMain.handle(IPC.TAGS_ASSIGN, (_e, promptId: string, tagIds: string[]) => {
    tagsRepo.assignToPrompt(promptId, tagIds);
    promptsRepo.resyncFts(promptId);
    scheduleCloudSync();
    return { ok: true as const };
  });
}
