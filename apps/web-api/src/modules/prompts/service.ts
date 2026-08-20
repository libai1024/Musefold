import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import {
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptUseInputSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
  type NewPromptDocument,
  type NewPromptFolder,
  type NewPromptTag,
  type ParsedPromptListQuery,
  type PromptDocument,
  type PromptFolder,
  type PromptPage,
  type PromptTag,
  type PromptUseInput,
  type UpdatePromptDocument,
  type UpdatePromptFolder,
  type UpdatePromptTag,
} from "@musefold/contracts";
import type { MusefoldDatabase } from "../../database/types.js";
import {
  withOwnerTransaction,
  type OwnerTransaction,
} from "../../database/owner-context.js";
import { AppError } from "../../errors.js";

type PromptRow = {
  id: string;
  title: string;
  description: string | null;
  content: string;
  negative: string | null;
  folder_id: string | null;
  model_id: string | null;
  params: Record<string, unknown> | null;
  rating: number;
  is_pinned: boolean;
  pin_order: number | null;
  usage_count: number;
  last_used_at: Date | string | null;
  source: PromptDocument["source"];
  source_url: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  tags: Array<{
    id: string;
    name: string;
    group: string | null;
    color: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }>;
};

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

type TagRow = {
  id: string;
  name: string;
  tag_group: string | null;
  color: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

export interface PromptOperationContext {
  transaction: OwnerTransaction;
}

export interface PromptServicePort {
  listPrompts(
    ownerId: number,
    input: ParsedPromptListQuery,
  ): Promise<PromptPage>;
  getPrompt(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument>;
  createPrompt(
    ownerId: number,
    input: NewPromptDocument,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument>;
  getFolder(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder>;
  getTag(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptTag>;
  updatePrompt(
    ownerId: number,
    id: string,
    input: UpdatePromptDocument,
    context?: PromptOperationContext,
  ): Promise<PromptDocument>;
  deletePrompt(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptDocument>;
  restorePrompt(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptDocument>;
  usePrompt(
    ownerId: number,
    id: string,
    input: PromptUseInput,
  ): Promise<{ prompt: PromptDocument; recorded: boolean }>;
  listFolders(
    ownerId: number,
    includeDeleted?: boolean,
  ): Promise<PromptFolder[]>;
  createFolder(
    ownerId: number,
    input: NewPromptFolder,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder>;
  updateFolder(
    ownerId: number,
    id: string,
    input: UpdatePromptFolder,
    context?: PromptOperationContext,
  ): Promise<PromptFolder>;
  deleteFolder(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptFolder>;
  restoreFolder(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptFolder>;
  listTags(ownerId: number, includeDeleted?: boolean): Promise<PromptTag[]>;
  createTag(
    ownerId: number,
    input: NewPromptTag,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptTag>;
  updateTag(
    ownerId: number,
    id: string,
    input: UpdatePromptTag,
    context?: PromptOperationContext,
  ): Promise<PromptTag>;
  deleteTag(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptTag>;
  restoreTag(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptTag>;
}

export class PromptService implements PromptServicePort {
  constructor(private readonly db: Kysely<MusefoldDatabase>) {}

  async listPrompts(
    ownerId: number,
    input: ParsedPromptListQuery,
  ): Promise<PromptPage> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const conditions = [sql`p.deleted_at IS NULL`];
      if (input.includeDeleted) conditions[0] = sql`TRUE`;
      if (input.q) {
        const pattern = `%${input.q}%`;
        conditions.push(
          sql`(p.title || ' ' || p.content || ' ' || coalesce(p.description, '')) ILIKE ${pattern}`,
        );
      }
      if (input.folderId !== undefined) {
        conditions.push(
          input.folderId === null
            ? sql`p.folder_id IS NULL`
            : sql`p.folder_id = ${input.folderId}`,
        );
      }
      if (input.pinnedOnly) conditions.push(sql`p.is_pinned = true`);
      if (input.tagIds?.length) {
        conditions.push(sql`p.id IN (
          SELECT l.prompt_id FROM app.prompt_tag_links l
          WHERE l.owner_id = p.owner_id
            AND l.tag_id IN (${sql.join(
              input.tagIds.map((tagId) => sql`${tagId}`),
              sql`, `,
            )})
          GROUP BY l.prompt_id
          HAVING count(DISTINCT l.tag_id) = ${input.tagIds.length}
        )`);
      }

      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      if (cursor) {
        if (input.sort === "created-desc") {
          conditions.push(
            sql`(p.created_at, p.id) < (${new Date(cursor.value)}, ${cursor.id})`,
          );
        } else if (input.sort === "usage-desc") {
          conditions.push(
            sql`(p.usage_count, p.updated_at, p.id) < (${Number(cursor.value)}, ${new Date(cursor.updatedAt)}, ${cursor.id})`,
          );
        } else if (input.sort === "title-asc") {
          conditions.push(
            sql`(lower(p.title), p.id) > (${cursor.value}, ${cursor.id})`,
          );
        } else {
          conditions.push(
            sql`(p.updated_at, p.id) < (${new Date(cursor.value)}, ${cursor.id})`,
          );
        }
      }

      const order =
        input.sort === "created-desc"
          ? sql`p.created_at DESC, p.id DESC`
          : input.sort === "usage-desc"
            ? sql`p.usage_count DESC, p.updated_at DESC, p.id DESC`
            : input.sort === "title-asc"
              ? sql`lower(p.title) ASC, p.id ASC`
              : sql`p.is_pinned DESC, p.updated_at DESC, p.id DESC`;
      const result = await sql<PromptRow>`
        SELECT
          p.id, p.title, p.description, p.content, p.negative, p.folder_id,
          p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
          p.usage_count, p.last_used_at, p.source, p.source_url, p.version,
          p.created_at, p.updated_at, p.deleted_at,
          COALESCE(jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'group', t.tag_group, 'color', t.color,
            'version', t.version, 'createdAt', t.created_at,
            'updatedAt', t.updated_at, 'deletedAt', t.deleted_at
          ) ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS tags
        FROM app.prompts p
        LEFT JOIN app.prompt_tag_links l ON l.owner_id = p.owner_id AND l.prompt_id = p.id
        LEFT JOIN app.prompt_tags t ON t.owner_id = l.owner_id AND t.id = l.tag_id AND t.deleted_at IS NULL
        WHERE ${sql.join(conditions, sql` AND `)}
        GROUP BY p.owner_id, p.id, p.title, p.description, p.content, p.negative,
          p.folder_id, p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
          p.usage_count, p.last_used_at, p.source, p.source_url, p.version,
          p.created_at, p.updated_at, p.deleted_at
        ORDER BY ${order}
        LIMIT ${input.limit + 1}
      `.execute(trx);
      const rows = result.rows;
      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      const items = pageRows.map(toPromptDocument);
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last ? encodeCursorForRow(last, input.sort) : null,
      };
    });
  }

  async getPrompt(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.withOwnerContext(ownerId, context, async (trx) =>
      this.getPromptTx(trx, id),
    );
  }

  async createPrompt(
    ownerId: number,
    rawInput: NewPromptDocument,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    const input = newPromptDocumentSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      await this.validateFolderAndTags(trx, input.folderId, input.tagIds);
      const id = requestedId ?? randomUUID();
      await sql`
        INSERT INTO app.prompts (
          owner_id, id, title, description, content, negative, folder_id,
          model_id, params, rating, is_pinned, pin_order, source, source_url
        ) VALUES (
          ${ownerId}, ${id}, ${input.title}, ${nullable(input.description)}, ${input.content},
          ${nullable(input.negative)}, ${input.folderId}, ${input.modelId}, ${input.params ? JSON.stringify(input.params) : null},
          ${input.rating}, ${input.isPinned}, ${input.pinOrder ?? null}, ${input.source}, ${nullable(input.sourceUrl)}
        )
      `.execute(trx);
      await this.replacePromptTags(trx, ownerId, id, input.tagIds);
      const prompt = await this.getPromptTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "prompt",
        id,
        "upsert",
        prompt.version,
        prompt,
      );
      return prompt;
    });
  }

  async getFolder(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.withOwnerContext(ownerId, context, async (trx) =>
      this.getFolderTx(trx, id),
    );
  }

  async getTag(
    ownerId: number,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.withOwnerContext(ownerId, context, async (trx) =>
      this.getTagTx(trx, id),
    );
  }

  async updatePrompt(
    ownerId: number,
    id: string,
    rawInput: UpdatePromptDocument,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    const input = updatePromptDocumentSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getPromptTx(trx, id);
      if (current.version !== input.expectedVersion)
        throw versionConflict(current);
      if (input.folderId !== undefined || input.tagIds !== undefined)
        await this.validateFolderAndTags(
          trx,
          input.folderId === undefined ? current.folderId : input.folderId,
          input.tagIds ?? current.tags.map((tag) => tag.id),
        );
      const sets = [sql`version = version + 1`, sql`updated_at = now()`];
      if (input.title !== undefined) sets.push(sql`title = ${input.title}`);
      if (input.description !== undefined)
        sets.push(sql`description = ${nullable(input.description)}`);
      if (input.content !== undefined)
        sets.push(sql`content = ${input.content}`);
      if (input.negative !== undefined)
        sets.push(sql`negative = ${nullable(input.negative)}`);
      if (input.folderId !== undefined)
        sets.push(sql`folder_id = ${input.folderId}`);
      if (input.modelId !== undefined)
        sets.push(sql`model_id = ${input.modelId}`);
      if (input.params !== undefined)
        sets.push(
          sql`params = ${input.params ? JSON.stringify(input.params) : null}`,
        );
      if (input.rating !== undefined) sets.push(sql`rating = ${input.rating}`);
      if (input.isPinned !== undefined)
        sets.push(sql`is_pinned = ${input.isPinned}`);
      if (input.pinOrder !== undefined)
        sets.push(sql`pin_order = ${input.pinOrder}`);
      if (input.source !== undefined) sets.push(sql`source = ${input.source}`);
      if (input.sourceUrl !== undefined)
        sets.push(sql`source_url = ${nullable(input.sourceUrl)}`);
      if (sets.length === 2 && input.tagIds === undefined)
        throw new AppError("VALIDATION_FAILED", "没有可更新的字段", 400);
      await sql`UPDATE app.prompts SET ${sql.join(sets, sql`, `)} WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${input.expectedVersion}`.execute(
        trx,
      );
      if (input.tagIds !== undefined)
        await this.replacePromptTags(trx, ownerId, id, input.tagIds);
      const prompt = await this.getPromptTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "prompt",
        id,
        "upsert",
        prompt.version,
        prompt,
      );
      return prompt;
    });
  }

  async deletePrompt(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.changePromptDeletedState(
      ownerId,
      id,
      expectedVersion,
      true,
      context,
    );
  }

  async restorePrompt(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.changePromptDeletedState(
      ownerId,
      id,
      expectedVersion,
      false,
      context,
    );
  }

  async usePrompt(
    ownerId: number,
    id: string,
    rawInput: PromptUseInput,
  ): Promise<{ prompt: PromptDocument; recorded: boolean }> {
    const input = promptUseInputSchema.parse(rawInput);
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const prompt = await this.getPromptTx(trx, id);
      if (input.idempotencyKey) {
        const existing = await sql<{ id: string }>`
          SELECT id::text FROM app.prompt_usage_events
          WHERE owner_id = ${ownerId} AND idempotency_key = ${input.idempotencyKey}
        `.execute(trx);
        if (existing.rows[0]) return { prompt, recorded: false };
      }
      const inserted = await sql<{ id: string }>`
        INSERT INTO app.prompt_usage_events(owner_id, prompt_id, action, idempotency_key)
        VALUES (${ownerId}, ${id}, ${input.action}, ${input.idempotencyKey ?? null})
        ON CONFLICT DO NOTHING
        RETURNING id::text
      `.execute(trx);
      if (!inserted.rows[0]) return { prompt, recorded: false };
      await sql`
        UPDATE app.prompts SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
        WHERE owner_id = ${ownerId} AND id = ${id}
      `.execute(trx);
      return { prompt: await this.getPromptTx(trx, id), recorded: true };
    });
  }

  async listFolders(
    ownerId: number,
    includeDeleted = false,
  ): Promise<PromptFolder[]> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const result = await sql<FolderRow>`
        SELECT id, name, parent_id, sort_order, version, created_at, updated_at, deleted_at
        FROM app.prompt_folders WHERE ${includeDeleted ? sql`TRUE` : sql`deleted_at IS NULL`}
        ORDER BY sort_order, name, id
      `.execute(trx);
      return result.rows.map(toFolder);
    });
  }

  async createFolder(
    ownerId: number,
    rawInput: NewPromptFolder,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    const input = newPromptFolderSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      if (input.parentId) await this.requireFolder(trx, input.parentId);
      const id = requestedId ?? randomUUID();
      await sql`
        INSERT INTO app.prompt_folders(owner_id, id, name, parent_id, sort_order)
        VALUES (${ownerId}, ${id}, ${input.name}, ${input.parentId}, ${input.sortOrder})
      `.execute(trx);
      const folder = await this.getFolderTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "folder",
        id,
        "upsert",
        folder.version,
        folder,
      );
      return folder;
    });
  }

  async updateFolder(
    ownerId: number,
    id: string,
    rawInput: UpdatePromptFolder,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    const input = updatePromptFolderSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getFolderTx(trx, id);
      if (current.version !== input.expectedVersion)
        throw versionConflict(current);
      if (input.parentId !== undefined && input.parentId) {
        if (input.parentId === id)
          throw new AppError("VALIDATION_FAILED", "文件夹不能嵌套到自身", 400);
        await this.requireFolder(trx, input.parentId);
      }
      const sets = [sql`version = version + 1`, sql`updated_at = now()`];
      if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
      if (input.parentId !== undefined)
        sets.push(sql`parent_id = ${input.parentId}`);
      if (input.sortOrder !== undefined)
        sets.push(sql`sort_order = ${input.sortOrder}`);
      if (sets.length === 2)
        throw new AppError("VALIDATION_FAILED", "没有可更新的字段", 400);
      await sql`UPDATE app.prompt_folders SET ${sql.join(sets, sql`, `)} WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${input.expectedVersion}`.execute(
        trx,
      );
      const folder = await this.getFolderTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "folder",
        id,
        "upsert",
        folder.version,
        folder,
      );
      return folder;
    });
  }

  async deleteFolder(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.changeFolderDeletedState(
      ownerId,
      id,
      expectedVersion,
      true,
      context,
    );
  }

  async restoreFolder(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.changeFolderDeletedState(
      ownerId,
      id,
      expectedVersion,
      false,
      context,
    );
  }

  async listTags(
    ownerId: number,
    includeDeleted = false,
  ): Promise<PromptTag[]> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const result = await sql<TagRow>`
        SELECT id, name, tag_group, color, version, created_at, updated_at, deleted_at
        FROM app.prompt_tags WHERE ${includeDeleted ? sql`TRUE` : sql`deleted_at IS NULL`}
        ORDER BY name, id
      `.execute(trx);
      return result.rows.map(toTag);
    });
  }

  async createTag(
    ownerId: number,
    rawInput: NewPromptTag,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    const input = newPromptTagSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const id = requestedId ?? randomUUID();
      await sql`
        INSERT INTO app.prompt_tags(owner_id, id, name, tag_group, color)
        VALUES (${ownerId}, ${id}, ${input.name}, ${nullable(input.group)}, ${input.color})
      `.execute(trx);
      const tag = await this.getTagTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "tag",
        id,
        "upsert",
        tag.version,
        tag,
      );
      return tag;
    });
  }

  async updateTag(
    ownerId: number,
    id: string,
    rawInput: UpdatePromptTag,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    const input = updatePromptTagSchema.parse(rawInput);
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getTagTx(trx, id);
      if (current.version !== input.expectedVersion)
        throw versionConflict(current);
      const sets = [sql`version = version + 1`, sql`updated_at = now()`];
      if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
      if (input.group !== undefined)
        sets.push(sql`tag_group = ${nullable(input.group)}`);
      if (input.color !== undefined) sets.push(sql`color = ${input.color}`);
      if (sets.length === 2)
        throw new AppError("VALIDATION_FAILED", "没有可更新的字段", 400);
      await sql`UPDATE app.prompt_tags SET ${sql.join(sets, sql`, `)} WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${input.expectedVersion}`.execute(
        trx,
      );
      const tag = await this.getTagTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "tag",
        id,
        "upsert",
        tag.version,
        tag,
      );
      return tag;
    });
  }

  async deleteTag(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.changeTagDeletedState(
      ownerId,
      id,
      expectedVersion,
      true,
      context,
    );
  }

  async restoreTag(
    ownerId: number,
    id: string,
    expectedVersion: number,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.changeTagDeletedState(
      ownerId,
      id,
      expectedVersion,
      false,
      context,
    );
  }

  private async changePromptDeletedState(
    ownerId: number,
    id: string,
    expectedVersion: number,
    deleted: boolean,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getPromptTx(trx, id);
      if (current.version !== expectedVersion) throw versionConflict(current);
      await sql`UPDATE app.prompts SET deleted_at = ${deleted ? sql`now()` : sql`NULL`}, version = version + 1, updated_at = now() WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${expectedVersion}`.execute(
        trx,
      );
      const prompt = await this.getPromptTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "prompt",
        id,
        deleted ? "delete" : "upsert",
        prompt.version,
        prompt,
      );
      return prompt;
    });
  }

  private async changeFolderDeletedState(
    ownerId: number,
    id: string,
    expectedVersion: number,
    deleted: boolean,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getFolderTx(trx, id);
      if (current.version !== expectedVersion) throw versionConflict(current);
      if (!deleted && current.parentId)
        await this.requireFolder(trx, current.parentId);
      if (deleted && !current.deletedAt)
        await this.detachFolderRelations(trx, ownerId, id);
      await sql`UPDATE app.prompt_folders SET deleted_at = ${deleted ? sql`now()` : sql`NULL`}, version = version + 1, updated_at = now() WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${expectedVersion}`.execute(
        trx,
      );
      const folder = await this.getFolderTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "folder",
        id,
        deleted ? "delete" : "upsert",
        folder.version,
        folder,
      );
      return folder;
    });
  }

  private async changeTagDeletedState(
    ownerId: number,
    id: string,
    expectedVersion: number,
    deleted: boolean,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.withOwnerContext(ownerId, context, async (trx) => {
      const current = await this.getTagTx(trx, id);
      if (current.version !== expectedVersion) throw versionConflict(current);
      if (deleted && !current.deletedAt)
        await this.detachTagRelations(trx, ownerId, id);
      await sql`UPDATE app.prompt_tags SET deleted_at = ${deleted ? sql`now()` : sql`NULL`}, version = version + 1, updated_at = now() WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${expectedVersion}`.execute(
        trx,
      );
      const tag = await this.getTagTx(trx, id);
      await this.appendChange(
        trx,
        ownerId,
        "tag",
        id,
        deleted ? "delete" : "upsert",
        tag.version,
        tag,
      );
      return tag;
    });
  }

  private async detachFolderRelations(
    trx: OwnerTransaction,
    ownerId: number,
    folderId: string,
  ): Promise<void> {
    const children = await sql<{ id: string }>`
      SELECT id FROM app.prompt_folders
      WHERE owner_id = ${ownerId} AND parent_id = ${folderId}
    `.execute(trx);
    const prompts = await sql<{ id: string }>`
      SELECT id FROM app.prompts
      WHERE owner_id = ${ownerId} AND folder_id = ${folderId}
    `.execute(trx);
    await sql`
      UPDATE app.prompt_folders
      SET parent_id = NULL, version = version + 1, updated_at = now()
      WHERE owner_id = ${ownerId} AND parent_id = ${folderId}
    `.execute(trx);
    await sql`
      UPDATE app.prompts
      SET folder_id = NULL, version = version + 1, updated_at = now()
      WHERE owner_id = ${ownerId} AND folder_id = ${folderId}
    `.execute(trx);
    for (const child of children.rows) {
      const snapshot = await this.getFolderTx(trx, child.id);
      await this.appendChange(
        trx,
        ownerId,
        "folder",
        child.id,
        snapshot.deletedAt ? "delete" : "upsert",
        snapshot.version,
        snapshot,
      );
    }
    for (const prompt of prompts.rows) {
      const snapshot = await this.getPromptTx(trx, prompt.id);
      await this.appendChange(
        trx,
        ownerId,
        "prompt",
        prompt.id,
        snapshot.deletedAt ? "delete" : "upsert",
        snapshot.version,
        snapshot,
      );
    }
  }

  private async detachTagRelations(
    trx: OwnerTransaction,
    ownerId: number,
    tagId: string,
  ): Promise<void> {
    const prompts = await sql<{ id: string }>`
      SELECT prompt_id AS id FROM app.prompt_tag_links
      WHERE owner_id = ${ownerId} AND tag_id = ${tagId}
    `.execute(trx);
    await sql`
      DELETE FROM app.prompt_tag_links
      WHERE owner_id = ${ownerId} AND tag_id = ${tagId}
    `.execute(trx);
    if (prompts.rows.length) {
      await sql`
        UPDATE app.prompts
        SET version = version + 1, updated_at = now()
        WHERE owner_id = ${ownerId}
          AND id IN (${sql.join(
            prompts.rows.map((prompt) => sql`${prompt.id}`),
            sql`, `,
          )})
      `.execute(trx);
    }
    for (const prompt of prompts.rows) {
      const snapshot = await this.getPromptTx(trx, prompt.id);
      await this.appendChange(
        trx,
        ownerId,
        "prompt",
        prompt.id,
        snapshot.deletedAt ? "delete" : "upsert",
        snapshot.version,
        snapshot,
      );
    }
  }

  private withOwnerContext<T>(
    ownerId: number,
    context: PromptOperationContext | undefined,
    callback: (trx: OwnerTransaction) => Promise<T>,
  ): Promise<T> {
    return context
      ? callback(context.transaction)
      : withOwnerTransaction(this.db, ownerId, callback);
  }

  private async getPromptTx(
    trx: OwnerTransaction,
    id: string,
  ): Promise<PromptDocument> {
    const result = await sql<PromptRow>`
      SELECT
        p.id, p.title, p.description, p.content, p.negative, p.folder_id,
        p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
        p.usage_count, p.last_used_at, p.source, p.source_url, p.version,
        p.created_at, p.updated_at, p.deleted_at,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'group', t.tag_group, 'color', t.color,
          'version', t.version, 'createdAt', t.created_at,
          'updatedAt', t.updated_at, 'deletedAt', t.deleted_at
        ) ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS tags
      FROM app.prompts p
      LEFT JOIN app.prompt_tag_links l ON l.owner_id = p.owner_id AND l.prompt_id = p.id
      LEFT JOIN app.prompt_tags t ON t.owner_id = l.owner_id AND t.id = l.tag_id AND t.deleted_at IS NULL
      WHERE p.id = ${id}
      GROUP BY p.owner_id, p.id, p.title, p.description, p.content, p.negative,
        p.folder_id, p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
        p.usage_count, p.last_used_at, p.source, p.source_url, p.version,
        p.created_at, p.updated_at, p.deleted_at
    `.execute(trx);
    const row = result.rows[0];
    if (!row) throw new AppError("PROMPT_NOT_FOUND", "提示词不存在", 404);
    return toPromptDocument(row);
  }

  private async getFolderTx(
    trx: OwnerTransaction,
    id: string,
  ): Promise<PromptFolder> {
    const result =
      await sql<FolderRow>`SELECT id, name, parent_id, sort_order, version, created_at, updated_at, deleted_at FROM app.prompt_folders WHERE id = ${id}`.execute(
        trx,
      );
    const row = result.rows[0];
    if (!row) throw new AppError("VALIDATION_FAILED", "文件夹不存在", 404);
    return toFolder(row);
  }

  private async getTagTx(
    trx: OwnerTransaction,
    id: string,
  ): Promise<PromptTag> {
    const result =
      await sql<TagRow>`SELECT id, name, tag_group, color, version, created_at, updated_at, deleted_at FROM app.prompt_tags WHERE id = ${id}`.execute(
        trx,
      );
    const row = result.rows[0];
    if (!row) throw new AppError("VALIDATION_FAILED", "标签不存在", 404);
    return toTag(row);
  }

  private async requireFolder(
    trx: OwnerTransaction,
    id: string,
  ): Promise<void> {
    const result =
      await sql`SELECT 1 FROM app.prompt_folders WHERE id = ${id} AND deleted_at IS NULL`.execute(
        trx,
      );
    if (!result.rows[0])
      throw new AppError("VALIDATION_FAILED", "文件夹不存在或已删除", 400);
  }

  private async validateFolderAndTags(
    trx: OwnerTransaction,
    folderId: string | null,
    tagIds: string[],
  ): Promise<void> {
    if (folderId) await this.requireFolder(trx, folderId);
    if (!tagIds.length) return;
    const result = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM app.prompt_tags WHERE id IN (${sql.join(
      tagIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND deleted_at IS NULL`.execute(trx);
    if (Number(result.rows[0]?.count ?? 0) !== new Set(tagIds).size)
      throw new AppError("VALIDATION_FAILED", "存在无效或已删除的标签", 400);
  }

  private async replacePromptTags(
    trx: OwnerTransaction,
    ownerId: number,
    promptId: string,
    tagIds: string[],
  ): Promise<void> {
    await sql`DELETE FROM app.prompt_tag_links WHERE owner_id = ${ownerId} AND prompt_id = ${promptId}`.execute(
      trx,
    );
    if (!tagIds.length) return;
    await sql`
      INSERT INTO app.prompt_tag_links(owner_id, prompt_id, tag_id)
      SELECT ${ownerId}, ${promptId}, tag.id
      FROM app.prompt_tags tag
      WHERE tag.owner_id = ${ownerId}
        AND tag.id IN (${sql.join(
          [...new Set(tagIds)].map((id) => sql`${id}`),
          sql`, `,
        )})
        AND tag.deleted_at IS NULL
    `.execute(trx);
  }

  private async appendChange(
    trx: OwnerTransaction,
    ownerId: number,
    entityType: string,
    entityId: string,
    operation: string,
    version: number,
    snapshot: unknown,
  ): Promise<void> {
    await sql`INSERT INTO app.sync_changes(owner_id, entity_type, entity_id, operation, entity_version, snapshot) VALUES (${ownerId}, ${entityType}, ${entityId}, ${operation}, ${version}, ${JSON.stringify(snapshot)})`.execute(
      trx,
    );
  }
}

function toPromptDocument(row: PromptRow): PromptDocument {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    negative: row.negative,
    folderId: row.folder_id,
    tags: row.tags ?? [],
    modelId: row.model_id,
    params: row.params,
    rating: row.rating,
    isPinned: row.is_pinned,
    pinOrder: row.pin_order,
    usageCount: row.usage_count,
    lastUsedAt: toIsoOrNull(row.last_used_at),
    source: row.source,
    sourceUrl: row.source_url,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

function toFolder(row: FolderRow): PromptFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

function toTag(row: TagRow): PromptTag {
  return {
    id: row.id,
    name: row.name,
    group: row.tag_group,
    color: row.color,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function nullable(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

function versionConflict(current: unknown): AppError {
  return new AppError(
    "PROMPT_VERSION_CONFLICT",
    "提示词已被其他设备更新，请先合并变更",
    409,
    false,
    { current },
  );
}

function encodeCursorForRow(
  row: PromptRow,
  sort: ParsedPromptListQuery["sort"],
): string {
  const value =
    sort === "title-asc"
      ? row.title.toLowerCase()
      : sort === "usage-desc"
        ? String(row.usage_count)
        : toIso(sort === "created-desc" ? row.created_at : row.updated_at);
  return encodeCursor({ value, id: row.id, updatedAt: toIso(row.updated_at) });
}

function encodeCursor(value: {
  value: string;
  id: string;
  updatedAt: string;
}): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): {
  value: string;
  id: string;
  updatedAt: string;
} {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { value?: unknown; id?: unknown; updatedAt?: unknown };
    if (
      typeof parsed.value !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.updatedAt !== "string"
    )
      throw new Error("invalid cursor");
    return { value: parsed.value, id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    throw new AppError("VALIDATION_FAILED", "分页游标无效", 400);
  }
}
