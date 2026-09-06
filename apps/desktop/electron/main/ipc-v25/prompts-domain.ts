// v2.5 桌面 prompts 域桥:contracts 形状 ↔ core SQLite 仓库。
// 映射语义移植自渲染层 runtime/mappers/prompt.ts(有损字段逐条声明);
// M4e 主进程收口后渲染层旧 mapper 随旧壳删除,本文件成为唯一映射点。
// folders/tags 目录 CRUD 旧 IPC 已退役、无仓库,这里直写两张小表;
// 其变更暂不入云同步队列(旧行为亦无该入口),M4e 同步收口统一处理。

import type {
  NewPromptDocument,
  NewPromptFolder,
  NewPromptTag,
  ParsedPromptListQuery,
  PromptDocument,
  PromptFolder,
  PromptPage,
  PromptTag,
  PromptUseInput,
  PromptUseResult,
  UpdatePromptDocument,
  UpdatePromptFolder,
  UpdatePromptTag,
} from '@musefold/contracts';
import {
  entityIdSchema,
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptListQuerySchema,
  promptUseInputSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';
import { resolveLocalContentWorkspace } from '@musefold/core/db/workspaces';
import { getPaths } from '@musefold/core/runtime';
import { resolve, sep } from 'node:path';
import type { ListPromptsQuery, UpdatePromptPatch } from '@musefold/desktop-contracts/ipc';
import type { NewPrompt, Prompt, Tag } from '@musefold/desktop-contracts/models';
import { UNFILED_FOLDER_ID } from '@musefold/domain/constants';
import { ulid } from 'ulid';
import { z } from 'zod';
import { scheduleV25CloudSync as scheduleCloudSync } from './sync-domain';
import { BridgeError, type MethodDef } from './envelope';

/** 桌面表无 version 列;行→文档的合成乐观锁,写回丢弃。 */
const SYNTHETIC_VERSION = 1;

// ---------- 时间与游标 ----------

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

function epochMsToIsoOrNull(ms: number | null | undefined): string | null {
  return ms == null ? null : epochMsToIso(ms);
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

// ---------- 封面:本地路径 ↔ media:// 受管 URL ----------

/** 受管根目录(与 media-protocol.ts 读盘白名单同款约束,防目录穿越)。 */
function managedRoots(): string[] {
  const paths = getPaths();
  return [paths.pictures, paths.previews].map((root) => resolve(root));
}

function isManagedPath(target: string): boolean {
  return managedRoots().some((root) => target === root || target.startsWith(root + sep));
}

/**
 * 本地封面路径 → 契约展示地址。**路径绝不出主进程**:渲染层只拿 media:// URL,
 * 由 media-protocol.ts 在受管根目录内读盘。路径越界(旧库遗留的外部引用)当作无封面。
 */
function coverPathToMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const target = resolve(path);
  if (!isManagedPath(target)) return null;
  return `media://local/?p=${encodeURIComponent(target)}`;
}

/**
 * 契约展示地址 → 本地封面路径(「存为提示词」写首图时的回程)。
 * 只认自家 media://local 且落在受管根目录内的地址;其余(含云端 https)不落盘,
 * 桌面本地库没有远端封面的槽位。
 */
function mediaUrlToCoverPath(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'media:') return null;
  const raw = parsed.searchParams.get('p');
  if (!raw) return null;
  const target = resolve(raw);
  return isManagedPath(target) ? target : null;
}

// ---------- 行 → 文档 ----------

