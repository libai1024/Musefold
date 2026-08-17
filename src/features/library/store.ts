// src/features/library/store.ts
// 提示词库状态 —— 详见 docs/product/10-library-deep-dive.md（TASK-LIB-02 为本文件主卡）
//
// 约定：
//   1. 所有写操作都经 window.api.prompt|folder|tag.*，失败时 set(error) 且**不破坏现有列表**。
//   2. 删除 / 收藏 / 移动 / 评分走乐观更新 + 失败回滚（验收明确要求）。
//   3. 筛选类状态（搜索/标签/文件夹/筛选/排序）变更走 150ms 防抖 fetch，
//      避免连续输入或连点标签时打出一串 IPC。
//   4. 计数徽标来自 api.prompt.stats()，不用 prompts.length 现算
//      —— list() 有 LIMIT 且被筛选收敛过，现算必然偏小。

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  Prompt,
  Folder,
  Tag,
  NewPrompt,
  NewFolder,
  NewTag,
  SmartSet,
  SearchHistoryItem,
  LibraryQuerySnapshot,
} from '@shared/types/models';
import type {
  BatchPromptMutationResult,
  ListPromptsQuery,
  UpdatePromptPatch,
  PromptStats,
} from '@shared/types/ipc';
import { SEARCH_DEBOUNCE_MS, UNFILED_FOLDER_ID } from '@shared/constants';
import api from '../../lib/ipc';
import { toast } from '../../stores/toast';

export type LibraryFilters = NonNullable<ListPromptsQuery['filters']>;
export type SortKey = NonNullable<ListPromptsQuery['sort']>;
export type SortDir = NonNullable<ListPromptsQuery['sortDir']>;

const EMPTY_STATS: PromptStats = {
  total: 0,
  unfiled: 0,
  trashed: 0,
  pinned: 0,
  byFolder: {},
  byTag: {},
};

interface LibraryState {
  // ---- 数据 ----
  prompts: Prompt[];
  folders: Folder[];
  tags: Tag[];
  stats: PromptStats;
  smartSets: SmartSet[];
  smartSetCounts: Record<string, number>;
  searchHistory: SearchHistoryItem[];
  /** 回收站列表（按需加载） */
  deleted: Prompt[];

  // ---- 查询态 ----
  search: string;
  selectedTagIds: string[];
  selectedFolderId: string | null;
  filters: LibraryFilters;
  sort: SortKey;
  sortDir: SortDir;

  // ---- UI 态 ----
  loading: boolean;
  /** 首屏尚未加载完成（用于区分骨架屏 vs 静默刷新） */
  initialized: boolean;
  error: string | null;
  selectedPromptId: string | null;
  /** 批量操作选中的提示词；与详情页的单条选中态分离 */
  selectedPromptIds: string[];
  trashOpen: boolean;
  /**
   * 刚从别处（Composer 另存）落库、需要闪一下的条目。
   * 由 highlightPrompt() 设置并在 1.6s 后自动清空 —— 纯视觉信号，不参与筛选。
   */
  highlightPromptId: string | null;

  // ---- 读取 ----
  loadAll: () => Promise<void>;
  reloadPrompts: () => Promise<void>;
  reloadStats: () => Promise<void>;
  reloadSmartSets: () => Promise<void>;
  reloadSmartSetCounts: () => Promise<void>;
  reloadSearchHistory: () => Promise<void>;
  /** 防抖版 reload，供筛选类 setter 内部使用 */
  scheduleReload: () => void;

