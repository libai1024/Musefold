// src/features/library/store.ts
// 提示词库状态 —— 详见 docs/product/10-library-deep-dive.md（TASK-LIB-02 为本文件主卡）
//
// 约定：
//   1. 重叠写路径经 PromptGateway（update / delete / restore、copy 的 usage）。
//      桌面独有面经 DesktopExtras（list / listDeleted / stats / create、togglePin /
//      reorderPins / purge / purgeAll、searchHistory）；create 走行模型以保留
//      previewImagePath。失败时 set(error) 且**不破坏现有列表**。
//   2. 删除 / 收藏走乐观更新 + 失败回滚（验收明确要求）。
//   3. 筛选类状态（搜索/筛选/排序）变更走 150ms 防抖 fetch，
//      避免连续输入时打出一串 IPC。
//   4. 回收站计数来自 extras.libraryStats()，不用 prompts.length 现算
//      —— list() 有 LIMIT 且被筛选收敛过，现算必然偏小。

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { PromptGateway } from '@musefold/domain';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { NewPrompt } from '@musefold/desktop-contracts/desktop-extras';
import type {
  DesktopLibraryPrompt,
  LibraryQuerySnapshot,
  SearchHistoryItem,
} from '@musefold/desktop-contracts/library-documents';
import type {
  ListPromptsQuery,
  UpdatePromptPatch,
  PromptStats,
} from '@musefold/desktop-contracts/ipc';
import { SEARCH_DEBOUNCE_MS } from '@musefold/domain/constants';
import { musefoldQueryKeys } from '@musefold/product-ui';
import { desktopGateway } from '../../runtime';
import { desktopQueryClient } from '../../runtime/query-client';
import {
  DESKTOP_SYNTHETIC_ENTITY_VERSION,
  applyPromptDocumentToDesktopLibraryPrompt,
  promptDocumentToRow,
  promptRowToDesktopLibraryPrompt,
  updatePatchToDocument,
  epochMsToIso,
} from '../../runtime/mappers';
import { toast } from '../../stores/toast';

let promptGateway: PromptGateway = desktopGateway;
let desktopExtras: DesktopExtras = desktopGateway;

/** 测试替换 PromptGateway；生产保持 desktopGateway 单例。 */
export function setLibraryPromptGatewayForTests(next: PromptGateway): void {
  promptGateway = next;
}

/** 测试替换 DesktopExtras；生产保持 desktopGateway 单例。 */
export function setLibraryDesktopExtrasForTests(next: DesktopExtras): void {
  desktopExtras = next;
}

export function getLibraryDesktopExtras(): DesktopExtras {
  return desktopExtras;
}

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
  prompts: DesktopLibraryPrompt[];
  stats: PromptStats;
  searchHistory: SearchHistoryItem[];
  /** 回收站列表（按需加载） */
  deleted: DesktopLibraryPrompt[];

  // ---- 查询态 ----
  search: string;
  filters: LibraryFilters;
  sort: SortKey;
  sortDir: SortDir;
  /** 已提交的列表查询（搜索防抖后写入，供 Query key 使用） */
  listQuery: LibraryQuerySnapshot;

  // ---- UI 态 ----
  loading: boolean;
  /** 首屏尚未加载完成（用于区分骨架屏 vs 静默刷新） */
  initialized: boolean;
  error: string | null;
  selectedPromptId: string | null;
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
  reloadSearchHistory: () => Promise<void>;
  /** 防抖版 reload，供筛选类 setter 内部使用 */
  scheduleReload: () => void;

  // ---- prompt 写操作 ----
  createPrompt: (p: NewPrompt) => Promise<DesktopLibraryPrompt | null>;
  updatePrompt: (id: string, patch: UpdatePromptPatch) => Promise<DesktopLibraryPrompt | null>;
  /** 软删 + 5s 内可撤销 toast */
  deletePrompt: (id: string) => Promise<boolean>;
  /** 收藏开关；pinned 省略时按当前值取反。返回是否成功（拖拽收藏需要据此决定要不要接着重排） */
  togglePin: (id: string, pinned?: boolean) => Promise<boolean>;
  reorderPins: (ids: string[]) => Promise<void>;
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

  // ---- 搜索历史（TASK-DIF-06；智能集 UI 已退役，actions 已删除）----
  applySearchHistory: (term: string) => Promise<void>;
  clearSearchHistory: () => Promise<void>;

  // ---- 查询态 setter ----
  setSearch: (s: string) => void;
  setSort: (s: SortKey) => void;
  setSortDir: (d: SortDir) => void;
  setFilters: (patch: Partial<LibraryFilters>) => void;
  clearFilters: () => void;
  /** 是否存在任何生效的筛选条件（含搜索与标签） */
  hasActiveFilters: () => boolean;

  selectPrompt: (id: string | null) => void;
  clearError: () => void;
}

