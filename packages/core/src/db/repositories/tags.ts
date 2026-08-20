// electron/db/repositories/tags.ts
// 标签关联层 —— 提示词 create/update 仍写 prompt_tags；
// 标签目录 IPC CRUD 已退役，导入导出与云同步直写 tags 表。

import type { Tag } from '@musefold/desktop-contracts/models';
import type { TagGroup } from '@musefold/desktop-contracts/enums';
import { getDb } from '../index';
import { enqueueActiveAccountMutation } from '../../sync/repository';

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
  assignToPrompt(promptId: string, tagIds: string[]): void {
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(promptId);
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)',
      );
      tagIds.forEach((tid) => stmt.run(promptId, tid));
      enqueueActiveAccountMutation(db, 'prompt', promptId, 'update');
    })();
  },

  getByPromptId(promptId: string): Tag[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.* FROM tags t
       JOIN prompt_tags pt ON pt.tag_id = t.id
       WHERE pt.prompt_id = ?`,
      )
      .all(promptId);
    return rows.map(rowToTag);
  },
};
