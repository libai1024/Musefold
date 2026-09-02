import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * 壳侧栏几何与宽度偏好(承 v2.5-baseline `ProductSidebarLayout`,ui-parity 01 §2.1/§7):
 * 默认 248 / 最小 220 / 最大 360,超宽窗口另受 32vw 约束,优先保护主区与结果网格。
 */
export const SHELL_SIDEBAR_DEFAULT_WIDTH = 248;
export const SHELL_SIDEBAR_MIN_WIDTH = 220;
export const SHELL_SIDEBAR_MAX_WIDTH = 360;
/** 视口宽度 < 768px 时侧栏转 overlay 抽屉,与 Tailwind `md` 常驻栏边界无缝衔接。 */
export const SHELL_SIDEBAR_COMPACT_BREAKPOINT = 767;
/** 抽屉宽度:承旧 `min(320px, max(220px, 100vw - 28px))`。 */
export const SHELL_SIDEBAR_DRAWER_WIDTH = 'min(320px, max(220px, calc(100vw - 28px)))';
/** 键盘步进(方向键 ±16,承旧)。 */
export const SHELL_SIDEBAR_RESIZE_STEP = 16;

/**
 * 宽度持久化键 —— 承旧 `musefold:sidebar-width`(localStorage)。
 *
 * 为什么不进 `AppPreferences` 契约:侧栏宽度是纯 UI 布局状态,packages/AGENTS.md 契约纪律
 * 明确「纯 UI 状态不进任何契约」;旧版同样走 localStorage 直存,键位不变意味着存量
 * 用户(localStorage 同源延续)宽度偏好无损承接到新壳。跨端同步与 D6 一样留待后续版本。
 */
export const SHELL_SIDEBAR_WIDTH_STORAGE_KEY = 'musefold:sidebar-width';

/** 最大宽度:min(360, floor(视口宽 × 0.32)),且不跌破最小值(承旧 maxSidebarWidth)。 */
export function resolveSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    SHELL_SIDEBAR_MIN_WIDTH,
    Math.min(SHELL_SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * 0.32)),
  );
}

/** 把任意宽度夹进 [min, max];非有限数回退默认值。 */
export function clampSidebarWidth(width: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return SHELL_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(maxWidth, Math.max(SHELL_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * 读持久化宽度;无存档/非法值返回 null(调用方回落默认)。
 * 历史越界值(如旧版 200–219px)由 clamp 收回区间(承旧 readInitialWidth)。
 * 存储不可读(隐私模式/被禁用时访问即抛)同样安全回退。
 */
export function readStoredSidebarWidth(
  storage: Storage | null,
  viewportWidth: number,
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) return null;
    const saved = Number(raw);
    if (!Number.isFinite(saved)) return null;
    return clampSidebarWidth(saved, resolveSidebarMaxWidth(viewportWidth));
  } catch {
    return null;
  }
}

/** 写持久化宽度;存储被禁用/超配额时静默放弃(壳布局不因此崩)。 */
export function writeStoredSidebarWidth(storage: Storage | null, width: number): void {
  if (!storage) return;
  try {
    storage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // 忽略:宽度退化为会话内状态。
  }
}

/** 访问 localStorage 本身也可能抛(禁用 DOM Storage 的环境),统一从这里取。 */
function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** SSR/jsdom 安全的媒体查询(与 history `useMediaQuery` 同构;不支持的环境回退 false)。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

/**
 * 侧栏宽度状态机:拖拽/键盘/双击共用 `apply` 单入口(夹取 + 持久化)。
 *
 * SSR 说明(Web 宿主):宽度永远以默认值起渲染,挂载后再读 localStorage 应用存档。
 * 服务端无法知道本机宽度,若像旧版(CSR)在 useState 初始化器里直读存储,会造成
 * hydration 不一致;代价是存档宽度 ≠ 默认值时首帧后有一次宽度校正(承 D6 同口径:
 * 本机布局偏好,不进云同步)。
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const widthRef = useRef(width);
  // aria-valuemax 需要渲染期稳定的值:先以静态上限 360 起渲染(SSR 一致),挂载后同步 32vw 动态上限。
  const [maxWidth, setMaxWidth] = useState(SHELL_SIDEBAR_MAX_WIDTH);

  const applyWidth = useCallback((next: number) => {
    const currentMax =
      typeof window === 'undefined'
        ? SHELL_SIDEBAR_MAX_WIDTH
        : resolveSidebarMaxWidth(window.innerWidth);
    const clamped = clampSidebarWidth(next, currentMax);
    widthRef.current = clamped;
    setWidth(clamped);
    writeStoredSidebarWidth(localStorageOrNull(), clamped);
  }, []);

  // 挂载后读存档(SSR 安全两段式);视口缩放时按 32vw 上限重新夹取(承旧 resize 监听)。
  useEffect(() => {
    const syncMaxWidth = () => setMaxWidth(resolveSidebarMaxWidth(window.innerWidth));
    syncMaxWidth();
    const saved = readStoredSidebarWidth(localStorageOrNull(), window.innerWidth);
    if (saved !== null && saved !== widthRef.current) {
      widthRef.current = saved;
      setWidth(saved);
    }
    const handleResize = () => {
      syncMaxWidth();
      const clamped = clampSidebarWidth(
        widthRef.current,
        resolveSidebarMaxWidth(window.innerWidth),
      );
      if (clamped !== widthRef.current) {
        widthRef.current = clamped;
        setWidth(clamped);
        writeStoredSidebarWidth(localStorageOrNull(), clamped);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const resetWidth = useCallback(() => applyWidth(SHELL_SIDEBAR_DEFAULT_WIDTH), [applyWidth]);

  return { width, widthRef, maxWidth, applyWidth, resetWidth };
}
