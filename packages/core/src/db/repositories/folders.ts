// electron/db/repositories/folders.ts
// 文件夹数据访问层 —— 详见 docs/02-data-model.md §2.2

import { ulid } from "ulid";
import type { Folder, NewFolder } from "@shared/types/models";
import { getDb } from "../index";
import { enqueueActiveAccountMutation } from "../../sync/repository";

function rowToFolder(row: unknown): Folder {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    parentId: (r.parent_id as string) ?? null,
    sortOrder: (r.sort_order as number) ?? 0,
    createdAt: r.created_at as number,
  };
}

export const foldersRepo = {
  list(parentId?: string): Folder[] {
    const db = getDb();
    const rows = parentId
      ? db
          .prepare(
            "SELECT * FROM folders WHERE parent_id = ? ORDER BY sort_order, name",
          )
          .all(parentId)
      : db
          .prepare(
            "SELECT * FROM folders WHERE parent_id IS NULL ORDER BY sort_order, name",
          )
          .all();
    return rows.map(rowToFolder);
  },

  /** 取全量（含子层），用于侧栏树形展示 */
  listAll(): Folder[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM folders ORDER BY sort_order, name")
      .all();
    return rows.map(rowToFolder);
  },

  create(f: NewFolder): Folder {
    const db = getDb();
    const id = ulid();
    const now = Date.now();

    // 约束：最多 2 层。若指定 parentId，则该 parent 不能有 parentId（即不能在第 3 层）
    if (f.parentId) {
      const parent = this.get(f.parentId);
      if (!parent) throw new Error("Parent folder not found");
      if (parent.parentId) {
        throw new Error("文件夹最多 2 层，不能在子文件夹下再建子文件夹");
      }
    }
    const maxOrder = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM folders WHERE parent_id IS ?",
      )
      .get(f.parentId ?? null) as { m: number };
    db.transaction(() => {
      db.prepare(
        "INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, f.name, f.parentId ?? null, maxOrder.m + 1, now);
      enqueueActiveAccountMutation(db, "folder", id, "create");
    })();
    return this.get(id)!;
  },

  get(id: string): Folder | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
    return row ? rowToFolder(row) : null;
  },

  update(id: string, patch: Partial<Folder>): Folder {
    const db = getDb();
    const update = db.transaction(() => {
      if (patch.name !== undefined) {
        db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(
          patch.name,
          id,
        );
      }
      if (patch.parentId !== undefined) {
        // 约束：最多 2 层；不能把自己设为自己的子孙
        if (patch.parentId === id) throw new Error("不能把文件夹移动到自身下");
        if (patch.parentId) {
          const newParent = this.get(patch.parentId);
          if (!newParent) throw new Error("目标文件夹不存在");
          if (newParent.parentId) throw new Error("文件夹最多 2 层");
          // 防止把父级移到子级下
          let cur: string | null = newParent.id;
          while (cur) {
            const c = this.get(cur);
            if (!c) break;
            if (c.parentId === id)
              throw new Error("不能把文件夹移动到自己的子文件夹下");
            cur = c.parentId;
          }
        }
        db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(
          patch.parentId,
          id,
        );
      }
      if (patch.sortOrder !== undefined) {
        db.prepare("UPDATE folders SET sort_order = ? WHERE id = ?").run(
          patch.sortOrder,
          id,
        );
      }
      enqueueActiveAccountMutation(db, "folder", id, "update");
    });
    update();
    return this.get(id)!;
  },

  delete(id: string): void {
    const db = getDb();
    const promptIds = db
      .prepare("SELECT id FROM prompts WHERE folder_id = ?")
      .all(id) as Array<{ id: string }>;
    const childIds = db
      .prepare("SELECT id FROM folders WHERE parent_id = ?")
      .all(id) as Array<{ id: string }>;
    db.transaction(() => {
      enqueueActiveAccountMutation(db, "folder", id, "delete");
      db.prepare("UPDATE folders SET parent_id = NULL WHERE parent_id = ?").run(
        id,
      );
      db.prepare("UPDATE prompts SET folder_id = NULL WHERE folder_id = ?").run(
        id,
      );
      db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      for (const prompt of promptIds)
        enqueueActiveAccountMutation(db, "prompt", prompt.id, "update");
      for (const child of childIds)
        enqueueActiveAccountMutation(db, "folder", child.id, "update");
    })();
  },

  reorder(ids: string[]): void {
    const db = getDb();
    const stmt = db.prepare("UPDATE folders SET sort_order = ? WHERE id = ?");
    db.transaction(() => {
      ids.forEach((id, i) => {
        stmt.run(i, id);
        enqueueActiveAccountMutation(db, "folder", id, "update");
      });
    })();
  },
};
