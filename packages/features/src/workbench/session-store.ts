'use client';

import type { GenerationCount, GenerationQuality, WorkbenchDraft } from '@musefold/contracts';
import { create } from 'zustand';

/**
 * 活动会话是跨壳/屏状态:壳侧栏「对话」区选中它,工作台屏读它渲染时间线。
 * 会话数据本身在 React Query 缓存;这里只存 UI 指针。
 * seenAt 支撑行「未读」点(§3.3):完成时刻晚于最近查看即未读;内存态,重启清零。
 * pendingDraft 是「送入制作」通道(承旧 openDraft,ui-parity 04 P0):
 * 提示词库等屏写入一份草稿,工作台装载时消费一次即清。
 */
interface ActiveSessionState {
  activeSessionId: string | null;
  /**
   * 「新设计」草稿态:工作台呈空白待发(不自动回落最近会话),
   * 首次发送才真正建会话——不产生「未命名创作」空行。
   */
  draftSession: boolean;
  seenAt: Record<string, number>;
  /** 手动「标记为未读」集合(ui-parity 02 §7):轻量「稍后回看」,打开会话即清。 */
  unreadMarks: Record<string, true>;
  pendingDraft: WorkbenchDraft | null;
  /**
   * 新设计/空草稿里用户显式改过的比例/质量/张数。
   * 有覆盖的字段不再跟随设置默认值;未覆盖的字段继续继承。
   */
  draftParamOverrides: DraftParamOverrides;
  setActiveSessionId(id: string | null): void;
  startDraftSession(): void;
  markSeen(id: string): void;
  markUnread(id: string): void;
  setPendingDraft(draft: WorkbenchDraft): void;
  consumePendingDraft(): void;
  setDraftParamOverride(patch: DraftParamOverrides): void;
  clearDraftParamOverrides(): void;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
}

export interface DraftParamOverrides {
  aspectRatio?: string;
  quality?: GenerationQuality;
  /** 张数(§9-D3);与比例/质量同一套覆盖语义。 */
  count?: GenerationCount;
}

export interface GenerationParamDefaults {
  defaultAspectRatio: string;
  defaultQuality: GenerationQuality;
  defaultCount: GenerationCount;
}

/** 未显式改过的字段走全局默认;用户改过的字段保留覆盖。 */
export function resolveInheritedGenerationParams(
  defaults: GenerationParamDefaults,
  overrides: DraftParamOverrides,
): { aspectRatio: string; quality: GenerationQuality; count: GenerationCount } {
  return {
    aspectRatio: overrides.aspectRatio ?? defaults.defaultAspectRatio,
    quality: overrides.quality ?? defaults.defaultQuality,
    count: overrides.count ?? defaults.defaultCount,
  };
}

export const useActiveSession = create<ActiveSessionState>((set) => ({
  activeSessionId: null,
  draftSession: false,
  seenAt: {},
  unreadMarks: {},
  pendingDraft: null,
  draftParamOverrides: {},
  setActiveSessionId: (id) =>
    set((state) => ({
      activeSessionId: id,
      draftSession: false,
      draftParamOverrides: {},
      seenAt: id ? { ...state.seenAt, [id]: Date.now() } : state.seenAt,
      unreadMarks: id ? withoutKey(state.unreadMarks, id) : state.unreadMarks,
    })),
  startDraftSession: () =>
    set({ activeSessionId: null, draftSession: true, draftParamOverrides: {} }),
  markSeen: (id) =>
    set((state) => ({
      seenAt: { ...state.seenAt, [id]: Date.now() },
      unreadMarks: withoutKey(state.unreadMarks, id),
    })),
  markUnread: (id) => set((state) => ({ unreadMarks: { ...state.unreadMarks, [id]: true } })),
  setPendingDraft: (draft) => set({ pendingDraft: draft }),
  consumePendingDraft: () => set({ pendingDraft: null }),
  setDraftParamOverride: (patch) =>
    set((state) => ({
      draftParamOverrides: { ...state.draftParamOverrides, ...patch },
    })),
  clearDraftParamOverrides: () => set({ draftParamOverrides: {} }),
}));

/** 未读基线:启动前完成的历史会话不标未读,只追踪本次运行期间的完成。 */
const SESSION_BOOT_AT = Date.now();

/**
 * 未读:最近生成已完成、完成时刻晚于该会话最近一次查看,且当前未打开它;
 * 或用户手动「标记为未读」(不要求有成功任务)。
 */
export function isSessionUnread(
  session: { id: string; latestJobStatus: string | null; latestJobFinishedAt: string | null },
  activeSessionId: string | null,
  seenAt: Record<string, number>,
  unreadMarks: Record<string, true> = {},
): boolean {
  if (session.id === activeSessionId) return false;
  if (unreadMarks[session.id]) return true;
  if (session.latestJobStatus !== 'succeeded' || !session.latestJobFinishedAt) return false;
  return Date.parse(session.latestJobFinishedAt) > (seenAt[session.id] ?? SESSION_BOOT_AT);
}
