// electron/db/repositories/tags.ts
// 标签关联层 —— 提示词 create/update 仍写 prompt_tags；
// 标签目录 IPC CRUD 已退役，导入导出与云同步直写 tags 表。

import type { Tag } from '@musefold/desktop-contracts/models';
import type { TagGroup } from '@musefold/desktop-contracts/enums';
import { getDb } from '../index';
import { enqueueActiveAccountMutation } from '../../sync/repository';
import { resolveLocalContentWorkspace } from '../workspaces';

function rowToTag(row: unknown): Tag {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    tagGroup: (r.tag_group as TagGroup) ?? null,
    color: (r.color as string) ?? null,
    createdAt: r.created_at as number,
  };
}

export const tagsRepo = {
  assignToPrompt(promptId: string, tagIds: string[], workspaceId?: string): void {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    db.transaction(() => {
      db.prepare('DELETE FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ?').run(
        scope,
        promptId,
      );
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO prompt_tags (workspace_id, prompt_id, tag_id) VALUES (?, ?, ?)',
      );
      for (const tid of tagIds) stmt.run(scope, promptId, tid);
      enqueueActiveAccountMutation(db, 'prompt', promptId, 'update', scope);
    })();
  },

  getByPromptId(promptId: string, workspaceId?: string): Tag[] {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const rows = db
      .prepare(
        `SELECT t.* FROM tags t
       JOIN prompt_tags pt ON pt.tag_id = t.id
       WHERE pt.workspace_id = ? AND pt.prompt_id = ?
         AND t.workspace_id = pt.workspace_id`,
      )
      .all(scope, promptId);
    return rows.map(rowToTag);
  },
};
