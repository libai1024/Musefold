// electron/db/repositories/prompts.ts
// 提示词数据访问层 —— 详见 docs/02-data-model.md、docs/03-prompt-library.md

import { ulid } from 'ulid';
import type { Prompt, NewPrompt, PromptParams } from '@musefold/desktop-contracts/models';
import type { ListPromptsQuery, UpdatePromptPatch } from '@musefold/desktop-contracts/ipc';
import type { PromptStats } from '@musefold/desktop-contracts/ipc';
import type { SyncUsageAction, ParsedPromptListQuery } from '@musefold/contracts';
import { UNFILED_FOLDER_ID } from '@musefold/domain/constants';
import { getDb } from '../index';
import { parseJsonColumn } from '../json';
import { resolveLocalContentWorkspace } from '../workspaces';
import { tagsRepo } from './tags';
import { tokenizeForFts, buildMatchQuery } from '../fts';
import {
  enqueueActiveAccountMutation,
  enqueueActiveAccountUsageEvent,
} from '../../sync/repository';

function requirePrompt(prompt: Prompt | null): Prompt {
  if (!prompt) throw new Error('提示词写入后无法读取');
  return prompt;
}

/**
 * FTS 由本层显式维护（schema.ts 已说明为何不能用触发器：分词在 JS 侧）。
 * 约定：任何改动 prompts 的 title/description/content/tags 的写路径，
 * 都必须在同一事务内调用 syncFts；硬删除必须调用 removeFts。
 */
function syncFts(id: string, workspaceId?: string): void {
  const db = getDb();
  const scope = workspaceId ?? resolveLocalContentWorkspace(db);
  const row = db
    .prepare(
      'SELECT rowid, title, description, content FROM prompts WHERE workspace_id = ? AND id = ?',
    )
    .get(scope, id) as
    | {
        rowid: number;
        title: string;
        description: string | null;
        content: string;
      }
    | undefined;
  if (!row) return;
  const tagNames = tagsRepo.getByPromptId(id, scope).map((t) => t.name);
  const tagsIndex = tokenizeForFts(row.title, row.description, row.content, tagNames);
  db.prepare('DELETE FROM prompts_fts WHERE rowid = ?').run(row.rowid);
  db.prepare(
    'INSERT INTO prompts_fts (rowid, title, description, content, tags_index) VALUES (?, ?, ?, ?, ?)',
  ).run(row.rowid, row.title, row.description ?? '', row.content, tagsIndex);
}

function removeFts(id: string, workspaceId?: string): void {
  const db = getDb();
  const scope = workspaceId ?? resolveLocalContentWorkspace(db);
  const row = db
    .prepare('SELECT rowid FROM prompts WHERE workspace_id = ? AND id = ?')
    .get(scope, id) as { rowid: number } | undefined;
  if (row) db.prepare('DELETE FROM prompts_fts WHERE rowid = ?').run(row.rowid);
}

/**
 * 展示封面子查询：该提示词最新一张关联成功作品。
 * 语义见 Prompt.coverImagePath —— 「相关作品作为封面」，preview_image_path 只是兜底。
 */
/**
 * 相关作品口径:直接以本提示词生成的(generation_runs.prompt_id)+ 引用过本提示词的
 * (prompt_snapshot_json.promptReferences,单账本后取代 history_prompt_references),
 * 取最新一张成功图;回收站(软删)不计入封面。
 */
const COVER_IMAGE_SELECT = `(
  SELECT related.media_path FROM (
    SELECT ga.media_path, gr.created_at FROM generation_runs gr
    JOIN generated_assets ga ON ga.run_id = gr.id AND ga.position = 0
    WHERE gr.prompt_id = p.id AND gr.status = 'success' AND gr.deleted_at IS NULL
      AND ga.status = 'available' AND ga.media_path IS NOT NULL
    UNION ALL
    SELECT ga.media_path, gr.created_at FROM generation_runs gr
    JOIN generated_assets ga ON ga.run_id = gr.id AND ga.position = 0
    WHERE gr.status = 'success' AND gr.deleted_at IS NULL
      AND ga.status = 'available' AND ga.media_path IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM json_each(gr.prompt_snapshot_json, '$.promptReferences') je
        WHERE json_extract(je.value, '$.promptId') = p.id
      )
  ) related
  ORDER BY related.created_at DESC LIMIT 1
) AS latest_work_image`;