/** 防抖句柄：模块级，保证跨 action 共享同一个 timer */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function message(err: unknown): string { const e = err as { message?: string; code?: string }; return e?.message || e?.code || '未知错误'; }
function cacheLibraryList(prompts: DesktopLibraryPrompt[], query: LibraryQuerySnapshot): void { desktopQueryClient.setQueryData(musefoldQueryKeys.library.list(query), prompts); }

export const useLibraryStore = create<LibraryState>((set, get) => ({
  prompts: [],
  stats: EMPTY_STATS,
  searchHistory: [],
  deleted: [],

  search: '',
  filters: {},
  sort: 'updated',
  sortDir: 'desc',
  listQuery: { sort: 'updated', sortDir: 'desc' },

  loading: false,
  initialized: false,
  error: null,
  selectedPromptId: null,
  trashOpen: false,
  highlightPromptId: null,

  // ---------- 读取 ----------

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const query = buildLibraryQuerySnapshot(get());
      const [prompts, stats, searchHistory] = await Promise.all([
        desktopExtras.listLibraryPrompts(query),
        desktopExtras.libraryStats(),
        desktopExtras.listSearchHistory(10),
      ]);
      cacheLibraryList(prompts, query);
      desktopQueryClient.setQueryData(musefoldQueryKeys.library.stats, stats);
      desktopQueryClient.setQueryData(musefoldQueryKeys.library.searchHistory, searchHistory);
      set({
        listQuery: query,
        prompts,
        stats,
        searchHistory,
        loading: false,
        initialized: true,
      });
    } catch (err) {
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
      const query = buildLibraryQuerySnapshot(get());
      const prompts = await desktopExtras.listLibraryPrompts(query);
      cacheLibraryList(prompts, query);
      set({
        listQuery: query,
        prompts,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: message(err) });
    }
  },

  reloadStats: async () => {
    try {
      const stats = await desktopExtras.libraryStats();
      desktopQueryClient.setQueryData(musefoldQueryKeys.library.stats, stats);
      set({ stats });
    } catch {
      /* 计数是装饰性信息，失败静默 */
    }
  },

  reloadSearchHistory: async () => {
    try {
      set({ searchHistory: await desktopExtras.listSearchHistory(10), error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  scheduleReload: () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const term = get().search.trim();
      const query = buildLibraryQuerySnapshot(get());
      set({ listQuery: query });
      void get().reloadPrompts();
      if (term) {
        void desktopExtras.addSearchHistory(term)
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
      const created = await desktopExtras.createLibraryPrompt(p);
      // 不做乐观插入：新条目是否落在当前筛选/排序里由后端决定，重拉才是真相
      await get().reloadPrompts();
      void get().reloadStats();
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
    const prevRow = prev.find((x) => x.id === id);
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
                ? { contentNegative: patch.contentNegative, negative: patch.contentNegative }
                : {}),
              ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
              ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
              ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
              ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
              updatedAtMs: Date.now(),
              updatedAt: epochMsToIso(Date.now()),
            }
          : x
      ),
    });
    cacheLibraryList(get().prompts, get().listQuery);
    try {
      const updatedDoc = await promptGateway.updatePrompt(id, updatePatchToDocument(patch));
      const base = get().prompts.find((x) => x.id === id) ?? prevRow;
      const updated = base
        ? applyPromptDocumentToDesktopLibraryPrompt(base, updatedDoc)
        : promptRowToDesktopLibraryPrompt(promptDocumentToRow(updatedDoc));
      set((s) => ({
        prompts: s.prompts.map((x) => (x.id === id ? updated : x)),
        error: null,
      }));
      cacheLibraryList(get().prompts, get().listQuery);
      void get().reloadStats();
      return updated;
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      cacheLibraryList(prev, get().listQuery);
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
    cacheLibraryList(get().prompts, get().listQuery);
    try {
      await promptGateway.deletePrompt(id, DESKTOP_SYNTHETIC_ENTITY_VERSION);
      void get().reloadStats();
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
      cacheLibraryList(prev, get().listQuery);
      toast.error('删除失败', message(err));
      return false;
    }
  },

  togglePin: async (id, pinned) => {
    const prev = get().prompts;
    const current = prev.find((x) => x.id === id);
    if (!current) return false;
    const next = pinned ?? !current.isPinned;
    set({ prompts: prev.map((x) => (x.id === id ? { ...x, isPinned: next } : x)) });
    cacheLibraryList(get().prompts, get().listQuery);
    try {
      const updated = await desktopExtras.toggleLibraryPin(id, next);
      set((s) => ({
        prompts: s.prompts.map((x) => (x.id === id ? updated : x)),
        error: null,
      }));
      cacheLibraryList(get().prompts, get().listQuery);
      void get().reloadStats();
      return true;
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      cacheLibraryList(prev, get().listQuery);
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
      await desktopExtras.reorderLibraryPins(ids);
      set({ error: null });
    } catch (err) {
      set({ prompts: prev, error: message(err) });
      toast.error('排序失败', message(err));
    }
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
      const used = await promptGateway.usePrompt(id, { action: 'copy' });
      set((s) => ({
        prompts: s.prompts.map((x) =>
          x.id === id ? applyPromptDocumentToDesktopLibraryPrompt(x, used.prompt) : x
        ),
      }));
    } catch {
      /* 计数失败不影响「已复制」这件事本身 */
    }
    toast.success('已复制正文', p.title);
    return true;
  },

  // ---------- 回收站（TASK-LIB-12） ----------

  loadDeleted: async () => {
    try {
      const deleted = await desktopExtras.listDeletedLibraryPrompts();
      desktopQueryClient.setQueryData(musefoldQueryKeys.library.deleted, deleted);
      set({ deleted, error: null });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  restorePrompt: async (id) => {
    try {
      await promptGateway.restorePrompt(id, DESKTOP_SYNTHETIC_ENTITY_VERSION);
      set((s) => ({ deleted: s.deleted.filter((x) => x.id !== id) }));
      await get().reloadPrompts();
      void get().reloadStats();
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
      await desktopExtras.purgeLibraryPrompt(id);
      void get().reloadStats();
    } catch (err) {
      set({ deleted: prev, error: message(err) });
      toast.error('彻底删除失败', message(err));
    }
  },

  purgeAll: async () => {
    const prev = get().deleted;
    set({ deleted: [] });
    try {
      const { purged } = await desktopExtras.purgeLibraryPrompts();
      void get().reloadStats();
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

  // ---------- 搜索历史（TASK-DIF-06；智能集 UI 已退役） ----------

  applySearchHistory: async (term) => {
    const clean = term.trim();
    if (!clean) return;
    set({ search: clean });
    await get().reloadPrompts();
    await desktopExtras.addSearchHistory(clean).catch(() => null);
    void get().reloadSearchHistory();
  },

  clearSearchHistory: async () => {
    const prev = get().searchHistory;
    set({ searchHistory: [] });
    try {
      await desktopExtras.clearSearchHistory();
    } catch (err) {
      set({ searchHistory: prev, error: message(err) });
      toast.error('清除搜索历史失败', message(err));
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
    set({ filters: {}, search: '' });
    get().scheduleReload();
  },
  hasActiveFilters: () => {
    const { search, filters } = get();
    return search.trim() !== '' || Object.keys(filters).length > 0;
  },

  selectPrompt: (id) => set({ selectedPromptId: id }),
  clearError: () => set({ error: null }),

  highlightPrompt: async (id) => {
    // 新条目是在 Composer 里落库的，当前 prompts 数组里没有 —— 必须先刷
    await get().reloadPrompts();
    const target = get().prompts.find((p) => p.id === id);
    if (!target) {
      // 落在了当前筛选之外（比如正筛着某标签）：清掉筛选再刷一次，
      // 否则用户会看到「保存成功」但列表里什么都没有。
      get().clearFilters();
      await get().reloadPrompts();
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
  'search' | 'filters' | 'sort' | 'sortDir'
>): LibraryQuerySnapshot {
  return {
    search: s.search.trim() || undefined,
    filters: Object.keys(s.filters).length > 0 ? s.filters : undefined,
    sort: s.sort,
    sortDir: s.sortDir,
  };
}

// ---------- 派生选择器 ----------
//
// 注意：zustand v5 的 useStore 用 Object.is 比较选择器结果，
// 每次返回新数组 = 每次都「变了」= 无限重渲染（React #185，整棵树被卸载）。
// 所以凡是返回新数组的派生值，一律通过下面的 hook 走 useShallow，
// 不要在组件里写 useLibraryStore(selectPinned)。

/** 置顶区（按 pin_order 升序），供 PromptList 分区渲染 */
export function selectPinned(s: Pick<LibraryState, 'prompts'>): DesktopLibraryPrompt[] {
  return s.prompts.filter((p) => p.isPinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
}

/** 普通区（后端已排好序，此处保序） */
export function selectNormal(s: Pick<LibraryState, 'prompts'>): DesktopLibraryPrompt[] {
  return s.prompts.filter((p) => !p.isPinned);
}

/** 置顶区（引用稳定） */
export function usePinnedPrompts(): DesktopLibraryPrompt[] {
  return useLibraryStore(useShallow(selectPinned));
}

/** 普通区（引用稳定） */
export function useNormalPrompts(): DesktopLibraryPrompt[] {
  return useLibraryStore(useShallow(selectNormal));
}