  // ---- prompt 写操作 ----
  createPrompt: (p: NewPrompt) => Promise<Prompt | null>;
  updatePrompt: (id: string, patch: UpdatePromptPatch) => Promise<Prompt | null>;
  /** 软删 + 5s 内可撤销 toast */
  deletePrompt: (id: string) => Promise<boolean>;
  batchAddTags: (ids: string[], tagIds: string[]) => Promise<BatchPromptMutationResult | null>;
  batchMove: (ids: string[], folderId: string | null) => Promise<BatchPromptMutationResult | null>;
  batchSetPin: (ids: string[], pinned: boolean) => Promise<BatchPromptMutationResult | null>;
  batchDelete: (ids: string[]) => Promise<BatchPromptMutationResult | null>;
  /** 收藏开关；pinned 省略时按当前值取反。返回是否成功（拖拽收藏需要据此决定要不要接着重排） */
  togglePin: (id: string, pinned?: boolean) => Promise<boolean>;
  reorderPins: (ids: string[]) => Promise<void>;
  setRating: (id: string, rating: number) => Promise<void>;
  moveToFolder: (id: string, folderId: string | null) => Promise<void>;
  /** 复制正文到剪贴板 + usage_count++；返回是否真的进了剪贴板（卡片据此显示 ✓） */
  copyContent: (id: string) => Promise<boolean>;
  /**
   * 选中 + 闪烁某条（Composer「存为提示词」跳转过来时用）。
   * 会先 reloadPrompts —— 新条目是在别的视图里落库的，当前列表根本没有它。
   */
  highlightPrompt: (id: string) => Promise<void>;

  // ---- 回收站 ----
  loadDeleted: () => Promise<void>;
  restorePrompt: (id: string) => Promise<void>;
  purgePrompt: (id: string) => Promise<void>;
  purgeAll: () => Promise<void>;
  setTrashOpen: (open: boolean) => void;

  // ---- 智能集合 / 搜索历史（TASK-DIF-06）----
  saveSmartSet: (name: string) => Promise<SmartSet | null>;
  applySmartSet: (id: string) => Promise<boolean>;
  deleteSmartSet: (id: string) => Promise<void>;
  applySearchHistory: (term: string) => Promise<void>;
  clearSearchHistory: () => Promise<void>;

  // ---- 文件夹 ----
  createFolder: (f: NewFolder) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  reorderFolders: (ids: string[]) => Promise<void>;