function rowToPrompt(row: unknown): Prompt {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    content: r.content as string,
    contentNegative: (r.content_negative as string) ?? null,
    folderId: (r.folder_id as string) ?? null,
    modelId: (r.model_id as string) ?? null,
    params: parseJsonColumn<PromptParams | null>(r.params, null),
    previewImagePath: (r.preview_image_path as string) ?? null,
    coverImagePath: (r.latest_work_image as string) ?? (r.preview_image_path as string) ?? null,
    rating: r.rating as number,
    isPinned: Boolean(r.is_pinned),
    pinOrder: (r.pin_order as number) ?? null,
    usageCount: r.usage_count as number,
    lastUsedAt: (r.last_used_at as number) ?? null,
    source: (r.source as Prompt['source']) ?? 'manual',
    sourceUrl: (r.source_url as string) ?? null,
    tags: [],
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number) ?? null,
  };
}

function attachTags(p: Prompt, workspaceId?: string): Prompt {
  return { ...p, tags: tagsRepo.getByPromptId(p.id, workspaceId) };
}

/** 排序键（方向由 sortDir 决定；desc 为各键的「自然」方向，title 例外见下） */
const SORT_COLUMN = {
  updated: 'p.updated_at',
  created: 'p.created_at',
  title: 'p.title',
  rating: 'p.rating',
  usage: 'p.usage_count',
} as const;

/**
 * 组装 ORDER BY。
 * - 收藏恒在最上（`is_pinned DESC`），置顶区内部按 pin_order（TASK-LIB-04）；
 *   非收藏行的 CASE 结果统一为 NULL，故对普通区无影响。
 * - 追加 updated_at + id 作次级键：保证同值稳定排序（评分/次数全 0 时不抖动）。
 * - title 的「默认方向」是 A→Z，与时间/数值类相反，所以 desc/asc 在此语义翻转。
 */
function buildOrderBy(sort: ListPromptsQuery['sort'], dir: ListPromptsQuery['sortDir']): string {
  const key = SORT_COLUMN[sort ?? 'updated'];
  const descending = (dir ?? 'desc') === 'desc';
  const direction =
    key === SORT_COLUMN.title ? (descending ? 'ASC' : 'DESC') : descending ? 'DESC' : 'ASC';
  return `p.is_pinned DESC, CASE WHEN p.is_pinned = 1 THEN p.pin_order END ASC, ${key} ${direction}, p.updated_at DESC, p.id DESC`;
}

type PromptListWindow = Pick<ParsedPromptListQuery, 'includeDeleted' | 'deletedOnly'> & {
  offset: number;
  limit: number;
};

