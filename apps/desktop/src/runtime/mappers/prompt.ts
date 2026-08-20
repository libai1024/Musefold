// 桌面 Prompt 行模型 ↔ contracts PromptDocument。有损字段在对应转换处逐条声明。

import type {
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  PromptPage,
  PromptTag,
  UpdatePromptDocument,
} from '@musefold/contracts';
import { UNFILED_FOLDER_ID } from '@musefold/domain/constants';
import type { ListPromptsQuery, UpdatePromptPatch } from '@musefold/desktop-contracts/ipc';
import type { NewPrompt, Prompt, PromptParams, Tag } from '@musefold/desktop-contracts/models';
import type { PromptSource as DesktopPromptSource, TagGroup } from '@musefold/desktop-contracts/enums';
import {
  epochMsToIso,
  epochMsToIsoOrNull,
  isoToEpochMs,
  isoToEpochMsOrNull,
  nextOffsetCursor,
  parseOffsetCursor,
  resolvePageLimit,
} from './time';

/** 桌面 prompts 表无 version 列。行→文档时的占位乐观锁；写回丢弃。 */
export const DESKTOP_SYNTHETIC_ENTITY_VERSION = 1;

const TAG_GROUPS = new Set<string>(['风格', '场景', '模型', '主体', '画质', '自定义']);

const DESKTOP_TO_CLOUD_SOURCE = {
  manual: 'manual',
  import: 'import',
  shared: 'share',
  slip: 'slip',
} as const satisfies Record<DesktopPromptSource, PromptDocument['source']>;

type CloudPromptSource = PromptDocument['source'];

/**
 * 行→文档可逆字段（测试锁往返）。不含 previewImagePath / coverImagePath / version。
 */
export const REVERSIBLE_PROMPT_ROW_KEYS = [
  'id',
  'title',
  'description',
  'content',
  'contentNegative',
  'folderId',
  'modelId',
  'params',
  'rating',
  'isPinned',
  'pinOrder',
  'usageCount',
  'lastUsedAt',
  'source',
  'sourceUrl',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const;

export type ReversiblePromptRow = Pick<Prompt, (typeof REVERSIBLE_PROMPT_ROW_KEYS)[number]> & {
  tags: Array<Pick<Tag, 'id' | 'name' | 'tagGroup' | 'color' | 'createdAt'>>;
};

export function pickReversiblePromptRow(row: Prompt): ReversiblePromptRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    contentNegative: row.contentNegative,
    folderId: row.folderId,
    modelId: row.modelId,
    params: row.params,
    rating: row.rating,
    isPinned: row.isPinned,
    pinOrder: row.pinOrder,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    source: row.source,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    tags: row.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      tagGroup: tag.tagGroup,
      color: tag.color,
      createdAt: tag.createdAt,
    })),
  };
}

export function desktopSourceToCloud(source: DesktopPromptSource): CloudPromptSource {
  return DESKTOP_TO_CLOUD_SOURCE[source];
}

export function cloudSourceToDesktop(source: CloudPromptSource): DesktopPromptSource {
  // 有损：云独有 source=generation 在桌面枚举里不存在，落为 import。
  if (source === 'generation') return 'import';
  if (source === 'share') return 'shared';
  return source;
}

function toCloudTagColor(color: string | null): string | null {
  // 有损：桌面 color 是自由字符串；云契约只接受 #RRGGBB。不合规则丢弃为 null。
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return null;
}

function toTagGroup(group: string | null): TagGroup | null {
  if (group == null) return null;
  if (TAG_GROUPS.has(group)) return group as TagGroup;
  // 有损：云 group 是自由字符串，对不上桌面 TagGroup 时落为「自定义」。
  return '自定义';
}

