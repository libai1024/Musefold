// 桌面工作台会话行 ↔ contracts WorkbenchSession。草稿在桌面不落 IPC。

import type {
  CreateWorkbenchSession,
  WorkbenchDraft,
  WorkbenchSession,
  WorkbenchSessionListQuery,
  WorkbenchSessionPage,
} from '@musefold/contracts';
import type {
  EnsureWorkbenchSessionCommand,
  WorkbenchSession as DesktopWorkbenchSession,
  WorkbenchSessionListQuery as DesktopWorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from '@musefold/desktop-contracts/workbench';
import { DESKTOP_SYNTHETIC_ENTITY_VERSION } from './prompt';
import {
  epochMsToIso,
  epochMsToIsoOrNull,
  nextOffsetCursor,
  parseOffsetCursor,
  resolvePageLimit,
} from './time';

const DEFAULT_SESSION_TITLE = '未命名创作';

/** 桌面会话行没有 draft；端口形状要求必填，用空草稿占位。 */
export const EMPTY_WORKBENCH_DRAFT: WorkbenchDraft = {
  prompt: '',
  negative: '',
  params: {},
  promptReferenceIds: [],
};

export function workbenchSessionRowToDocument(
  row: DesktopWorkbenchSession,
): WorkbenchSession {
  return {
    id: row.id,
    title: row.title.trim() || DEFAULT_SESSION_TITLE,
    draft: EMPTY_WORKBENCH_DRAFT,
    version: DESKTOP_SYNTHETIC_ENTITY_VERSION,
    createdAt: epochMsToIso(row.createdAt),
    updatedAt: epochMsToIso(row.updatedAt),
    archivedAt: epochMsToIsoOrNull(row.archivedAt),
    deletedAt: epochMsToIsoOrNull(row.deletedAt),
    // 有损：
    // - 桌面 WorkbenchSessionDocument.runs / Summary 的 turnCount、runCount、
    //   latestAssetPath、conversationKind、latestStatus 不在端口会话形状上，丢弃。
    // - 云 draft 在桌面由渲染层 localStorage 持有，IPC 行模型无对应列。
    // - version 同 Prompt：桌面无乐观锁，读侧填 1。
  };
}

export function createWorkbenchSessionToEnsureCommand(
  input: CreateWorkbenchSession,
  id: string,
): EnsureWorkbenchSessionCommand {
  return {
    id,
    title: input.title?.trim() || DEFAULT_SESSION_TITLE,
    // 有损：CreateWorkbenchSession.draft 无 IPC 落盘通道（ensure 只收 id/title/createdAt）。
  };
}

export function workbenchListQueryToRowQuery(
  _query: WorkbenchSessionListQuery,
  archived: boolean,
): DesktopWorkbenchSessionListQuery {
  return {
    archived,
    // 桌面一次最多 200；云分页在 mapper 侧切，避免 includeArchived 时两路 limit 对不齐。
    limit: 200,
    offset: 0,
  };
}

export function mergeWorkbenchSessionRows(
  active: WorkbenchSessionListResult,
  archived?: WorkbenchSessionListResult,
): DesktopWorkbenchSession[] {
  const rows = archived ? [...active.items, ...archived.items] : [...active.items];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
}

export function paginateWorkbenchRows(
  rows: DesktopWorkbenchSession[],
  query: WorkbenchSessionListQuery,
): WorkbenchSessionPage {
  const limit = resolvePageLimit(query.limit);
  const offset = parseOffsetCursor(query.cursor);
  const slice = rows.slice(offset, offset + limit).map(workbenchSessionRowToDocument);
  return {
    items: slice,
    nextCursor: nextOffsetCursor(offset, limit, slice.length, rows.length),
  };
}