export const promptsRepo = {
  /** Rebuild after taxonomy changes; caller owns the surrounding write transaction. */
  refreshSearchIndex(id: string, workspaceId?: string): void {
    syncFts(id, workspaceId);
  },
  list(q: ListPromptsQuery = {}, workspaceId?: string, pageWindow?: PromptListWindow): Prompt[] {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    if (
      pageWindow &&
      (!Number.isSafeInteger(pageWindow.offset) ||
        pageWindow.offset < 0 ||
        !Number.isInteger(pageWindow.limit) ||
        pageWindow.limit < 1 ||
        pageWindow.limit > 101)
    ) {
      throw new RangeError('Invalid prompt page window');
    }
    const deletedPredicate = pageWindow?.deletedOnly
      ? 'p.deleted_at IS NOT NULL'
      : pageWindow?.includeDeleted
        ? '1=1'
        : 'p.deleted_at IS NULL';

    // 走 FTS5 搜索时，用 BM25 排序；否则走普通查询
    const match = q.search ? buildMatchQuery(q.search) : null;
    if (match) {
      // FTS5 + 标签 AND 筛选
      let sql = `
        SELECT p.*, ${COVER_IMAGE_SELECT} FROM prompts_fts f
        JOIN prompts p ON p.rowid = f.rowid
        WHERE prompts_fts MATCH ? AND p.workspace_id = ? AND ${deletedPredicate}
      `;
      const values: unknown[] = [match, scope];
      if (q.folderId === UNFILED_FOLDER_ID) {
        sql += ' AND p.folder_id IS NULL';
      } else if (q.folderId) {
        sql += ' AND p.folder_id = ?';
        values.push(q.folderId);
      }
      if (q.filters?.modelId) {
        sql += ' AND p.model_id = ?';
        values.push(q.filters.modelId);
      }
      if (q.filters?.isPinned !== undefined) {
        sql += ' AND p.is_pinned = ?';
        values.push(q.filters.isPinned ? 1 : 0);
      }
      // 与非搜索路径保持筛选维度一致（否则「搜索 + 筛选栏」组合会静默丢条件）
      if (q.filters?.ratingGte !== undefined) {
        sql += ' AND p.rating >= ?';
        values.push(q.filters.ratingGte);
      }
      if (q.filters?.usageCountGte !== undefined) {
        sql += ' AND p.usage_count >= ?';
        values.push(q.filters.usageCountGte);
      }
      if (q.filters?.createdAfter !== undefined) {
        sql += ' AND p.created_at >= ?';
        values.push(q.filters.createdAfter);
      }
      if (q.filters?.source) {
        sql += ' AND p.source = ?';
        values.push(q.filters.source);
      }
      if (q.tagIds && q.tagIds.length > 0) {
        // AND 语义：每个 tag 都要命中
        const placeholders = q.tagIds.map(() => '?').join(',');
        sql += ` AND p.id IN (
          SELECT prompt_id FROM prompt_tags
          WHERE workspace_id = ? AND tag_id IN (${placeholders})
          GROUP BY prompt_id HAVING COUNT(DISTINCT tag_id) = ?
        )`;
        values.push(scope, ...q.tagIds, q.tagIds.length);
      }
      // 搜索态按相关度排序（bm25），但收藏仍归到置顶区，与 UI 分区一致
      sql +=
        ' ORDER BY p.is_pinned DESC, CASE WHEN p.is_pinned = 1 THEN p.pin_order END ASC, bm25(prompts_fts), p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?';
      values.push(pageWindow?.limit ?? 500, pageWindow?.offset ?? 0);
      const rows = db.prepare(sql).all(...values);
      return rows.map(rowToPrompt).map((row) => attachTags(row, scope));
    }

    // 非搜索路径
    let sql = `SELECT p.*, ${COVER_IMAGE_SELECT} FROM prompts p WHERE p.workspace_id = ? AND ${deletedPredicate}`;
    const values: unknown[] = [scope];
    if (q.folderId === UNFILED_FOLDER_ID) {
      sql += ' AND p.folder_id IS NULL';
    } else if (q.folderId) {
      sql += ' AND p.folder_id = ?';
      values.push(q.folderId);
    }
    if (q.filters?.modelId) {
      sql += ' AND p.model_id = ?';
      values.push(q.filters.modelId);
    }
    if (q.filters?.isPinned !== undefined) {
      sql += ' AND p.is_pinned = ?';
      values.push(q.filters.isPinned ? 1 : 0);
    }
    if (q.filters?.ratingGte !== undefined) {
      sql += ' AND p.rating >= ?';
      values.push(q.filters.ratingGte);
    }
    if (q.filters?.usageCountGte !== undefined) {
      sql += ' AND p.usage_count >= ?';
      values.push(q.filters.usageCountGte);
    }
    if (q.filters?.createdAfter !== undefined) {
      sql += ' AND p.created_at >= ?';
      values.push(q.filters.createdAfter);
    }
    if (q.filters?.source) {
      sql += ' AND p.source = ?';
      values.push(q.filters.source);
    }
    if (q.tagIds && q.tagIds.length > 0) {
      const placeholders = q.tagIds.map(() => '?').join(',');
      sql += ` AND p.id IN (
        SELECT prompt_id FROM prompt_tags
        WHERE workspace_id = ? AND tag_id IN (${placeholders})
        GROUP BY prompt_id HAVING COUNT(DISTINCT tag_id) = ?
      )`;
      values.push(scope, ...q.tagIds, q.tagIds.length);
    }
    // 收藏优先置顶
    sql += ` ORDER BY ${buildOrderBy(q.sort, q.sortDir)} LIMIT ? OFFSET ?`;
    values.push(pageWindow?.limit ?? 1000, pageWindow?.offset ?? 0);
    const rows = db.prepare(sql).all(...values);
    return rows.map(rowToPrompt).map((row) => attachTags(row, scope));
  },

  get(id: string, workspaceId?: string): Prompt | null {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const row = db
      .prepare(
        `SELECT p.*, ${COVER_IMAGE_SELECT} FROM prompts p WHERE p.workspace_id = ? AND p.id = ?`,
      )
      .get(scope, id);
    if (!row) return null;
    return attachTags(rowToPrompt(row), scope);
  },

  create(p: NewPrompt, workspaceId?: string): Prompt {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const now = Date.now();
    const id = ulid();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO prompts (workspace_id, id, title, description, content, content_negative, folder_id, model_id,
          params, preview_image_path, rating, is_pinned, source, source_url, created_at, updated_at)
         VALUES (@workspace_id, @id, @title, @description, @content, @content_negative, @folder_id, @model_id,
          @params, @preview_image_path, @rating, @is_pinned, @source, @source_url, @created_at, @updated_at)`,
      ).run({
        workspace_id: scope,
        id,
        title: p.title,
        description: p.description ?? null,
        content: p.content,
        content_negative: p.contentNegative ?? null,
        folder_id: p.folderId ?? null,
        model_id: p.modelId ?? null,
        params: p.params ? JSON.stringify(p.params) : null,
        preview_image_path: p.previewImagePath ?? null,
        rating: p.rating ?? 0,
        is_pinned: p.isPinned ? 1 : 0,
        source: p.source ?? 'manual',
        source_url: p.sourceUrl ?? null,
        created_at: now,
        updated_at: now,
      });
      if (p.tagIds && p.tagIds.length > 0) {
        tagsRepo.assignToPrompt(id, p.tagIds, scope);
      }
      // 标签写入后再建 FTS 行，保证 tags_index 含标签词
      syncFts(id, scope);
      enqueueActiveAccountMutation(db, 'prompt', id, 'create', scope);
    })();
    return requirePrompt(this.get(id, scope));
  },

  update(id: string, patch: UpdatePromptPatch, workspaceId?: string): Prompt {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const now = Date.now();
    const fields: string[] = [];
    const values: Record<string, unknown> = { workspace_id: scope, id, updated_at: now };
    if (patch.title !== undefined) {
      fields.push('title = @title');
      values.title = patch.title;
    }
    if (patch.content !== undefined) {
      fields.push('content = @content');
      values.content = patch.content;
    }
    if (patch.description !== undefined) {
      fields.push('description = @description');
      values.description = patch.description;
    }
    if (patch.contentNegative !== undefined) {
      fields.push('content_negative = @content_negative');
      values.content_negative = patch.contentNegative;
    }
    if (patch.isPinned !== undefined) {
      fields.push('is_pinned = @is_pinned');
      values.is_pinned = patch.isPinned ? 1 : 0;
    }
    if (patch.folderId !== undefined) {
      fields.push('folder_id = @folder_id');
      values.folder_id = patch.folderId;
    }
    if (patch.modelId !== undefined) {
      fields.push('model_id = @model_id');
      values.model_id = patch.modelId;
    }
    if (patch.params !== undefined) {
      fields.push('params = @params');
      values.params = JSON.stringify(patch.params);
    }
    if (patch.previewImagePath !== undefined) {
      fields.push('preview_image_path = @preview_image_path');
      values.preview_image_path = patch.previewImagePath;
    }
    if (patch.rating !== undefined) {
      fields.push('rating = @rating');
      values.rating = patch.rating;
    }
    if (patch.source !== undefined) {
      fields.push('source = @source');
      values.source = patch.source;
    }

    db.transaction(() => {
      if (fields.length > 0) {
        db.prepare(
          `UPDATE prompts SET ${fields.join(', ')}, updated_at = @updated_at
           WHERE workspace_id = @workspace_id AND id = @id`,
        ).run(values);
      }
      // 标签变更
      if (patch.tagIds !== undefined) {
        tagsRepo.assignToPrompt(id, patch.tagIds, scope);
      }
      // 重建 FTS 行（title/description/content/tags 任一变化都要重算分词）
      syncFts(id, scope);
      enqueueActiveAccountMutation(db, 'prompt', id, 'update', scope);
    })();
    return requirePrompt(this.get(id, scope));
  },

  softDelete(id: string, workspaceId?: string): void {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    // 软删除保留 FTS 行；list() 的 `p.deleted_at IS NULL` 已把它挡在搜索结果外，
    // 恢复时无需重建索引。
    db.transaction(() => {
      db.prepare(
        'UPDATE prompts SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
      ).run(Date.now(), Date.now(), scope, id);
      enqueueActiveAccountMutation(db, 'prompt', id, 'delete', scope);
    })();
  },

  // ---------- 回收站（docs/product/10 TASK-LIB-12） ----------

  /** 回收站列表：仅已软删除的条目，按删除时间倒序 */
  listDeleted(workspaceId?: string): Prompt[] {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const rows = db
      .prepare(
        'SELECT * FROM prompts WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500',
      )
      .all(scope);
    return rows.map(rowToPrompt).map((row) => attachTags(row, scope));
  },

  /** 从回收站恢复 */
  restore(id: string, workspaceId?: string): Prompt {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    db.transaction(() => {
      db.prepare(
        'UPDATE prompts SET deleted_at = NULL, updated_at = ? WHERE workspace_id = ? AND id = ?',
      ).run(Date.now(), scope, id);
      syncFts(id, scope);
      enqueueActiveAccountMutation(db, 'prompt', id, 'restore', scope);
    })();
    return requirePrompt(this.get(id, scope));
  },

  /** 彻底删除（不可恢复）：先清 FTS 行，再删主表；关联表由外键 CASCADE 清理 */
  purge(id: string, workspaceId?: string): void {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    db.transaction(() => {
      removeFts(id, scope);
      db.prepare('DELETE FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ?').run(scope, id);
      db.prepare('DELETE FROM prompts WHERE workspace_id = ? AND id = ?').run(scope, id);
      enqueueActiveAccountMutation(db, 'prompt', id, 'delete', scope);
    })();
  },

  /** 清空回收站；返回清理条数 */
  purgeAllDeleted(workspaceId?: string): number {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    return db.transaction(() => {
      // Select and delete under the same transaction, including FTS and sync mutations.
      const ids = db
        .prepare('SELECT id FROM prompts WHERE workspace_id = ? AND deleted_at IS NOT NULL')
        .all(scope) as { id: string }[];
      for (const { id } of ids) {
        removeFts(id, scope);
        db.prepare('DELETE FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ?').run(
          scope,
          id,
        );
        db.prepare('DELETE FROM prompts WHERE workspace_id = ? AND id = ?').run(scope, id);
        enqueueActiveAccountMutation(db, 'prompt', id, 'delete', scope);
      }
      return ids.length;
    })();
  },

  /**
   * 侧栏计数徽标（docs/product/10 TASK-LIB-03/06 验收项）。
   * 不能在渲染进程用 prompts.length 现算：list() 有 LIMIT，且被搜索/筛选收敛过。
   */
  stats(workspaceId?: string): PromptStats {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const total = (
      db
        .prepare('SELECT COUNT(*) AS c FROM prompts WHERE workspace_id = ? AND deleted_at IS NULL')
        .get(scope) as {
        c: number;
      }
    ).c;
    const unfiled = (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM prompts WHERE workspace_id = ? AND deleted_at IS NULL AND folder_id IS NULL',
        )
        .get(scope) as { c: number }
    ).c;
    const trashed = (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM prompts WHERE workspace_id = ? AND deleted_at IS NOT NULL',
        )
        .get(scope) as {
        c: number;
      }
    ).c;
    const pinned = (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM prompts WHERE workspace_id = ? AND deleted_at IS NULL AND is_pinned = 1',
        )
        .get(scope) as { c: number }
    ).c;

    const byFolder: Record<string, number> = {};
    for (const r of db
      .prepare(
        `SELECT folder_id AS id, COUNT(*) AS c FROM prompts
         WHERE workspace_id = ? AND deleted_at IS NULL AND folder_id IS NOT NULL GROUP BY folder_id`,
      )
      .all(scope) as { id: string; c: number }[]) {
      byFolder[r.id] = r.c;
    }

    const byTag: Record<string, number> = {};
    for (const r of db
      .prepare(
        `SELECT pt.tag_id AS id, COUNT(*) AS c FROM prompt_tags pt
         JOIN prompts p ON p.workspace_id = pt.workspace_id AND p.id = pt.prompt_id
         WHERE pt.workspace_id = ? AND p.deleted_at IS NULL GROUP BY pt.tag_id`,
      )
      .all(scope) as { id: string; c: number }[]) {
      byTag[r.id] = r.c;
    }

    return { total, unfiled, trashed, pinned, byFolder, byTag };
  },

  /** 全量重建 FTS 索引（迁移/导入后调用） */
  reindexFts(workspaceId?: string): number {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const rows = db.prepare('SELECT id, rowid FROM prompts WHERE workspace_id = ?').all(scope) as {
      id: string;
      rowid: number;
    }[];
    db.transaction(() => {
      for (const { rowid } of rows)
        db.prepare('DELETE FROM prompts_fts WHERE rowid = ?').run(rowid);
      for (const { id } of rows) syncFts(id, scope);
    })();
    return rows.length;
  },

  togglePin(id: string, pinned: boolean, workspaceId?: string): Prompt {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const now = Date.now();
    const maxOrder = db
      .prepare(
        'SELECT COALESCE(MAX(pin_order), -1) AS m FROM prompts WHERE workspace_id = ? AND is_pinned = 1',
      )
      .get(scope) as { m: number };
    db.transaction(() => {
      db.prepare(
        'UPDATE prompts SET is_pinned = ?, pin_order = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
      ).run(pinned ? 1 : 0, pinned ? maxOrder.m + 1 : null, now, scope, id);
      enqueueActiveAccountMutation(db, 'prompt', id, 'update', scope);
    })();
    return requirePrompt(this.get(id, scope));
  },

  reorderPins(ids: string[], workspaceId?: string): void {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    const stmt = db.prepare(
      'UPDATE prompts SET pin_order = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
    );
    const now = Date.now();
    db.transaction(() => {
      ids.forEach((id, i) => {
        stmt.run(i, now, scope, id);
        enqueueActiveAccountMutation(db, 'prompt', id, 'update', scope);
      });
    })();
  },

  incrementUsage(id: string, action: SyncUsageAction = 'apply', workspaceId?: string): void {
    const db = getDb();
    const scope = workspaceId ?? resolveLocalContentWorkspace(db);
    db.transaction(() => {
      db.prepare(
        'UPDATE prompts SET usage_count = usage_count + 1, last_used_at = ? WHERE workspace_id = ? AND id = ?',
      ).run(Date.now(), scope, id);
      enqueueActiveAccountUsageEvent(db, id, action, scope);
    })();
  },
};