function toCloudTagColor(color: string | null): string | null {
  // 有损:桌面 color 是自由字符串;契约只接受 #RRGGBB,不合规丢弃为 null。
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function tagRowToDocument(tag: Tag): PromptTag {
  const createdAt = epochMsToIso(tag.createdAt);
  return {
    id: tag.id,
    name: tag.name,
    group: tag.tagGroup,
    color: toCloudTagColor(tag.color),
    version: SYNTHETIC_VERSION,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function promptRowToDocument(row: Prompt): PromptDocument {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    negative: row.contentNegative,
    folderId: row.folderId,
    tags: row.tags.map(tagRowToDocument),
    modelId: row.modelId,
    params: row.params,
    rating: row.rating,
    isPinned: row.isPinned,
    pinOrder: row.pinOrder,
    usageCount: row.usageCount,
    lastUsedAt: epochMsToIsoOrNull(row.lastUsedAt),
    source: row.source === 'shared' ? 'share' : row.source,
    sourceUrl: row.sourceUrl,
    // 封面口径承旧 promptsRepo.coverImagePath:相关作品最新一张成功图,
    // 无作品时兜底 preview_image_path(「存为提示词」写入的首图)。
    coverImageUrl: coverPathToMediaUrl(row.coverImagePath),
    version: SYNTHETIC_VERSION,
    createdAt: epochMsToIso(row.createdAt),
    updatedAt: epochMsToIso(row.updatedAt),
    deletedAt: epochMsToIsoOrNull(row.deletedAt),
    // 有损(桌面独有,文档侧无槽位):previewImagePath 的原始路径形态。
  };
}

// ---------- 契约入参 → core 入参 ----------

function cloudSourceToDesktop(source: NonNullable<NewPromptDocument['source']>): Prompt['source'] {
  // 有损:云独有 source=generation 桌面枚举不存在,落为 import。
  if (source === 'generation') return 'import';
  if (source === 'share') return 'shared';
  return source;
}

function toDesktopParams(params: Record<string, unknown> | null | undefined) {
  if (params == null) return undefined;
  const schemaVersion = typeof params.schemaVersion === 'number' ? params.schemaVersion : 1;
  return { ...params, schemaVersion };
}

function newDocumentToRow(input: NewPromptDocument): NewPrompt {
  return {
    title: input.title,
    content: input.content,
    contentNegative: input.negative ?? undefined,
    description: input.description ?? undefined,
    isPinned: input.isPinned,
    folderId: input.folderId ?? undefined,
    modelId: input.modelId ?? undefined,
    params: toDesktopParams(input.params),
    rating: input.rating,
    source: cloudSourceToDesktop(input.source ?? 'manual'),
    sourceUrl: input.sourceUrl ?? undefined,
    // 封面落 preview_image_path(承旧「存为提示词」槽位);越界/远端地址不落盘。
    previewImagePath: mediaUrlToCoverPath(input.coverImageUrl) ?? undefined,
    tagIds: input.tagIds,
  };
}

function updateDocumentToPatch(input: UpdatePromptDocument): UpdatePromptPatch {
  const patch: UpdatePromptPatch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.content !== undefined) patch.content = input.content;
  if (input.negative !== undefined) patch.contentNegative = input.negative;
  if (input.folderId !== undefined) patch.folderId = input.folderId;
  if (input.modelId !== undefined) patch.modelId = input.modelId;
  if (input.params !== undefined) patch.params = toDesktopParams(input.params) ?? null;
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.tagIds !== undefined) patch.tagIds = input.tagIds;
  if (input.source !== undefined) patch.source = cloudSourceToDesktop(input.source);
  // 显式 null 清除封面;缺省不改。远端/越界地址视同清除(本地无槽位存它)。
  if (input.coverImageUrl !== undefined) {
    patch.previewImagePath = mediaUrlToCoverPath(input.coverImageUrl);
  }
  // 有损:expectedVersion(桌面无乐观锁)、pinOrder(置顶序走 togglePin 维护)。
  return patch;
}

function listQueryToRowQuery(query: ParsedPromptListQuery): ListPromptsQuery {
  const mapped: ListPromptsQuery = {
    search: query.q,
    tagIds: query.tagIds,
    sort:
      query.sort === 'created-desc'
        ? 'created'
        : query.sort === 'usage-desc'
          ? 'usage'
          : query.sort === 'title-asc'
            ? 'title'
            : 'updated',
    sortDir: 'desc',
  };
  if (query.folderId === null) {
    mapped.folderId = UNFILED_FOLDER_ID;
  } else if (query.folderId) {
    mapped.folderId = query.folderId;
  }
  if (query.pinnedOnly) mapped.filters = { isPinned: true };
  return mapped;
}

// ---------- prompts ----------

function getDocument(id: string): PromptDocument {
  const row = promptsRepo.get(id);
  if (!row) throw new BridgeError('NOT_FOUND', `提示词不存在:${id}`);
  return promptRowToDocument(row);
}

function listPrompts(query: ParsedPromptListQuery): PromptPage {
  const live = promptsRepo.list(listQueryToRowQuery(query));
  const rows = query.includeDeleted ? [...live, ...promptsRepo.listDeleted()] : live;
  const offset = parseOffsetCursor(query.cursor);
  const slice = rows.slice(offset, offset + query.limit);
  const next = offset + slice.length;
  return {
    items: slice.map(promptRowToDocument),
    nextCursor: next < rows.length ? String(next) : null,
  };
}

