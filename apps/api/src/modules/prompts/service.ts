import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
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
  entityIdSchema,
  promptListQuerySchema,
  promptFolderSchema,
  promptTagSchema,
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptUseInputSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  promptFolders,
  promptTagLinks,
  promptTags,
  promptUsageEvents,
  prompts,
} from '@musefold/db';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { type ChangeSource, type DbLike, appendSyncChange } from '../sync/change-log.js';
import { acquireSyncPublication } from '../sync/publication.js';

import {
  lockFolderTopology,
  lockTaxonomyIdentity,
  readTaxonomyTombstone,
  recordTaxonomyTombstone,
} from './taxonomy-deletion.js';

type Tx = DbLike;

/** 供 sync push 复用同一事务与变更来源(设备 + mutationId)。 */
export interface PromptOperationContext {
  tx: Tx;
  source?: ChangeSource;
}

export class PromptService {
  constructor(private readonly db: MusefoldDatabase) {}

  async listPrompts(userId: string, input: ParsedPromptListQuery): Promise<PromptPage> {
    const conditions = [sql`p.user_id = ${userId}`, sql`p.purge_started_at IS NULL`];
    if (input.deletedOnly) conditions.push(sql`p.deleted_at IS NOT NULL`);
    else if (!input.includeDeleted) conditions.push(sql`p.deleted_at IS NULL`);
    if (input.q) {
      const pattern = `%${input.q}%`;
      conditions.push(
        sql`(p.title || ' ' || p.content || ' ' || coalesce(p.description, '')) ILIKE ${pattern}`,
      );
    }
    if (input.folderId !== undefined) {
      conditions.push(
        input.folderId === null ? sql`p.folder_id IS NULL` : sql`p.folder_id = ${input.folderId}`,
      );
    }
    if (input.pinnedOnly) conditions.push(sql`p.is_pinned = true`);
    if (input.tagIds?.length) {
      conditions.push(sql`p.id IN (
        SELECT l.prompt_id FROM prompt_tag_links l
        WHERE l.tag_id IN (${sql.join(
          input.tagIds.map((tagId) => sql`${tagId}`),
          sql`, `,
        )})
        GROUP BY l.prompt_id
        HAVING count(DISTINCT l.tag_id) = ${input.tagIds.length}
      )`);
    }

    const cursor = input.cursor ? decodeCursor(input.cursor, input.sort) : null;
    if (cursor) {
      if (input.sort === 'created-desc') {
        conditions.push(sql`(p.created_at, p.id) < (${cursor.value}::timestamptz, ${cursor.id})`);
      } else if (input.sort === 'usage-desc') {
        conditions.push(
          sql`(p.usage_count, p.updated_at, p.id) < (${Number(cursor.value)}, ${cursor.updatedAt}::timestamptz, ${cursor.id})`,
        );
      } else if (input.sort === 'title-asc') {
        conditions.push(sql`(lower(p.title), p.id) > (${cursor.value}, ${cursor.id})`);
      } else {
        conditions.push(
          sql`(p.is_pinned, p.updated_at, p.id) < (${cursor.isPinned}, ${cursor.value}::timestamptz, ${cursor.id})`,
        );
      }
    }

    const order =
      input.sort === 'created-desc'
        ? sql`p.created_at DESC, p.id DESC`
        : input.sort === 'usage-desc'
          ? sql`p.usage_count DESC, p.updated_at DESC, p.id DESC`
          : input.sort === 'title-asc'
            ? sql`lower(p.title) ASC, p.id ASC`
            : sql`p.is_pinned DESC, p.updated_at DESC, p.id DESC`;

    const result = await this.db.execute(sql`
      ${promptSelectFragment()}
      WHERE ${sql.join(conditions, sql` AND `)}
      ${promptGroupByFragment()}
      ORDER BY ${order}
      LIMIT ${input.limit + 1}
    `);
    const rows = result.rows as unknown as PromptRow[];
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toPromptDocument),
      nextCursor: hasMore && last ? encodeCursorForRow(last, input.sort) : null,
    };
  }

  async getPrompt(
    userId: string,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.getPromptTx(context?.tx ?? this.db, userId, id);
  }

  async getFolder(
    userId: string,
    id: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.getFolderTx(context?.tx ?? this.db, userId, id);
  }

  async getTag(userId: string, id: string, context?: PromptOperationContext): Promise<PromptTag> {
    return this.getTagTx(context?.tx ?? this.db, userId, id);
  }

  async createPrompt(
    userId: string,
    rawInput: NewPromptDocument,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    const input = newPromptDocumentSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      await this.validateFolderAndTags(tx, userId, input.folderId, input.tagIds);
      const id = requestedId ?? randomUUID();
      await tx.insert(prompts).values({
        id,
        userId,
        title: input.title,
        description: nullable(input.description),
        content: input.content,
        negative: nullable(input.negative),
        folderId: input.folderId,
        modelId: input.modelId,
        params: input.params ?? null,
        rating: input.rating,
        isPinned: input.isPinned,
        pinOrder: input.pinOrder ?? null,
        source: input.source,
        sourceUrl: nullable(input.sourceUrl),
        coverImageUrl: input.coverImageUrl ?? null,
      });
      await this.replacePromptTags(tx, userId, id, input.tagIds);
      const prompt = await this.getPromptTx(tx, userId, id);
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        id,
        'upsert',
        prompt.version,
        prompt,
        context?.source,
      );
      return prompt;
    });
  }

  async updatePrompt(
    userId: string,
    id: string,
    rawInput: UpdatePromptDocument,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    const input = updatePromptDocumentSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      const current = await this.getPromptTx(tx, userId, id);
      if (current.version !== input.expectedVersion) throw promptVersionConflict(current);
      if (input.folderId !== undefined || input.tagIds !== undefined) {
        await this.validateFolderAndTags(
          tx,
          userId,
          input.folderId === undefined ? current.folderId : input.folderId,
          input.tagIds ?? current.tags.map((tag) => tag.id),
        );
      }
      const set: Record<string, unknown> = {
        version: sql`${prompts.version} + 1`,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) set.title = input.title;
      if (input.description !== undefined) set.description = nullable(input.description);
      if (input.content !== undefined) set.content = input.content;
      if (input.negative !== undefined) set.negative = nullable(input.negative);
      if (input.folderId !== undefined) set.folderId = input.folderId;
      if (input.modelId !== undefined) set.modelId = input.modelId;
      if (input.params !== undefined) set.params = input.params;
      if (input.rating !== undefined) set.rating = input.rating;
      if (input.isPinned !== undefined) set.isPinned = input.isPinned;
      if (input.pinOrder !== undefined) set.pinOrder = input.pinOrder;
      if (input.source !== undefined) set.source = input.source;
      if (input.sourceUrl !== undefined) set.sourceUrl = nullable(input.sourceUrl);
      // 显式 null = 清除封面;缺省 = 不改。
      if (input.coverImageUrl !== undefined) set.coverImageUrl = input.coverImageUrl;
      if (Object.keys(set).length === 2 && input.tagIds === undefined) {
        throw new AppError('VALIDATION_FAILED', '没有可更新的字段');
      }
      const updated = await tx
        .update(prompts)
        .set(set)
        .where(
          and(
            eq(prompts.userId, userId),
            eq(prompts.id, id),
            eq(prompts.version, input.expectedVersion),
          ),
        )
        .returning({ id: prompts.id });
      // 乐观锁以受影响行数裁决:0 行说明预检通过后、落库前有并发提交,输掉竞态。
      // 必须在替换标签/写变更日志之前抛稳定 CONFLICT,败者事务不得产生任何副作用
      // (行被并发硬删时,重读会抛 PROMPT_NOT_FOUND,同样是准确的稳定错误)。
      if (updated.length === 0) {
        throw promptVersionConflict(await this.getPromptTx(tx, userId, id));
      }
      if (input.tagIds !== undefined) {
        await this.replacePromptTags(tx, userId, id, input.tagIds);
      }
      const prompt = await this.getPromptTx(tx, userId, id);
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        id,
        'upsert',
        prompt.version,
        prompt,
        context?.source,
      );
      return prompt;
    });
  }

  async deletePrompt(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.changePromptDeletedState(userId, id, expectedVersion, true, context);
  }

  async restorePrompt(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.changePromptDeletedState(userId, id, expectedVersion, false, context);
  }

  /** 回收站内永久删除:仅允许已软删的行,硬删并广播 delete 同步事件(幂等)。 */
  async purgePrompt(userId: string, id: string, context?: PromptOperationContext): Promise<void> {
    return this.withTx(context, async (tx) => {
      // Snapshot validation and deletion share the row lock with restore/update.
      // The aggregated prompt query itself cannot use FOR UPDATE.
      await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.userId, userId), eq(prompts.id, id)))
        .for('update');
      const current = await this.getPromptTx(tx, userId, id);
      if (current.deletedAt == null) {
        throw new AppError('VALIDATION_FAILED', '只能永久删除回收站中的提示词');
      }
      // 标签关联经外键 onDelete cascade 清理;usage 事件为软引用留作审计。
      await tx.delete(prompts).where(and(eq(prompts.userId, userId), eq(prompts.id, id)));
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        id,
        'delete',
        current.version + 1,
        current,
        context?.source,
      );
    });
  }

  /**
   * 清空回收站:一次性硬删该用户全部已软删提示词,逐行广播 delete 同步事件。
   * 回收站为空时返回 0(幂等,不报错)——UI 的双重确认负责防误触。
   */
  async emptyTrash(userId: string, context?: PromptOperationContext): Promise<{ purged: number }> {
    return this.withTx(context, async (tx) => {
      const trashed = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(
          and(
            eq(prompts.userId, userId),
            isNotNull(prompts.deletedAt),
            isNull(prompts.purgeStartedAt),
          ),
        )
        .orderBy(prompts.id)
        .for('update');
      if (trashed.length === 0) return { purged: 0 };
      // 快照必须在硬删之前取:变更日志要带被删行的最后状态。
      const snapshots = await Promise.all(
        trashed.map((row) => this.getPromptTx(tx, userId, row.id)),
      );
      // Delete exactly the locked snapshot set: newly trashed rows belong to a later action.
      await tx.delete(prompts).where(
        and(
          eq(prompts.userId, userId),
          inArray(
            prompts.id,
            trashed.map((row) => row.id),
          ),
        ),
      );
      for (const snapshot of snapshots) {
        await appendSyncChange(
          tx,
          userId,
          'prompt',
          snapshot.id,
          'delete',
          snapshot.version + 1,
          snapshot,
          context?.source,
        );
      }
      return { purged: snapshots.length };
    });
  }

  async usePrompt(
    userId: string,
    id: string,
    rawInput: PromptUseInput & { eventId?: string; deviceId?: string },
  ): Promise<{ prompt: PromptDocument; recorded: boolean }> {
    const input = promptUseInputSchema.parse(rawInput);
    const eventId = rawInput.eventId ?? input.idempotencyKey ?? randomUUID();
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.userId, userId), eq(prompts.id, id), isNull(prompts.purgeStartedAt)))
        .for('key share');
      const prompt = await this.getPromptTx(tx, userId, id);
      const inserted = await tx
        .insert(promptUsageEvents)
        .values({
          userId,
          eventId,
          promptId: id,
          action: input.action,
          deviceId: rawInput.deviceId ?? null,
        })
        .onConflictDoNothing()
        .returning({ eventId: promptUsageEvents.eventId });
      if (!inserted[0]) return { prompt, recorded: false };
      await tx
        .update(prompts)
        .set({
          usageCount: sql`${prompts.usageCount} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(prompts.userId, userId), eq(prompts.id, id)));
      return { prompt: await this.getPromptTx(tx, userId, id), recorded: true };
    });
  }

  async listFolders(userId: string, includeDeleted = false): Promise<PromptFolder[]> {
    const rows = await this.db
      .select()
      .from(promptFolders)
      .where(
        includeDeleted
          ? eq(promptFolders.userId, userId)
          : and(eq(promptFolders.userId, userId), isNull(promptFolders.deletedAt)),
      )
      .orderBy(asc(promptFolders.sortOrder), asc(promptFolders.name), asc(promptFolders.id));
    return rows.map(toFolder);
  }

  async createFolder(
    userId: string,
    rawInput: NewPromptFolder,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    const input = newPromptFolderSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      const id = requestedId ?? randomUUID();
      await lockFolderTopology(tx, userId);
      await lockTaxonomyIdentity(tx, userId, 'folder', id);
      const tombstone = await readTaxonomyTombstone(tx, userId, 'folder', id);
      if (tombstone) throw promptVersionConflict(tombstone);
      await this.validateFolderParent(tx, userId, id, input.parentId);
      await tx.insert(promptFolders).values({
        id,
        userId,
        name: input.name,
        parentId: input.parentId,
        sortOrder: input.sortOrder,
      });
      const folder = await this.getFolderTx(tx, userId, id);
      await appendSyncChange(
        tx,
        userId,
        'folder',
        id,
        'upsert',
        folder.version,
        folder,
        context?.source,
      );
      return folder;
    });
  }

  async updateFolder(
    userId: string,
    id: string,
    rawInput: UpdatePromptFolder,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    const input = updatePromptFolderSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      await lockFolderTopology(tx, userId);
      await lockTaxonomyIdentity(tx, userId, 'folder', id);
      const current = await this.getFolderTx(tx, userId, id);
      if (current.deletedAt || current.version !== input.expectedVersion)
        throw promptVersionConflict(current);
      if (input.parentId !== undefined)
        await this.validateFolderParent(tx, userId, id, input.parentId);
      const set: Record<string, unknown> = {
        version: sql`${promptFolders.version} + 1`,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) set.name = input.name;
      if (input.parentId !== undefined) set.parentId = input.parentId;
      if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
      if (Object.keys(set).length === 2) {
        throw new AppError('VALIDATION_FAILED', '没有可更新的字段');
      }
      const updated = await tx
        .update(promptFolders)
        .set(set)
        .where(
          and(
            eq(promptFolders.userId, userId),
            eq(promptFolders.id, id),
            eq(promptFolders.version, input.expectedVersion),
          ),
        )
        .returning({ id: promptFolders.id });
      // 同一裁决:0 行即输掉竞态,重读事实状态后抛稳定 CONFLICT,不追加变更日志。
      if (updated.length === 0) {
        throw promptVersionConflict(await this.getFolderTx(tx, userId, id));
      }
      const folder = await this.getFolderTx(tx, userId, id);
      await appendSyncChange(
        tx,
        userId,
        'folder',
        id,
        'upsert',
        folder.version,
        folder,
        context?.source,
      );
      return folder;
    });
  }

  async deleteFolder(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.hardDeleteFolder(userId, id, expectedVersion, context);
  }

  async restoreFolder(
    _userId: string,
    _id: string,
    _expectedVersion: number | undefined,
    _context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    throw new AppError('VALIDATION_FAILED', '文件夹已永久删除，不能恢复', 409);
  }

  async listTags(userId: string, includeDeleted = false): Promise<PromptTag[]> {
    const rows = await this.db
      .select()
      .from(promptTags)
      .where(
        includeDeleted
          ? eq(promptTags.userId, userId)
          : and(eq(promptTags.userId, userId), isNull(promptTags.deletedAt)),
      )
      .orderBy(asc(promptTags.name), asc(promptTags.id));
    return rows.map(toTag);
  }

  async createTag(
    userId: string,
    rawInput: NewPromptTag,
    requestedId?: string,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    const input = newPromptTagSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      const id = requestedId ?? randomUUID();
      await lockTaxonomyIdentity(tx, userId, 'tag', id);
      const tombstone = await readTaxonomyTombstone(tx, userId, 'tag', id);
      if (tombstone) throw promptVersionConflict(tombstone);
      await tx.insert(promptTags).values({
        id,
        userId,
        name: input.name,
        group: nullable(input.group),
        color: input.color,
      });
      const tag = await this.getTagTx(tx, userId, id);
      await appendSyncChange(tx, userId, 'tag', id, 'upsert', tag.version, tag, context?.source);
      return tag;
    });
  }

  async updateTag(
    userId: string,
    id: string,
    rawInput: UpdatePromptTag,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    const input = updatePromptTagSchema.parse(rawInput);
    return this.withTx(context, async (tx) => {
      await lockTaxonomyIdentity(tx, userId, 'tag', id);
      const current = await this.getTagTx(tx, userId, id);
      if (current.deletedAt || current.version !== input.expectedVersion)
        throw promptVersionConflict(current);
      const set: Record<string, unknown> = {
        version: sql`${promptTags.version} + 1`,
        updatedAt: new Date(),
      };
      if (input.name !== undefined) set.name = input.name;
      if (input.group !== undefined) set.group = nullable(input.group);
      if (input.color !== undefined) set.color = input.color;
      if (Object.keys(set).length === 2) {
        throw new AppError('VALIDATION_FAILED', '没有可更新的字段');
      }
      const updated = await tx
        .update(promptTags)
        .set(set)
        .where(
          and(
            eq(promptTags.userId, userId),
            eq(promptTags.id, id),
            eq(promptTags.version, input.expectedVersion),
          ),
        )
        .returning({ id: promptTags.id });
      // 同一裁决:0 行即输掉竞态,重读事实状态后抛稳定 CONFLICT,不追加变更日志。
      if (updated.length === 0) {
        throw promptVersionConflict(await this.getTagTx(tx, userId, id));
      }
      const tag = await this.getTagTx(tx, userId, id);
      await appendSyncChange(tx, userId, 'tag', id, 'upsert', tag.version, tag, context?.source);
      return tag;
    });
  }

  async deleteTag(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.hardDeleteTag(userId, id, expectedVersion, context);
  }

  async restoreTag(
    _userId: string,
    _id: string,
    _expectedVersion: number | undefined,
    _context?: PromptOperationContext,
  ): Promise<PromptTag> {
    throw new AppError('VALIDATION_FAILED', '标签已永久删除，不能恢复', 409);
  }

  private async changePromptDeletedState(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    deleted: boolean,
    context?: PromptOperationContext,
  ): Promise<PromptDocument> {
    return this.withTx(context, async (tx) => {
      const current = await this.getPromptTx(tx, userId, id);
      // 缺省 expectedVersion 视为无条件执行(api-client remove/restore 不携带版本)。
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw promptVersionConflict(current);
      }
      const updated = await tx
        .update(prompts)
        .set({
          deletedAt: deleted ? new Date() : null,
          version: sql`${prompts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(prompts.userId, userId),
            eq(prompts.id, id),
            isNull(prompts.purgeStartedAt),
            // 无条件路径不设版本谓词,靠 version = version + 1 原子自增,删除/恢复必然落库;
            // 显式版本路径由谓词 + 受影响行数做乐观锁裁决。
            expectedVersion !== undefined ? eq(prompts.version, expectedVersion) : undefined,
          ),
        )
        .returning({ id: prompts.id });
      // 0 行 = 显式版本输给并发提交(或行被并发硬删):在写变更日志之前以稳定错误终止。
      if (updated.length === 0) {
        throw promptVersionConflict(await this.getPromptTx(tx, userId, id));
      }
      const prompt = await this.getPromptTx(tx, userId, id);
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        id,
        deleted ? 'delete' : 'upsert',
        prompt.version,
        prompt,
        context?.source,
      );
      return prompt;
    });
  }

  private async hardDeleteFolder(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptFolder> {
    return this.withTx(context, async (tx) => {
      await lockFolderTopology(tx, userId);
      await lockTaxonomyIdentity(tx, userId, 'folder', id);
      const previous = await readTaxonomyTombstone(tx, userId, 'folder', id);
      if (previous) {
        if (expectedVersion !== undefined && previous.version !== expectedVersion)
          throw promptVersionConflict(previous);
        return promptFolderSchema.parse(previous);
      }
      // Lock before detach: reference writers hold KEY SHARE until their transaction commits.
      await tx
        .select({ id: promptFolders.id })
        .from(promptFolders)
        .where(and(eq(promptFolders.userId, userId), eq(promptFolders.id, id)))
        .for('update');
      const current = await this.getFolderTx(tx, userId, id);
      if (expectedVersion !== undefined && current.version !== expectedVersion)
        throw promptVersionConflict(current);
      const deletedAt = current.deletedAt ?? new Date().toISOString();
      const snapshot = promptFolderSchema.parse({
        ...current,
        deletedAt,
        updatedAt: deletedAt,
        version: current.deletedAt ? current.version : current.version + 1,
      });
      await this.detachFolderRelations(tx, userId, id, context?.source);
      await recordTaxonomyTombstone(tx, userId, 'folder', snapshot);
      await tx
        .delete(promptFolders)
        .where(and(eq(promptFolders.userId, userId), eq(promptFolders.id, id)));
      await appendSyncChange(
        tx,
        userId,
        'folder',
        id,
        'delete',
        snapshot.version,
        snapshot,
        context?.source,
      );
      return snapshot;
    });
  }

  private async hardDeleteTag(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    context?: PromptOperationContext,
  ): Promise<PromptTag> {
    return this.withTx(context, async (tx) => {
      await lockTaxonomyIdentity(tx, userId, 'tag', id);
      const previous = await readTaxonomyTombstone(tx, userId, 'tag', id);
      if (previous) {
        if (expectedVersion !== undefined && previous.version !== expectedVersion)
          throw promptVersionConflict(previous);
        return promptTagSchema.parse(previous);
      }
      await tx
        .select({ id: promptTags.id })
        .from(promptTags)
        .where(and(eq(promptTags.userId, userId), eq(promptTags.id, id)))
        .for('update');
      const current = await this.getTagTx(tx, userId, id);
      if (expectedVersion !== undefined && current.version !== expectedVersion)
        throw promptVersionConflict(current);
      const deletedAt = current.deletedAt ?? new Date().toISOString();
      const snapshot = promptTagSchema.parse({
        ...current,
        deletedAt,
        updatedAt: deletedAt,
        version: current.deletedAt ? current.version : current.version + 1,
      });
      await this.detachTagRelations(tx, userId, id, context?.source);
      await recordTaxonomyTombstone(tx, userId, 'tag', snapshot);
      await tx.delete(promptTags).where(and(eq(promptTags.userId, userId), eq(promptTags.id, id)));
      await appendSyncChange(
        tx,
        userId,
        'tag',
        id,
        'delete',
        snapshot.version,
        snapshot,
        context?.source,
      );
      return snapshot;
    });
  }

  /** 删除文件夹时把子文件夹与提示词摘出来(置空引用 + 版本递增 + 变更日志)。 */
  private async detachFolderRelations(
    tx: Tx,
    userId: string,
    folderId: string,
    source?: ChangeSource,
  ): Promise<void> {
    const children = await tx
      .select({ id: promptFolders.id })
      .from(promptFolders)
      .where(and(eq(promptFolders.userId, userId), eq(promptFolders.parentId, folderId)));
    const affectedPrompts = await tx
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.userId, userId), eq(prompts.folderId, folderId)))
      .orderBy(prompts.id)
      .for('update');
    await tx
      .update(promptFolders)
      .set({ parentId: null, version: sql`${promptFolders.version} + 1`, updatedAt: new Date() })
      .where(and(eq(promptFolders.userId, userId), eq(promptFolders.parentId, folderId)));
    await tx
      .update(prompts)
      .set({ folderId: null, version: sql`${prompts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(prompts.userId, userId), eq(prompts.folderId, folderId)));
    for (const child of children) {
      const snapshot = await this.getFolderTx(tx, userId, child.id);
      await appendSyncChange(
        tx,
        userId,
        'folder',
        child.id,
        snapshot.deletedAt ? 'delete' : 'upsert',
        snapshot.version,
        snapshot,
        source,
      );
    }
    for (const prompt of affectedPrompts) {
      const snapshot = await this.getPromptTx(tx, userId, prompt.id);
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        prompt.id,
        snapshot.deletedAt ? 'delete' : 'upsert',
        snapshot.version,
        snapshot,
        source,
      );
    }
  }

  private async detachTagRelations(
    tx: Tx,
    userId: string,
    tagId: string,
    source?: ChangeSource,
  ): Promise<void> {
    // Match purge/update lock order: lock Prompt rows before deleting their links.
    const linked = (
      await tx.execute<{ promptId: string }>(sql`
      SELECT p.id AS "promptId" FROM prompts p
      WHERE p.user_id = ${userId} AND EXISTS (
        SELECT 1 FROM prompt_tag_links l WHERE l.prompt_id = p.id AND l.tag_id = ${tagId}
      ) ORDER BY p.id FOR UPDATE OF p
    `)
    ).rows;
    await tx.delete(promptTagLinks).where(eq(promptTagLinks.tagId, tagId));
    const promptIds = linked.map((row) => row.promptId);
    if (promptIds.length) {
      await tx
        .update(prompts)
        .set({ version: sql`${prompts.version} + 1`, updatedAt: new Date() })
        .where(and(eq(prompts.userId, userId), inArray(prompts.id, promptIds)));
    }
    for (const promptId of promptIds) {
      const snapshot = await this.getPromptTx(tx, userId, promptId);
      await appendSyncChange(
        tx,
        userId,
        'prompt',
        promptId,
        snapshot.deletedAt ? 'delete' : 'upsert',
        snapshot.version,
        snapshot,
        source,
      );
    }
  }

  private withTx<T>(
    context: PromptOperationContext | undefined,
    callback: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const execute = async (tx: Tx) => {
      await acquireSyncPublication(tx, 'write');
      return callback(tx);
    };
    return context ? execute(context.tx) : this.db.transaction(execute);
  }

  private async getPromptTx(tx: Tx, userId: string, id: string): Promise<PromptDocument> {
    const result = await tx.execute(sql`
      ${promptSelectFragment()}
      WHERE p.user_id = ${userId} AND p.id = ${id} AND p.purge_started_at IS NULL
      ${promptGroupByFragment()}
    `);
    const row = (result.rows as unknown as PromptRow[])[0];
    if (!row) throw new AppError('PROMPT_NOT_FOUND', '提示词不存在');
    return toPromptDocument(row);
  }

  private async getFolderTx(tx: Tx, userId: string, id: string): Promise<PromptFolder> {
    const rows = await tx
      .select()
      .from(promptFolders)
      .where(and(eq(promptFolders.userId, userId), eq(promptFolders.id, id)));
    if (!rows[0]) {
      const marker = await readTaxonomyTombstone(tx, userId, 'folder', id);
      if (marker) return promptFolderSchema.parse(marker);
      throw new AppError('VALIDATION_FAILED', '文件夹不存在', 404);
    }
    return toFolder(rows[0]);
  }

  private async getTagTx(tx: Tx, userId: string, id: string): Promise<PromptTag> {
    const rows = await tx
      .select()
      .from(promptTags)
      .where(and(eq(promptTags.userId, userId), eq(promptTags.id, id)));
    if (!rows[0]) {
      const marker = await readTaxonomyTombstone(tx, userId, 'tag', id);
      if (marker) return promptTagSchema.parse(marker);
      throw new AppError('VALIDATION_FAILED', '标签不存在', 404);
    }
    return toTag(rows[0]);
  }

  private async validateFolderParent(
    tx: Tx,
    userId: string,
    id: string,
    parentId: string | null,
  ): Promise<void> {
    const seen = new Set([id]);
    let next = parentId;
    while (next) {
      if (seen.has(next))
        throw new AppError('VALIDATION_FAILED', '文件夹不能移动到自身或子文件夹中');
      seen.add(next);
      await this.requireFolder(tx, userId, next);
      next = (await this.getFolderTx(tx, userId, next)).parentId;
    }
  }

  private async requireFolder(tx: Tx, userId: string, id: string): Promise<void> {
    const rows = await tx
      .select({ id: promptFolders.id })
      .from(promptFolders)
      .where(
        and(
          eq(promptFolders.userId, userId),
          eq(promptFolders.id, id),
          isNull(promptFolders.deletedAt),
        ),
      )
      .for('key share');
    if (!rows[0]) throw new AppError('VALIDATION_FAILED', '文件夹不存在或已删除');
  }

  private async validateFolderAndTags(
    tx: Tx,
    userId: string,
    folderId: string | null,
    tagIds: string[],
  ): Promise<void> {
    if (folderId) await this.requireFolder(tx, userId, folderId);
    if (!tagIds.length) return;
    const unique = [...new Set(tagIds)];
    const rows = await tx
      .select({ id: promptTags.id })
      .from(promptTags)
      .where(
        and(
          eq(promptTags.userId, userId),
          inArray(promptTags.id, unique),
          isNull(promptTags.deletedAt),
        ),
      )
      .orderBy(promptTags.id)
      .for('key share');
    if (rows.length !== unique.length) {
      throw new AppError('VALIDATION_FAILED', '存在无效或已删除的标签');
    }
  }

  private async replacePromptTags(
    tx: Tx,
    userId: string,
    promptId: string,
    tagIds: string[],
  ): Promise<void> {
    await tx.delete(promptTagLinks).where(eq(promptTagLinks.promptId, promptId));
    const unique = [...new Set(tagIds)];
    if (!unique.length) return;
    const validTags = await tx
      .select({ id: promptTags.id })
      .from(promptTags)
      .where(
        and(
          eq(promptTags.userId, userId),
          inArray(promptTags.id, unique),
          isNull(promptTags.deletedAt),
        ),
      );
    if (!validTags.length) return;
    await tx.insert(promptTagLinks).values(validTags.map((tag) => ({ promptId, tagId: tag.id })));
  }
}

interface PromptRow {
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
  source: PromptDocument['source'];
  source_url: string | null;
  cover_image_url: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  tags: PromptDocument['tags'];
  // Cursor-only SQL projections preserve PostgreSQL precision and collation normalization.
  pagination_created_at: string;
  pagination_updated_at: string;
  pagination_title: string;
}

function promptSelectFragment() {
  return sql`
    SELECT
      p.id, p.title, p.description, p.content, p.negative, p.folder_id,
      p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
      p.usage_count, p.last_used_at, p.source, p.source_url, p.cover_image_url, p.version,
      p.created_at, p.updated_at, p.deleted_at,
      to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pagination_created_at,
      to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS pagination_updated_at,
      lower(p.title) AS pagination_title,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'group', t.group_name, 'color', t.color,
        'version', t.version, 'createdAt', t.created_at,
        'updatedAt', t.updated_at, 'deletedAt', t.deleted_at
      ) ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS tags
    FROM prompts p
    LEFT JOIN prompt_tag_links l ON l.prompt_id = p.id
    LEFT JOIN prompt_tags t ON t.id = l.tag_id AND t.deleted_at IS NULL
  `;
}

function promptGroupByFragment() {
  return sql`
    GROUP BY p.id, p.title, p.description, p.content, p.negative,
      p.folder_id, p.model_id, p.params, p.rating, p.is_pinned, p.pin_order,
      p.usage_count, p.last_used_at, p.source, p.source_url, p.cover_image_url, p.version,
      p.created_at, p.updated_at, p.deleted_at
  `;
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
    coverImageUrl: row.cover_image_url,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

function toFolder(row: typeof promptFolders.$inferSelect): PromptFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function toTag(row: typeof promptTags.$inferSelect): PromptTag {
  return {
    id: row.id,
    name: row.name,
    group: row.group,
    color: row.color,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function nullable(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

function promptVersionConflict(current: unknown): AppError {
  return new AppError('PROMPT_VERSION_CONFLICT', '内容已被其他设备更新，请先合并变更', 409, false, {
    current,
  });
}

// Versioned private cursor; public entities keep their existing ISO timestamp shape.
// Legacy cursors omit pin state and database microseconds, so resuming them cannot be exact.
const cursorTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => !value.startsWith('0000-'));
const promptCursorSchema = z
  .object({
    version: z.literal(1),
    sort: promptListQuerySchema.shape.sort.removeDefault(),
    id: entityIdSchema.refine((value) => !value.includes('\0')),
    value: z
      .string()
      .max(160)
      .refine((value) => !value.includes('\0')),
    updatedAt: cursorTimestampSchema,
    isPinned: z.boolean(),
  })
  .strict()
  .superRefine((cursor, ctx) => {
    const validValue =
      cursor.sort === 'title-asc' ||
      (cursor.sort === 'usage-desc'
        ? /^(0|[1-9]\d{0,9})$/.test(cursor.value) && Number(cursor.value) <= 2147483647
        : cursorTimestampSchema.safeParse(cursor.value).success);
    if (!validValue)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid sort boundary' });
  });

function encodeCursorForRow(row: PromptRow, sort: ParsedPromptListQuery['sort']): string {
  const value =
    sort === 'title-asc'
      ? row.pagination_title
      : sort === 'usage-desc'
        ? String(row.usage_count)
        : sort === 'created-desc'
          ? row.pagination_created_at
          : row.pagination_updated_at;
  const cursor: z.infer<typeof promptCursorSchema> = {
    version: 1,
    sort,
    value,
    id: row.id,
    updatedAt: row.pagination_updated_at,
    isPinned: row.is_pinned,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string,
  sort: ParsedPromptListQuery['sort'],
): z.infer<typeof promptCursorSchema> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('invalid encoding');
    const parsed = promptCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.sort !== sort) throw new Error('sort changed');
    return parsed;
  } catch {
    throw new AppError('VALIDATION_FAILED', '分页游标无效或已过期，请刷新列表');
  }
}