function tagRowToDocument(tag: Tag): PromptTag {
  const createdAt = epochMsToIso(tag.createdAt);
  return {
    id: tag.id,
    name: tag.name,
    group: tag.tagGroup,
    color: toCloudTagColor(tag.color),
    // 有损：桌面 Tag 无 version / updatedAt / deletedAt。
    version: DESKTOP_SYNTHETIC_ENTITY_VERSION,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function promptTagToRow(tag: PromptTag): Tag {
  return {
    id: tag.id,
    name: tag.name,
    tagGroup: toTagGroup(tag.group),
    color: tag.color,
    createdAt: isoToEpochMs(tag.createdAt),
  };
}

function toDesktopParams(
  params: Record<string, unknown> | null | undefined,
): PromptParams | null {
  if (params == null) return null;
  const schemaVersion =
    typeof params.schemaVersion === 'number' ? params.schemaVersion : 1;
  // 有损：云 params 是自由 record；桌面 PromptParams 要求 schemaVersion，缺则补 1。
  return { ...params, schemaVersion };
}

export function promptRowToDocument(row: Prompt): PromptDocument {
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
    source: desktopSourceToCloud(row.source),
    sourceUrl: row.sourceUrl,
    version: DESKTOP_SYNTHETIC_ENTITY_VERSION,
    createdAt: epochMsToIso(row.createdAt),
    updatedAt: epochMsToIso(row.updatedAt),
    deletedAt: epochMsToIsoOrNull(row.deletedAt),
    // 有损（桌面独有，文档侧无槽位，直接丢弃）：
    // - previewImagePath：本地预览图路径
    // - coverImagePath：派生封面路径（最新关联成功作品）
  };
}

/**
 * 文档→行，供往返测试与写回组装。桌面独有路径字段无来源，填 null。
 */
export function promptDocumentToRow(doc: PromptDocument): Prompt {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    content: doc.content,
    contentNegative: doc.negative,
    folderId: doc.folderId,
    modelId: doc.modelId,
    params: toDesktopParams(doc.params),
    previewImagePath: null,
    coverImagePath: null,
    rating: doc.rating,
    isPinned: doc.isPinned,
    pinOrder: doc.pinOrder,
    usageCount: doc.usageCount,
    lastUsedAt: isoToEpochMsOrNull(doc.lastUsedAt),
    source: cloudSourceToDesktop(doc.source),
    sourceUrl: doc.sourceUrl,
    tags: doc.tags.map(promptTagToRow),
    createdAt: isoToEpochMs(doc.createdAt),
    updatedAt: isoToEpochMs(doc.updatedAt),
    deletedAt: isoToEpochMsOrNull(doc.deletedAt),
  };
}

export function newPromptDocumentToRow(input: NewPromptDocument): NewPrompt {
  const row: NewPrompt = {
    title: input.title,
    content: input.content,
    contentNegative: input.negative ?? undefined,
    description: input.description ?? undefined,
    isPinned: input.isPinned,
    folderId: input.folderId ?? undefined,
    modelId: input.modelId ?? undefined,
    params: toDesktopParams(input.params) ?? undefined,
    rating: input.rating,
    source: cloudSourceToDesktop(input.source ?? 'manual'),
    sourceUrl: input.sourceUrl ?? undefined,
    tagIds: input.tagIds,
  };
  // 有损：NewPrompt 无 pinOrder；云 NewPromptDocument.pinOrder 写不进 IPC。
  return row;
}

export function updatePromptDocumentToPatch(input: UpdatePromptDocument): UpdatePromptPatch {
  const patch: UpdatePromptPatch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.content !== undefined) patch.content = input.content;
  if (input.negative !== undefined) patch.contentNegative = input.negative;
  if (input.isPinned !== undefined) patch.isPinned = input.isPinned;
  if (input.folderId !== undefined) patch.folderId = input.folderId;
  if (input.modelId !== undefined) patch.modelId = input.modelId;
  if (input.params !== undefined) patch.params = toDesktopParams(input.params);
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.tagIds !== undefined) patch.tagIds = input.tagIds;
  if (input.source !== undefined) patch.source = cloudSourceToDesktop(input.source);
  // 有损：
  // - expectedVersion：桌面无乐观锁，丢弃。
  // - pinOrder：UpdatePromptPatch 无此字段；桌面改置顶序走 reorderPins，不在本端口。
  // - sourceUrl：UpdatePromptPatch 无此字段，更新时丢弃。
  return patch;
}

export function promptListQueryToRowQuery(query: PromptListQuery): ListPromptsQuery {
  const sort = query.sort ?? 'updated-desc';
  const mapped: ListPromptsQuery = {
    search: query.q,
    tagIds: query.tagIds,
    sort:
      sort === 'created-desc'
        ? 'created'
        : sort === 'usage-desc'
          ? 'usage'
          : sort === 'title-asc'
            ? 'title'
            : 'updated',
    // 云侧这四个 sort 都是「自然方向」；title 在桌面 desc = A→Z，与 title-asc 对齐。
    sortDir: 'desc',
  };
  if (query.folderId === null) {
    mapped.folderId = UNFILED_FOLDER_ID;
  } else if (query.folderId) {
    mapped.folderId = query.folderId;
  }
  if (query.pinnedOnly) {
    mapped.filters = { isPinned: true };
  }
  return mapped;
}

export function combinePromptListRows(live: Prompt[], deleted?: Prompt[]): Prompt[] {
  if (!deleted?.length) return live;
  return [...live, ...deleted];
}

export function paginatePromptRows(rows: Prompt[], query: PromptListQuery): PromptPage {
  const limit = resolvePageLimit(query.limit);
  const offset = parseOffsetCursor(query.cursor);
  const slice = rows.slice(offset, offset + limit).map(promptRowToDocument);
  return {
    items: slice,
    nextCursor: nextOffsetCursor(offset, limit, slice.length, rows.length),
  };
}

export function markPromptRowDeleted(row: Prompt, deletedAtMs = Date.now()): Prompt {
  return { ...row, deletedAt: deletedAtMs, updatedAt: deletedAtMs };
}