function updatePrompt(id: string, input: UpdatePromptDocument): PromptDocument {
  const current = promptsRepo.get(id);
  if (!current) throw new BridgeError('NOT_FOUND', `提示词不存在:${id}`);
  // 置顶状态单走 togglePin 以维护 pin_order(与旧 IPC PROMPTS_TOGGLE_PIN 同语义)。
  if (input.isPinned !== undefined && input.isPinned !== current.isPinned) {
    promptsRepo.togglePin(id, input.isPinned);
  }
  const patch = updateDocumentToPatch({ ...input, isPinned: undefined });
  if (Object.keys(patch).length > 0) promptsRepo.update(id, patch);
  scheduleCloudSync();
  return getDocument(id);
}

function usePrompt(id: string, input: PromptUseInput): PromptUseResult {
  // 桌面本地无幂等表,idempotencyKey 忽略(云侧有);单机重复计数可接受。
  promptsRepo.incrementUsage(id, input.action);
  scheduleCloudSync();
  return { prompt: getDocument(id), recorded: true };
}

// ---------- folders(直写 folders 表;合成 version/updatedAt) ----------

interface FolderRow {
  workspace_id: string;
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

function folderRowToDocument(row: FolderRow): PromptFolder {
  const createdAt = epochMsToIso(row.created_at);
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    version: SYNTHETIC_VERSION,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function getFolderRow(id: string): FolderRow {
  const workspaceId = resolveLocalContentWorkspace(getDb());
  const row = getDb()
    .prepare('SELECT * FROM folders WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, id) as FolderRow | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', `文件夹不存在:${id}`);
  return row;
}

function listFolders(): PromptFolder[] {
  const workspaceId = resolveLocalContentWorkspace(getDb());
  const rows = getDb()
    .prepare('SELECT * FROM folders WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(workspaceId) as FolderRow[];
  return rows.map(folderRowToDocument);
}

function createFolder(input: NewPromptFolder): PromptFolder {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const id = ulid();
  db.prepare(
    'INSERT INTO folders (workspace_id, id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(workspaceId, id, input.name, input.parentId, input.sortOrder, Date.now());
  return folderRowToDocument(getFolderRow(id));
}

function updateFolder(id: string, patch: UpdatePromptFolder): PromptFolder {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const current = getFolderRow(id);
  db.prepare(
    'UPDATE folders SET name = ?, parent_id = ?, sort_order = ? WHERE workspace_id = ? AND id = ?',
  ).run(
    patch.name ?? current.name,
    patch.parentId !== undefined ? patch.parentId : current.parent_id,
    patch.sortOrder ?? current.sort_order,
    workspaceId,
    id,
  );
  return folderRowToDocument(getFolderRow(id));
}

function removeFolder(id: string): PromptFolder {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const doc = folderRowToDocument(getFolderRow(id));
  // 子文件夹随 FK CASCADE 删除;prompts.folder_id 置 NULL(归入未整理)。
  db.prepare('DELETE FROM folders WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  return { ...doc, deletedAt: epochMsToIso(Date.now()) };
}

// ---------- tags(直写 tags 表) ----------

interface TagRow {
  workspace_id: string;
  id: string;
  name: string;
  tag_group: string | null;
  color: string | null;
  created_at: number;
}

function tagTableRowToDocument(row: TagRow): PromptTag {
  return tagRowToDocument({
    id: row.id,
    name: row.name,
    tagGroup: row.tag_group as Tag['tagGroup'],
    color: row.color,
    createdAt: row.created_at,
  });
}

function getTagRow(id: string): TagRow {
  const workspaceId = resolveLocalContentWorkspace(getDb());
  const row = getDb()
    .prepare('SELECT * FROM tags WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, id) as TagRow | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', `标签不存在:${id}`);
  return row;
}

function listTags(): PromptTag[] {
  const workspaceId = resolveLocalContentWorkspace(getDb());
  const rows = getDb()
    .prepare('SELECT * FROM tags WHERE workspace_id = ? ORDER BY name ASC')
    .all(workspaceId) as TagRow[];
  return rows.map(tagTableRowToDocument);
}

function createTag(input: NewPromptTag): PromptTag {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const id = ulid();
  db.prepare(
    'INSERT INTO tags (workspace_id, id, name, tag_group, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(workspaceId, id, input.name, input.group, input.color, Date.now());
  return tagTableRowToDocument(getTagRow(id));
}

function updateTag(id: string, patch: UpdatePromptTag): PromptTag {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const current = getTagRow(id);
  db.prepare(
    'UPDATE tags SET name = ?, tag_group = ?, color = ? WHERE workspace_id = ? AND id = ?',
  ).run(
    patch.name ?? current.name,
    patch.group !== undefined ? patch.group : current.tag_group,
    patch.color !== undefined ? patch.color : current.color,
    workspaceId,
    id,
  );
  return tagTableRowToDocument(getTagRow(id));
}

function removeTag(id: string): PromptTag {
  const db = getDb();
  const workspaceId = resolveLocalContentWorkspace(db);
  const doc = tagTableRowToDocument(getTagRow(id));
  // prompt_tags 随 FK CASCADE 清理。
  db.prepare('DELETE FROM tags WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  return { ...doc, deletedAt: epochMsToIso(Date.now()) };
}

// ---------- 方法表 ----------

const idPayloadSchema = z.object({ id: entityIdSchema });

export function buildPromptsDomainMethods(): Record<string, MethodDef> {
  return {
    'prompts.list': {
      // undefined 归一为 {}:schema 自带 limit/includeDeleted/sort 默认值。
      input: z.preprocess((value) => value ?? {}, promptListQuerySchema),
      handle: async (input) => listPrompts(input as ParsedPromptListQuery),
    },
    'prompts.get': {
      input: idPayloadSchema,
      handle: async (input) => getDocument((input as { id: string }).id),
    },
    'prompts.create': {
      input: newPromptDocumentSchema,
      handle: async (input) => {
        const row = promptsRepo.create(newDocumentToRow(input as NewPromptDocument));
        scheduleCloudSync();
        return promptRowToDocument(row);
      },
    },
    'prompts.update': {
      input: idPayloadSchema.extend({ patch: updatePromptDocumentSchema }),
      handle: async (input) => {
        const { id, patch } = input as { id: string; patch: UpdatePromptDocument };
        return updatePrompt(id, patch);
      },
    },
    'prompts.remove': {
      input: idPayloadSchema,
      handle: async (input) => {
        const { id } = input as { id: string };
        promptsRepo.softDelete(id);
        scheduleCloudSync();
        return getDocument(id);
      },
    },
    'prompts.purge': {
      input: idPayloadSchema,
      handle: async (input) => {
        const { id } = input as { id: string };
        const current = getDocument(id);
        if (current.deletedAt == null) {
          throw new BridgeError('VALIDATION_FAILED', '只能永久删除回收站中的提示词');
        }
        promptsRepo.purge(id);
        return undefined;
      },
    },
    'prompts.emptyTrash': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        // 回收站为空返回 0(幂等);双重确认由渲染层负责。
        const trashed = promptsRepo.listDeleted();
        for (const row of trashed) promptsRepo.purge(row.id);
        if (trashed.length > 0) scheduleCloudSync();
        return { purged: trashed.length };
      },
    },
    'prompts.restore': {
      input: idPayloadSchema,
      handle: async (input) => {
        const { id } = input as { id: string };
        promptsRepo.restore(id);
        scheduleCloudSync();
        return getDocument(id);
      },
    },
    'prompts.use': {
      input: idPayloadSchema.extend({ input: promptUseInputSchema }),
      handle: async (payload) => {
        const { id, input } = payload as { id: string; input: PromptUseInput };
        return usePrompt(id, input);
      },
    },
    'prompts.listFolders': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => listFolders(),
    },
    'prompts.createFolder': {
      input: newPromptFolderSchema,
      handle: async (input) => createFolder(input as NewPromptFolder),
    },
    'prompts.updateFolder': {
      input: idPayloadSchema.extend({ patch: updatePromptFolderSchema }),
      handle: async (input) => {
        const { id, patch } = input as { id: string; patch: UpdatePromptFolder };
        return updateFolder(id, patch);
      },
    },
    'prompts.removeFolder': {
      input: idPayloadSchema,
      handle: async (input) => removeFolder((input as { id: string }).id),
    },
    'prompts.listTags': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => listTags(),
    },
    'prompts.createTag': {
      input: newPromptTagSchema,
      handle: async (input) => createTag(input as NewPromptTag),
    },
    'prompts.updateTag': {
      input: idPayloadSchema.extend({ patch: updatePromptTagSchema }),
      handle: async (input) => {
        const { id, patch } = input as { id: string; patch: UpdatePromptTag };
        return updateTag(id, patch);
      },
    },
    'prompts.removeTag': {
      input: idPayloadSchema,
      handle: async (input) => removeTag((input as { id: string }).id),
    },
  };
}
