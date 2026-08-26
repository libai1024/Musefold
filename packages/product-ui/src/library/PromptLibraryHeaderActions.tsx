import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from '@musefold/ui';
import { MoreHorizontal, Plus, RefreshCw, Trash2 } from '@musefold/ui/icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type PromptLibraryMenuItems = ReactNode | ((close: () => void) => ReactNode);

export interface PromptLibraryHeaderActionsProps {
  onCreate: () => void;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  onOpenTrash?: () => void;
  trashCount?: number;
  extraMenuItems?: PromptLibraryMenuItems;
  trashTestId?: string;
}

export function PromptLibraryHeaderActions({
  onCreate,
  onRefresh,
  refreshing = false,
  onOpenTrash,
  trashCount = 0,
  extraMenuItems,
  trashTestId = 'library-trash',
}: PromptLibraryHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      menuContentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="mf-library-header-actions">
      {onRefresh ? (
        <IconButton
          className="mf-icon-button mf-library-refresh"
          label="刷新提示词"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          data-loading={refreshing ? 'true' : 'false'}
          data-testid="library-refresh"
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
      ) : null}
      {extraMenuItems || onOpenTrash ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton className="mf-icon-button" label="提示词库操作" data-testid="library-menu">
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            ref={menuContentRef}
            className="mf-prompt-detail-menu"
            align="end"
            sideOffset={6}
            aria-label="提示词库操作"
          >
            {typeof extraMenuItems === 'function' ? extraMenuItems(closeMenu) : extraMenuItems}
            {onOpenTrash ? (
              <DropdownMenuItem
                onSelect={() => {
                  closeMenu();
                  onOpenTrash();
                }}
                data-testid={trashTestId}
              >
                <Trash2 aria-hidden="true" />
                回收站
                {trashCount > 0 ? <span>{trashCount}</span> : null}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
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
    </div>
  );
}