  // ---- 标签 ----
  createTag: (t: NewTag) => Promise<Tag | null>;
  renameTag: (id: string, name: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  assignTags: (promptId: string, tagIds: string[]) => Promise<void>;

  // ---- 查询态 setter ----
  setSearch: (s: string) => void;
  setSort: (s: SortKey) => void;
  setSortDir: (d: SortDir) => void;
  toggleTag: (tagId: string) => void;
  setFolder: (folderId: string | null) => void;
  setFilters: (patch: Partial<LibraryFilters>) => void;
  clearFilters: () => void;
  /** 是否存在任何生效的筛选条件（含搜索与标签） */
  hasActiveFilters: () => boolean;
  currentQuery: () => LibraryQuerySnapshot;

  selectPrompt: (id: string | null) => void;
  setSelectedPromptIds: (ids: string[]) => void;
  toggleSelectedPrompt: (id: string) => void;
  clearSelectedPromptIds: () => void;
  clearError: () => void;
}

/** 防抖句柄：模块级，保证跨 action 共享同一个 timer */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function message(err: unknown): string {
  const e = err as { message?: string; code?: string };
  return e?.message || e?.code || '未知错误';
}

function showBatchResult(action: string, result: BatchPromptMutationResult): void {
  if (result.skipped > 0) {
    toast.show({
      title: `${action}完成`,
      description: `已处理 ${result.affected} 项，跳过 ${result.skipped} 项`,
      variant: 'warning',
    });
    return;
  }
  toast.success(`${action}完成`, `已处理 ${result.affected} 项`);
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  prompts: [],
  folders: [],
  tags: [],
  stats: EMPTY_STATS,
  smartSets: [],
  smartSetCounts: {},
  searchHistory: [],
  deleted: [],

  search: '',
  selectedTagIds: [],
  selectedFolderId: null,
  filters: {},
  sort: 'updated',
  sortDir: 'desc',

  loading: false,
  initialized: false,
  error: null,
  selectedPromptId: null,
  selectedPromptIds: [],
  trashOpen: false,
  highlightPromptId: null,

  // ---------- 读取 ----------

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [prompts, folders, tags, stats, smartSets, searchHistory] = await Promise.all([
        api.prompt.list(buildQuery(get())),
        api.folder.list(),
        api.tag.list(),
        api.prompt.stats(),
        api.smartSet.list(),
        api.searchHistory.list(10),
      ]);
      const visibleIds = new Set(prompts.map((prompt) => prompt.id));
      set({
        prompts,
        folders,
        tags,
        stats,
        smartSets,
        searchHistory,
        selectedPromptIds: get().selectedPromptIds.filter((id) => visibleIds.has(id)),
        loading: false,
        initialized: true,
      });
      void get().reloadSmartSetCounts();
    } catch (err) {
      // 首屏失败也要落 initialized，否则骨架屏会永久转
      set({ loading: false, initialized: true, error: message(err) });
    }
  },

  reloadPrompts: async () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    set({ loading: true });
    try {
      const prompts = await api.prompt.list(buildQuery(get()));
      const visibleIds = new Set(prompts.map((prompt) => prompt.id));
      set({
        prompts,
        selectedPromptIds: get().selectedPromptIds.filter((id) => visibleIds.has(id)),
        loading: false,
        error: null,
      });
    } catch (err) {
      // 失败保留旧列表，只报错
      set({ loading: false, error: message(err) });
    }
  },

  reloadStats: async () => {
    try {
      set({ stats: await api.prompt.stats() });
    } catch {
      /* 计数是装饰性信息，失败静默 */
    }
  },

  reloadSmartSets: async () => {
    try {
      set({ smartSets: await api.smartSet.list(), error: null });
      void get().reloadSmartSetCounts();
    } catch (err) {
      set({ error: message(err) });
    }
  },

  reloadSmartSetCounts: async () => {
    const { smartSets, tags, folders } = get();
    if (smartSets.length === 0) {
      set({ smartSetCounts: {} });
      return;
    }
    try {
      const entries = await Promise.all(
        smartSets.map(async (item) => {
          const query = normalizeQueryForCurrentData(item.query, tags, folders);
          const prompts = await api.prompt.list(query);
          return [item.id, prompts.length] as const;
        })
      );
      set({ smartSetCounts: Object.fromEntries(entries) });
    } catch {
      /* 命中数是装饰性信息，失败不打断主列表 */
    }
  },

  reloadSearchHistory: async () => {
    try {
      set({ searchHistory: await api.searchHistory.list(10), error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  scheduleReload: () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const term = get().search.trim();
      void get().reloadPrompts();
      if (term) {
        void api.searchHistory.add(term)
          .then(() => get().reloadSearchHistory())
          .catch(() => {
            /* 搜索历史是辅助能力，失败不打断搜索 */
          });
      }
    }, SEARCH_DEBOUNCE_MS);
  },

  // ---------- prompt 写操作 ----------

  createPrompt: async (p) => {
    try {
      const created = await api.prompt.create(p);
      // 不做乐观插入：新条目是否落在当前筛选/排序里由后端决定，重拉才是真相
	      await get().reloadPrompts();
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      set({ selectedPromptId: created.id, error: null });
      return created;
    } catch (err) {
      set({ error: message(err) });
      toast.error('创建失败', message(err));
      return null;
    }
  },

  updatePrompt: async (id, patch) => {
    const prev = get().prompts;
    // 乐观：先把可见字段贴上去，保证列表/检视栏即时反映
    set({
      prompts: prev.map((x) =>
        x.id === id
          ? {
              ...x,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {}),
              ...(patch.content !== undefined ? { content: patch.content } : {}),
              ...(patch.contentNegative !== undefined
                ? { contentNegative: patch.contentNegative }
                : {}),
              ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
              ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
              ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
              updatedAt: Date.now(),
            }
          : x
      ),
    });
    try {
      const updated = await api.prompt.update(id, patch);
      // 用服务端结果覆盖（tags / updatedAt 等派生字段以后端为准）
      set((s) => ({
        prompts: s.prompts.map((x) => (x.id === id ? updated : x)),
        error: null,
	      }));
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      return updated;
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      toast.error('保存失败', message(err));
      return null;
    }
  },

  deletePrompt: async (id) => {
    const prev = get().prompts;
    const target = prev.find((x) => x.id === id);
    const wasSelected = get().selectedPromptId === id;
    // 乐观移除
    set({
      prompts: prev.filter((x) => x.id !== id),
      ...(wasSelected ? { selectedPromptId: null } : {}),
    });
    try {
	      await api.prompt.delete(id);
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
      toast.show({
        title: '已删除',
        description: target?.title,
        duration: 5000, // §4.3：5s 内可撤销
        action: {
          label: '撤销',
          onClick: () => {
            void get().restorePrompt(id);
          },
        },
      });
      return true;
    } catch (err) {
      set({
        prompts: prev,
        ...(wasSelected ? { selectedPromptId: id } : {}),
        error: message(err),
      });
      toast.error('删除失败', message(err));
      return false;
    }
  },

  batchAddTags: async (ids, tagIds) => {
    if (ids.length === 0 || tagIds.length === 0) return null;
    try {
      const result = await api.prompt.batchAddTags(ids, tagIds);
      await get().reloadPrompts();
      void get().reloadStats();
      void get().reloadSmartSetCounts();
      set({ selectedPromptIds: [], error: null });
      showBatchResult('添加标签', result);
      return result;
    } catch (err) {
      set({ error: message(err) });
      toast.error('批量添加标签失败', message(err));
      return null;
    }
  },

  batchMove: async (ids, folderId) => {
    if (ids.length === 0) return null;
    try {
      const result = await api.prompt.batchMove(ids, folderId);
      await get().reloadPrompts();
      void get().reloadStats();
      void get().reloadSmartSetCounts();
      set({ selectedPromptIds: [], error: null });
      showBatchResult('批量移动', result);
      return result;
    } catch (err) {
      set({ error: message(err) });
      toast.error('批量移动失败', message(err));
      return null;
    }
  },

  batchSetPin: async (ids, pinned) => {
    if (ids.length === 0) return null;
    try {
      const result = await api.prompt.batchSetPin(ids, pinned);
      await get().reloadPrompts();
      void get().reloadStats();
      void get().reloadSmartSetCounts();
      set({ selectedPromptIds: [], error: null });
      showBatchResult(pinned ? '批量收藏' : '批量取消收藏', result);
      return result;
    } catch (err) {
      set({ error: message(err) });
      toast.error(pinned ? '批量收藏失败' : '批量取消收藏失败', message(err));
      return null;
    }
  },

  batchDelete: async (ids) => {
    if (ids.length === 0) return null;
    const selectedDetail = get().selectedPromptId;
    try {
      const result = await api.prompt.batchDelete(ids);
      await get().reloadPrompts();
      void get().reloadStats();
      void get().reloadSmartSetCounts();
      set({
        selectedPromptIds: [],
        ...(selectedDetail && ids.includes(selectedDetail) ? { selectedPromptId: null } : {}),
        error: null,
      });
      showBatchResult('批量删除', result);
      return result;
    } catch (err) {
      set({ error: message(err) });
      toast.error('批量删除失败', message(err));
      return null;
    }
  },

  togglePin: async (id, pinned) => {
    const prev = get().prompts;
    const current = prev.find((x) => x.id === id);
    if (!current) return false;
    const next = pinned ?? !current.isPinned;
    set({ prompts: prev.map((x) => (x.id === id ? { ...x, isPinned: next } : x)) });
    try {
      const updated = await api.prompt.togglePin(id, next);
      set((s) => ({
        prompts: s.prompts.map((x) => (x.id === id ? updated : x)),
        error: null,
	      }));
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      return true;
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      toast.error(next ? '收藏失败' : '取消收藏失败', message(err));
      return false;
    }
  },

  reorderPins: async (ids) => {
    const prev = get().prompts;
    // 乐观：按传入顺序重排 pinOrder，选择器再按 pinOrder 排
    const orderMap = new Map(ids.map((id, i) => [id, i]));
    set({
      prompts: prev.map((x) => (orderMap.has(x.id) ? { ...x, pinOrder: orderMap.get(x.id)! } : x)),
    });
    try {
      await api.prompt.reorderPins(ids);
      set({ error: null });
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      toast.error('排序失败', message(err));
    }
  },

  setRating: async (id, rating) => {
    await get().updatePrompt(id, { rating });
  },

  moveToFolder: async (id, folderId) => {
    const target = get().prompts.find((x) => x.id === id);
    if (target && (target.folderId ?? null) === folderId) return; // 拖到原文件夹：无变化
    const updated = await get().updatePrompt(id, { folderId });
    if (!updated) return;
    const name = folderId ? get().folders.find((f) => f.id === folderId)?.name : null;
    toast.success('已移动', name ? `→ ${name}` : '→ 全部（未归档）');
    // 当前正筛着某文件夹时，移出后该条应从列表消失
    if (get().selectedFolderId !== null) void get().reloadPrompts();
  },

  copyContent: async (id) => {
    const p = get().prompts.find((x) => x.id === id) ?? get().deleted.find((x) => x.id === id);
    if (!p) return false;
    try {
      await navigator.clipboard.writeText(p.content);
    } catch (err) {
      set({ error: message(err) });
      toast.error('复制失败', '剪贴板不可用');
      return false;
    }
    try {
	      await api.prompt.incrementUsage(id);
      set((s) => ({
        prompts: s.prompts.map((x) =>
          x.id === id ? { ...x, usageCount: x.usageCount + 1, lastUsedAt: Date.now() } : x
        ),
	      }));
	      void get().reloadSmartSetCounts();
    } catch {
      /* 计数失败不影响「已复制」这件事本身 */
    }
    toast.success('已复制正文', p.title);
    return true;
  },

  // ---------- 回收站（TASK-LIB-12） ----------

  loadDeleted: async () => {
    try {
      set({ deleted: await api.prompt.listDeleted(), error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  restorePrompt: async (id) => {
    try {
      await api.prompt.restore(id);
      set((s) => ({ deleted: s.deleted.filter((x) => x.id !== id) }));
	      await get().reloadPrompts();
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      toast.success('已恢复');
    } catch (err) {
      set({ error: message(err) });
      toast.error('恢复失败', message(err));
    }
  },

  purgePrompt: async (id) => {
    const prev = get().deleted;
    set({ deleted: prev.filter((x) => x.id !== id) });
    try {
	      await api.prompt.purge(id);
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
    } catch (err) {
      set({ deleted: prev, error: message(err) });
      toast.error('彻底删除失败', message(err));
    }
  },

  purgeAll: async () => {
    const prev = get().deleted;
    set({ deleted: [] });
    try {
	      const { purged } = await api.prompt.purgeAll();
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
      toast.success('回收站已清空', `彻底删除 ${purged} 条`);
    } catch (err) {
      set({ deleted: prev, error: message(err) });
      toast.error('清空失败', message(err));
    }
  },

  setTrashOpen: (trashOpen) => {
    set({ trashOpen });
    if (trashOpen) void get().loadDeleted();
  },

  // ---------- 智能集合 / 搜索历史（TASK-DIF-06） ----------

  saveSmartSet: async (name) => {
    try {
      const created = await api.smartSet.create({ name, query: get().currentQuery() });
      set((s) => ({ smartSets: [...s.smartSets, created].sort(compareSmartSets), error: null }));
      void get().reloadSmartSetCounts();
      toast.success('已保存智能集合', created.name);
      return created;
    } catch (err) {
      set({ error: message(err) });
      toast.error('保存集合失败', message(err));
      return null;
    }
  },

  applySmartSet: async (id) => {
    const setDef = get().smartSets.find((item) => item.id === id);
    if (!setDef) return false;
    const query = normalizeQueryForCurrentData(setDef.query, get().tags, get().folders);
    set({
      search: query.search ?? '',
      selectedTagIds: query.tagIds ?? [],
      selectedFolderId: query.folderId ?? null,
      filters: query.filters ?? {},
      sort: query.sort ?? 'updated',
      sortDir: query.sortDir ?? 'desc',
    });
    await get().reloadPrompts();
    const changed = JSON.stringify(query) !== JSON.stringify(setDef.query);
    if (changed) {
      const updated = await api.smartSet.update(id, { query }).catch(() => null);
      if (updated) set((s) => ({ smartSets: s.smartSets.map((item) => (item.id === id ? updated : item)) }));
    }
    toast.success('已应用集合', setDef.name);
    return true;
  },

  deleteSmartSet: async (id) => {
    const prev = get().smartSets;
    const prevCounts = get().smartSetCounts;
    const target = prev.find((item) => item.id === id);
    set({
      smartSets: prev.filter((item) => item.id !== id),
      smartSetCounts: Object.fromEntries(Object.entries(prevCounts).filter(([key]) => key !== id)),
    });
    try {
      await api.smartSet.delete(id);
      toast.success('集合已删除', target?.name);
    } catch (err) {
      set({ smartSets: prev, smartSetCounts: prevCounts, error: message(err) });
      toast.error('删除集合失败', message(err));
    }
  },

  applySearchHistory: async (term) => {
    const clean = term.trim();
    if (!clean) return;
    set({ search: clean });
    await get().reloadPrompts();
    await api.searchHistory.add(clean).catch(() => null);
    void get().reloadSearchHistory();
  },

  clearSearchHistory: async () => {
    const prev = get().searchHistory;
    set({ searchHistory: [] });
    try {
      await api.searchHistory.clear();
    } catch (err) {
      set({ searchHistory: prev, error: message(err) });
      toast.error('清除搜索历史失败', message(err));
    }
  },

  // ---------- 文件夹（TASK-LIB-03） ----------

  createFolder: async (f) => {
    try {
      const created = await api.folder.create(f);
      set((s) => ({ folders: [...s.folders, created], error: null }));
      return created;
    } catch (err) {
      set({ error: message(err) });
      toast.error('新建文件夹失败', message(err));
      return null;
    }
  },

  renameFolder: async (id, name) => {
    const prev = get().folders;
    set({ folders: prev.map((f) => (f.id === id ? { ...f, name } : f)) });
    try {
      const updated = await api.folder.update(id, { name });
      set((s) => ({ folders: s.folders.map((f) => (f.id === id ? updated : f)), error: null }));
    } catch (err) {
      set({ folders: prev, error: message(err) });
      toast.error('重命名失败', message(err));
    }
  },

  deleteFolder: async (id) => {
    const prev = get().folders;
    // 子文件夹随父级 CASCADE 一起消失，本地同步移除
    const removed = new Set([id, ...prev.filter((f) => f.parentId === id).map((f) => f.id)]);
    set({ folders: prev.filter((f) => !removed.has(f.id)) });
    try {
      await api.folder.delete(id);
      // 该文件夹下的 prompt 只是 folder_id 置空（ON DELETE SET NULL），需要重拉才能正确显示
      const cur = get().selectedFolderId;
	      if (cur && removed.has(cur)) set({ selectedFolderId: null });
	      await get().reloadPrompts();
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      toast.success('文件夹已删除', '其中的提示词已移到「全部」');
    } catch (err) {
      set({ folders: prev, error: message(err) });
      toast.error('删除文件夹失败', message(err));
    }
  },

  reorderFolders: async (ids) => {
    const prev = get().folders;
    const orderMap = new Map(ids.map((id, i) => [id, i]));
    set({
      folders: prev.map((f) => (orderMap.has(f.id) ? { ...f, sortOrder: orderMap.get(f.id)! } : f)),
    });
    try {
      await api.folder.reorder(ids);
      set({ error: null });
    } catch (err) {
      set({ folders: prev, error: message(err) });
      toast.error('排序失败', message(err));
    }
  },

  // ---------- 标签（TASK-LIB-11） ----------

  createTag: async (t) => {
    const name = t.name.trim();
    const dup = get().tags.find((x) => x.name === name);
    if (dup) {
      toast.info('标签已存在', dup.name);
      return dup;
    }
    try {
      const created = await api.tag.create({ ...t, name });
      set((s) => ({ tags: [...s.tags, created], error: null }));
      return created;
    } catch (err) {
      set({ error: message(err) });
      toast.error('新建标签失败', message(err));
      return null;
    }
  },

  renameTag: async (id, name) => {
    const prev = get().tags;
    set({ tags: prev.map((t) => (t.id === id ? { ...t, name } : t)) });
    try {
	      const updated = await api.tag.update(id, { name });
	      set((s) => ({ tags: s.tags.map((t) => (t.id === id ? updated : t)), error: null }));
	      // 标签名参与 FTS 分词，主进程已重建索引；列表里的 tags 快照也要刷新
	      await get().reloadPrompts();
	      void get().reloadSmartSetCounts();
    } catch (err) {
      set({ tags: prev, error: message(err) });
      toast.error('重命名标签失败', message(err));
    }
  },

  deleteTag: async (id) => {
    const prev = get().tags;
    set({ tags: prev.filter((t) => t.id !== id) });
    try {
      await api.tag.delete(id);
      // 正在按该标签筛选时自动摘掉，否则筛选条件指向一个已不存在的 id
      if (get().selectedTagIds.includes(id)) {
        set((s) => ({ selectedTagIds: s.selectedTagIds.filter((x) => x !== id) }));
      }
	      await get().reloadPrompts();
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
    } catch (err) {
      set({ tags: prev, error: message(err) });
      toast.error('删除标签失败', message(err));
    }
  },

  assignTags: async (promptId, tagIds) => {
    const prev = get().prompts;
    const tagObjs = get().tags.filter((t) => tagIds.includes(t.id));
    set({ prompts: prev.map((p) => (p.id === promptId ? { ...p, tags: tagObjs } : p)) });
    try {
	      await api.tag.assignToPrompt(promptId, tagIds);
	      void get().reloadStats();
	      void get().reloadSmartSetCounts();
	      set({ error: null });
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      toast.error('打标签失败', message(err));
    }
  },

  // ---------- 查询态 ----------

  setSearch: (s) => {
    set({ search: s });
    get().scheduleReload();
  },
  setSort: (sort) => {
    set({ sort });
    get().scheduleReload();
  },
  setSortDir: (sortDir) => {
    set({ sortDir });
    get().scheduleReload();
  },
  toggleTag: (tagId) => {
    const cur = get().selectedTagIds;
    set({
      selectedTagIds: cur.includes(tagId) ? cur.filter((t) => t !== tagId) : [...cur, tagId],
    });
    get().scheduleReload();
  },
  setFolder: (selectedFolderId) => {
    set({ selectedFolderId });
    get().scheduleReload();
  },
  setFilters: (patch) => {
    const next: LibraryFilters = { ...get().filters, ...patch };
    // undefined 表示「取消该维度」，删键而不是留一个 undefined 值
    for (const k of Object.keys(patch) as (keyof LibraryFilters)[]) {
      if (patch[k] === undefined) delete next[k];
    }
    set({ filters: next });
    get().scheduleReload();
  },
  clearFilters: () => {
    set({ filters: {}, search: '', selectedTagIds: [] });
    get().scheduleReload();
  },
  hasActiveFilters: () => {
    const { search, selectedTagIds, filters } = get();
    return search.trim() !== '' || selectedTagIds.length > 0 || Object.keys(filters).length > 0;
  },
  currentQuery: () => buildLibraryQuerySnapshot(get()),

  selectPrompt: (id) => set({ selectedPromptId: id }),
  setSelectedPromptIds: (ids) => {
    const visibleIds = new Set(get().prompts.map((prompt) => prompt.id));
    set({ selectedPromptIds: Array.from(new Set(ids)).filter((id) => visibleIds.has(id)) });
  },
  toggleSelectedPrompt: (id) => {
    const current = get().selectedPromptIds;
    set({
      selectedPromptIds: current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    });
  },
  clearSelectedPromptIds: () => set({ selectedPromptIds: [] }),
  clearError: () => set({ error: null }),

  highlightPrompt: async (id) => {
    // 新条目是在 Composer 里落库的，当前 prompts 数组里没有 —— 必须先刷
    await get().reloadPrompts();
    let target = get().prompts.find((p) => p.id === id);
    if (!target) {
      // 落在了当前筛选之外（比如正筛着某标签）：清掉筛选再找一次，
      // 否则用户会看到「保存成功」但列表里什么都没有。
      get().clearFilters();
      await get().reloadPrompts();
      target = get().prompts.find((p) => p.id === id);
    }
    set({ selectedPromptId: id, highlightPromptId: id });
    void get().reloadStats();
    setTimeout(() => {
      // 期间可能已经有新的高亮请求，别把它的信号擦掉
      if (get().highlightPromptId === id) set({ highlightPromptId: null });
    }, 1600);
  },
}));

/** 从当前状态组装 list 查询 */
export function buildLibraryQuerySnapshot(s: Pick<
  LibraryState,
  'search' | 'selectedTagIds' | 'selectedFolderId' | 'filters' | 'sort' | 'sortDir'
>): LibraryQuerySnapshot {
  return {
    search: s.search.trim() || undefined,
    tagIds: s.selectedTagIds.length > 0 ? s.selectedTagIds : undefined,
    folderId: s.selectedFolderId ?? undefined,
    filters: Object.keys(s.filters).length > 0 ? s.filters : undefined,
    sort: s.sort,
    sortDir: s.sortDir,
  };
}

function buildQuery(s: LibraryState): ListPromptsQuery {
  return buildLibraryQuerySnapshot(s);
}

function compareSmartSets(a: SmartSet, b: SmartSet): number {
  return a.sortOrder - b.sortOrder || b.createdAt - a.createdAt;
}

function normalizeQueryForCurrentData(
  query: LibraryQuerySnapshot,
  tags: Tag[],
  folders: Folder[]
): LibraryQuerySnapshot {
  const existing = new Set(tags.map((tag) => tag.id));
  const tagIds = (query.tagIds ?? []).filter((id) => existing.has(id));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderId =
    query.folderId === UNFILED_FOLDER_ID || (query.folderId && folderIds.has(query.folderId))
      ? query.folderId
      : undefined;
  return {
    ...query,
    folderId,
    ...(tagIds.length > 0 ? { tagIds } : { tagIds: undefined }),
    filters: query.filters && Object.keys(query.filters).length > 0 ? query.filters : undefined,
  };
}

// ---------- 派生选择器 ----------
//
// 注意：zustand v5 的 useStore 用 Object.is 比较选择器结果，
// 每次返回新数组 = 每次都「变了」= 无限重渲染（React #185，整棵树被卸载）。
// 所以凡是返回新数组的派生值，一律通过下面的 hook 走 useShallow，
// 不要在组件里写 useLibraryStore(selectPinned)。

/** 置顶区（按 pin_order 升序），供 PromptList 分区渲染 */
export function selectPinned(s: LibraryState): Prompt[] {
  return s.prompts.filter((p) => p.isPinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
}

/** 普通区（后端已排好序，此处保序） */
export function selectNormal(s: LibraryState): Prompt[] {
  return s.prompts.filter((p) => !p.isPinned);
}

export function selectSelectedPrompt(s: LibraryState): Prompt | null {
  // find 返回的是数组里的原对象引用，天然稳定，可以直接当选择器用
  return s.prompts.find((p) => p.id === s.selectedPromptId) ?? null;
}

/** 置顶区（引用稳定） */
export function usePinnedPrompts(): Prompt[] {
  return useLibraryStore(useShallow(selectPinned));
}

/** 普通区（引用稳定） */
export function useNormalPrompts(): Prompt[] {
  return useLibraryStore(useShallow(selectNormal));
}
