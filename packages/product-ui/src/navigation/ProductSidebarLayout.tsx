import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

// v2.0 Phase B(docs/v2.0/ui-design/10 §4.2):默认 248 / 最小 220 / 最大 360,
// 超宽窗口另受 32vw 约束,优先保护 MainView 与结果网格。
export const PRODUCT_SIDEBAR_DEFAULT_WIDTH = 248;
export const PRODUCT_SIDEBAR_MIN_WIDTH = 220;
export const PRODUCT_SIDEBAR_MAX_WIDTH = 360;
/**
 * Канонические адаптивные брейкпоинты, общие для web- и desktop-хостов.
 * CSS-медиазапросы в product-ui/styles.css и стилях хостов должны
 * использовать эти же значения:
 * - COMPACT (≤760px): сайдбар сворачивается в overlay-drawer.
 * - MOBILE (≤680px): телефонная раскладка в духе 豆包 — левый drawer
 *   (функции + список диалогов + аккаунт), главная сцена только
 *   тема разговора и общий composer.
 */
export const PRODUCT_SIDEBAR_COMPACT_BREAKPOINT = 760;
export const PRODUCT_MOBILE_BREAKPOINT = 680;

export interface ProductSidebarLayoutProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebar: ReactNode;
  children: ReactNode;
  compactDismissKey?: string;
  storageKey?: string;
  defaultSidebarWidth?: number;
  minSidebarWidth?: number;
  className?: string;
}

function readInitialWidth(storageKey: string, defaultWidth: number, minWidth: number): number {
  if (typeof window === 'undefined') return defaultWidth;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return defaultWidth;
  const saved = Number(raw);
  // v2.0:历史 200-219px 等旧值统一 clamp 进 220-360 区间(10 §B2)。
  return Number.isFinite(saved)
    ? Math.min(Math.max(saved, minWidth), PRODUCT_SIDEBAR_MAX_WIDTH)
    : defaultWidth;
}

export function ProductSidebarLayout({
  open,
  onOpenChange,
  sidebar,
  children,
  compactDismissKey,
  storageKey = 'musefold:sidebar-width',
  defaultSidebarWidth = PRODUCT_SIDEBAR_DEFAULT_WIDTH,
  minSidebarWidth = PRODUCT_SIDEBAR_MIN_WIDTH,
  className = '',
}: ProductSidebarLayoutProps) {
  const [compact, setCompact] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readInitialWidth(storageKey, defaultSidebarWidth, minSidebarWidth),
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const openRef = useRef(open);
  const compactRef = useRef(false);
  const openBeforeCompactRef = useRef(open);
  openRef.current = open;

  const maxSidebarWidth = useCallback(
    () =>
      typeof window === 'undefined'
        ? PRODUCT_SIDEBAR_MAX_WIDTH
        : Math.max(
            minSidebarWidth,
            Math.min(PRODUCT_SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.32)),
          ),
    [minSidebarWidth],
  );

  const applySidebarWidth = useCallback(
    (width: number) => {
      const next = Math.min(maxSidebarWidth(), Math.max(minSidebarWidth, Math.round(width)));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, String(next));
      }
    },
    [maxSidebarWidth, minSidebarWidth, storageKey],
  );

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${PRODUCT_SIDEBAR_COMPACT_BREAKPOINT}px)`);
    const sync = (matches: boolean) => {
      if (matches && !compactRef.current) {
        openBeforeCompactRef.current = openRef.current;
      }
      if (!matches && compactRef.current && openBeforeCompactRef.current) {
        onOpenChange(true);
      }
      compactRef.current = matches;
      setCompact(matches);
      if (matches) onOpenChange(false);
    };
    sync(media.matches);
    const handleChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, [onOpenChange]);

  useEffect(() => {
    const handleResize = () => applySidebarWidth(sidebarWidthRef.current);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applySidebarWidth]);

  useEffect(() => {
    if (compact) onOpenChange(false);
  }, [compact, compactDismissKey, onOpenChange]);

  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact || !open) return;
    const rail = railRef.current;
    if (!rail) return;

    const dismissOn = [
      '[data-testid="sidebar-new-design"]',
      '.mf-product-sidebar-nav-button',
      '.mf-workbench-session-open',
      '[data-testid="sidebar-account"]',
    ].join(', ');

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(dismissOn)) return;
      window.requestAnimationFrame(() => onOpenChange(false));
    };

    rail.addEventListener('click', handleClick);
    return () => rail.removeEventListener('click', handleClick);
  }, [compact, open, onOpenChange]);

  const compactWidth = `min(320px, max(${minSidebarWidth}px, calc(100vw - 28px)))`;
  const visibleWidth = compact ? compactWidth : sidebarWidth;

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || !open || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    setResizing(true);
    const handleMove = (moveEvent: PointerEvent) => {
      applySidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const stop = () => {
      setResizing(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (compact || !open) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current + 16);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current - 16);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applySidebarWidth(minSidebarWidth);
    } else if (event.key === 'End') {
      event.preventDefault();
      applySidebarWidth(maxSidebarWidth());
    }
  };

  return (
    <div
      className={`mf-product-sidebar-layout ${className}`}
      data-compact={compact ? 'true' : 'false'}
      data-resizing={resizing ? 'true' : 'false'}
      data-testid="product-sidebar-layout"
    >
      <div
        ref={railRef}
        className="mf-product-sidebar-rail"
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
        style={{
          width: open ? visibleWidth : 0,
          visibility: open ? 'visible' : 'hidden',
        }}
        data-testid="product-sidebar-rail"
      >
        {sidebar}
      </div>

      {!compact && open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          aria-valuemin={minSidebarWidth}
          aria-valuemax={maxSidebarWidth()}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => applySidebarWidth(defaultSidebarWidth)}
          onKeyDown={handleResizeKeyDown}
          className="mf-product-sidebar-resize-handle no-drag"
          style={{ left: sidebarWidth }}
          data-testid="sidebar-resize-handle"
        >
          <span />
        </div>
      ) : null}

      {compact && open ? (
        <button
          type="button"
          aria-label="关闭侧栏"
          onClick={() => onOpenChange(false)}
          className="mf-product-sidebar-scrim no-drag"
          data-testid="sidebar-scrim"
        />
      ) : null}

      {/* v2.0 Phase B:frame 负责 4px 内缩,surface 负责 12px 圆角与 bg-work 工作面。
          settings 全屏由 .settings-product-shell modifier 取消 inset 与圆角。 */}
      <div className="mf-mainview-frame" data-testid="mainview-frame">
        <div className="mf-mainview-surface" data-testid="mainview-surface">
          {children}
        </div>
      </div>
    </div>
  );
}
