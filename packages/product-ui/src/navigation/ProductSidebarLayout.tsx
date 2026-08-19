import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export const PRODUCT_SIDEBAR_DEFAULT_WIDTH = 244;
export const PRODUCT_SIDEBAR_MIN_WIDTH = 200;
export const PRODUCT_SIDEBAR_COMPACT_BREAKPOINT = 760;

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

function readInitialWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
): number {
  if (typeof window === "undefined") return defaultWidth;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return defaultWidth;
  const saved = Number(raw);
  return Number.isFinite(saved)
    ? Math.min(Math.max(saved, minWidth), defaultWidth * 2)
    : defaultWidth;
}

export function ProductSidebarLayout({
  open,
  onOpenChange,
  sidebar,
  children,
  compactDismissKey,
  storageKey = "musefold:sidebar-width",
  defaultSidebarWidth = PRODUCT_SIDEBAR_DEFAULT_WIDTH,
  minSidebarWidth = PRODUCT_SIDEBAR_MIN_WIDTH,
  className = "",
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
      typeof window === "undefined"
        ? defaultSidebarWidth * 2
        : Math.max(minSidebarWidth, Math.floor(window.innerWidth * 0.5)),
    [defaultSidebarWidth, minSidebarWidth],
  );

  const applySidebarWidth = useCallback(
    (width: number) => {
      const next = Math.min(
        maxSidebarWidth(),
        Math.max(minSidebarWidth, Math.round(width)),
      );
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, String(next));
      }
    },
    [maxSidebarWidth, minSidebarWidth, storageKey],
  );

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    const media = window.matchMedia(
      `(max-width: ${PRODUCT_SIDEBAR_COMPACT_BREAKPOINT}px)`,
    );
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
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, [onOpenChange]);

  useEffect(() => {
    const handleResize = () => applySidebarWidth(sidebarWidthRef.current);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [applySidebarWidth]);

  useEffect(() => {
    if (compact) onOpenChange(false);
  }, [compact, compactDismissKey, onOpenChange]);

  const compactWidth = `min(304px, max(${minSidebarWidth}px, calc(100vw - 48px)))`;
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
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (compact || !open) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current + 16);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      applySidebarWidth(sidebarWidthRef.current - 16);
    } else if (event.key === "Home") {
      event.preventDefault();
      applySidebarWidth(minSidebarWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      applySidebarWidth(maxSidebarWidth());
    }
  };

  return (
    <div
      className={`mf-product-sidebar-layout ${className}`}
      data-compact={compact ? "true" : "false"}
      data-resizing={resizing ? "true" : "false"}
      data-testid="product-sidebar-layout"
    >
      <div
        className="mf-product-sidebar-rail"
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
        style={{
          width: open ? visibleWidth : 0,
          visibility: open ? "visible" : "hidden",
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

      {children}
    </div>
  );
}
