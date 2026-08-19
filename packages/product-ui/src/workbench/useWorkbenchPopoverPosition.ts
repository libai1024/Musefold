import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

interface WorkbenchPopoverPositionOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  maxHeight?: number;
  viewportPadding?: number;
  gap?: number;
}

/**
 * Positions Composer popovers above the whole surface instead of above only
 * the toolbar button, which prevents tall menus from covering the prompt.
 */
export function useWorkbenchPopoverPosition({
  open,
  anchorRef,
  menuRef,
  maxHeight = 520,
  viewportPadding = 12,
  gap = 8,
}: WorkbenchPopoverPositionOptions): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!open || !anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    const composer = anchor.closest<HTMLElement>(".mf-workbench-composer");
    const surfaceRect = (
      composer?.querySelector<HTMLElement>(".mf-workbench-composer-surface") ??
      anchor.closest<HTMLElement>(".mf-workbench-composer-surface")
    )?.getBoundingClientRect();
    const safeBottom = Math.max(
      viewportPadding + 120,
      (surfaceRect?.top ?? anchorRect.top) - gap,
    );
    const availableHeight = Math.max(
      120,
      Math.min(maxHeight, safeBottom - viewportPadding),
    );

    menu.style.maxHeight = `${availableHeight}px`;
    const menuWidth = menu.getBoundingClientRect().width;
    const menuHeight = Math.min(menu.scrollHeight, availableHeight);
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - menuWidth - viewportPadding,
    );
    const preferredLeft =
      window.innerWidth <= 640
        ? (window.innerWidth - menuWidth) / 2
        : anchorRect.right - menuWidth;
    const left = Math.min(Math.max(viewportPadding, preferredLeft), maxLeft);
    const top = Math.max(viewportPadding, safeBottom - menuHeight);

    setStyle({
      position: "fixed",
      left,
      top,
      maxHeight: availableHeight,
      visibility: "visible",
    });
  }, [anchorRef, gap, maxHeight, menuRef, open, viewportPadding]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({
        position: "fixed",
        left: 0,
        top: 0,
        visibility: "hidden",
      });
      return;
    }
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, update]);

  useEffect(() => {
    if (open) return;
    setStyle({
      position: "fixed",
      left: 0,
      top: 0,
      visibility: "hidden",
    });
  }, [open]);

  return style;
}
