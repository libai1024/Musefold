// electron/db/repositories/tags.ts
// 标签数据访问层 —— 详见 docs/02-data-model.md §2.2、docs/03-prompt-library.md §2.2

import { ulid } from 'ulid';
import type { Tag, NewTag } from '@shared/types/models';
import type { TagGroup } from '@shared/types/enums';
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
  list(group?: TagGroup): Tag[] {
    const db = getDb();
    const rows = group
      ? db
          .prepare('SELECT * FROM tags WHERE tag_group = ? ORDER BY name')
          .all(group)
      : db.prepare('SELECT * FROM tags ORDER BY tag_group, name').all();
    return rows.map(rowToTag);
  },

  listAll(): Tag[] {
    return this.list();
  },

  create(t: NewTag): Tag {
    const db = getDb();
    const id = ulid();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO tags (id, name, tag_group, color, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, t.name, t.tagGroup ?? null, t.color ?? null, now);
      enqueueActiveAccountMutation(db, 'tag', id, 'create');
    })();
    return this.get(id)!;
  },

  get(id: string): Tag | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    return row ? rowToTag(row) : null;
  },

  update(id: string, patch: Partial<Tag>): Tag {
    const db = getDb();
    db.transaction(() => {
      if (patch.name !== undefined)
        db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(patch.name, id);
      if (patch.tagGroup !== undefined)
        db.prepare('UPDATE tags SET tag_group = ? WHERE id = ?').run(
          patch.tagGroup,
          id,
        );
      if (patch.color !== undefined)
        db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(
          patch.color,
          id,
        );
      enqueueActiveAccountMutation(db, 'tag', id, 'update');
    })();
    return this.get(id)!;
  },

  delete(id: string): void {
    const db = getDb();
    const promptIds = db
      .prepare('SELECT prompt_id AS id FROM prompt_tags WHERE tag_id = ?')
      .all(id) as Array<{ id: string }>;
    db.transaction(() => {
      enqueueActiveAccountMutation(db, 'tag', id, 'delete');
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
      for (const prompt of promptIds)
        enqueueActiveAccountMutation(db, 'prompt', prompt.id, 'update');
    })();
  },

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
