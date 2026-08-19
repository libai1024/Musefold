import { Button, IconButton } from "@musefold/ui";
import { MoreHorizontal, Plus, Trash2 } from "@musefold/ui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";

type PromptLibraryMenuItems = ReactNode | ((close: () => void) => ReactNode);

export interface PromptLibraryHeaderActionsProps {
  onCreate: () => void;
  onOpenTrash?: () => void;
  trashCount?: number;
  extraMenuItems?: PromptLibraryMenuItems;
  trashTestId?: string;
}

export function PromptLibraryHeaderActions({
  onCreate,
  onOpenTrash,
  trashCount = 0,
  extraMenuItems,
  trashTestId = "library-trash",
}: PromptLibraryHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="mf-library-header-actions" ref={rootRef}>
      {(extraMenuItems || onOpenTrash) ? (
        <IconButton
          className="mf-icon-button"
          label="更多操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          data-testid="library-menu"
        >
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      ) : null}
      <Button
        variant="primary"
        className="mf-detail-primary"
        onClick={onCreate}
        data-testid="library-new"
        icon={<Plus aria-hidden="true" />}
      >
        新建
      </Button>
      {menuOpen ? (
        <div
          className="mf-prompt-detail-menu"
          role="menu"
          aria-label="提示词库操作"
        >
          {typeof extraMenuItems === "function"
            ? extraMenuItems(closeMenu)
            : extraMenuItems}
          {onOpenTrash ? (
            <Button
              variant="ghost"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onOpenTrash();
              }}
              data-testid={trashTestId}
              icon={<Trash2 aria-hidden="true" />}
            >
              回收站
              {trashCount > 0 ? <span>{trashCount}</span> : null}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
