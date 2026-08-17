// 平台自适应标题栏：当前对话入口 + 全局搜索。
// 品牌与常用设置归侧栏所有；侧栏收起时 mac 标题栏为原生交通灯让位。

import { useEffect, useState, type CSSProperties } from 'react';
import {
  Archive,
  LibraryBig,
  MessageSquareText,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  Search,
} from '../ui/icons';
import { useAppStore } from '../../stores/app';
import { useGenerationWorkbenchStore } from '../../features/generation/workbench/store';
import {
  readPinnedSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  setSessionPinned,
} from '../../features/generation/workbench/sessionPreferences';
import { usePlatform, useWindowFullscreen } from '../../lib/usePlatform';
import { MinimizeWindowButton, WindowControls } from './WindowControls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

const VIEW_TITLES = {
  generate: '新设计',
  library: '提示词库',
  'design-schemes': '设计方案',
  history: '生成历史',
  settings: '设置',
} as const;

export function TitleBar() {
  const { isMac, isWin, isLinux } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const openCommand = useAppStore((state) => state.toggleCommand);
  const materialLibraryOpen = useAppStore((state) => state.materialLibraryOpen);
  const toggleMaterialLibrary = useAppStore((state) => state.toggleMaterialLibrary);
  const currentView = useAppStore((state) => state.currentView);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const turns = useGenerationWorkbenchStore((state) => state.turns);
  const sessions = useGenerationWorkbenchStore((state) => state.sessions);
  const activeSessionId = useGenerationWorkbenchStore((state) => state.activeSessionId);
  const materialsDisabled = useGenerationWorkbenchStore((state) => Boolean(state.refinementContext));
  const renameSession = useGenerationWorkbenchStore((state) => state.renameSession);
  const archiveSession = useGenerationWorkbenchStore((state) => state.archiveSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const hasCustomControls = isWin || isLinux;

  const persistedSession = sessions.find((session) => session.id === activeSessionId);
  const firstPrompt = turns[0]?.prompt.trim() ?? '';
  const sessionTitle = (persistedSession?.title ?? firstPrompt) || '新设计';
  const fullTitle = currentView === 'generate' ? sessionTitle : VIEW_TITLES[currentView];
  const shortTitle = fullTitle.length > 10 ? fullTitle.slice(0, 10) : fullTitle;
  const isPinned = activeSessionId ? pinnedSessionIds.includes(activeSessionId) : false;

  useEffect(() => {
    setMenuOpen(false);
  }, [activeSessionId, currentView]);

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    return () => window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-titlebar-session-menu]')) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const openRename = () => {
    setRenameValue(sessionTitle);
    setRenameOpen(true);
    setMenuOpen(false);
  };

  const submitRename = async () => {
    if (!activeSessionId || !renameValue.trim()) return;
    await renameSession(activeSessionId, renameValue.trim());
    setRenameOpen(false);
  };

  // 侧栏可见时交通灯落在侧栏品牌区；侧栏收起后由主标题栏让位。
  const leftInset = isMac && !isFullscreen && sidebarCollapsed ? 78 : 12;

  return (
    <>
      <header data-testid="titlebar" className="drag-region relative z-30 flex h-[52px] shrink-0 items-center border-b border-border-subtle bg-elevated pr-2">
        <div
          style={{ '--titlebar-left-inset': `${leftInset}px` } as CSSProperties}
          className="flex min-w-0 flex-1 items-center gap-1.5 pl-[var(--titlebar-left-inset)] max-[760px]:pl-2"
        >
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label="展开侧栏"
              title="展开侧栏"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-tertiary" aria-hidden="true">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <h1 data-testid="titlebar-title" className="min-w-0 max-w-[260px] truncate text-[12px] font-medium text-primary" title={fullTitle}>
            {shortTitle}
          </h1>
          {currentView === 'generate' && activeSessionId && (
            <div className="no-drag relative" data-titlebar-session-menu>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                aria-label="管理当前对话"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="管理当前对话"
                data-testid="titlebar-session-menu-trigger"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+6px)] z-50 w-40 rounded-lg border border-border-default bg-popover p-1 shadow-pop"
                  data-testid="titlebar-session-menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPinnedSessionIds(setSessionPinned(activeSessionId, !isPinned));
                      setMenuOpen(false);
                    }}
                    className="menu-action"
                  >
                    <Pin className="h-3.5 w-3.5" /> {isPinned ? '取消置顶' : '置顶对话'}
                  </button>
                  <button type="button" role="menuitem" onClick={openRename} className="menu-action">
                    <Pencil className="h-3.5 w-3.5" /> 重命名对话
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void archiveSession(activeSessionId);
                      setMenuOpen(false);
                    }}
                    className="menu-action"
                  >
                    <Archive className="h-3.5 w-3.5" /> 归档对话
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex h-full min-w-0 items-center justify-end">
          <div className="no-drag flex items-center pr-1">
            <button
              type="button"
              onClick={openCommand}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label="搜索与命令"
              title={`搜索与命令（${isMac ? '⌘' : 'Ctrl'} K）`}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {currentView === 'generate' && (
              <button
                type="button"
                onClick={toggleMaterialLibrary}
                disabled={materialsDisabled}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                  materialLibraryOpen && 'bg-accent-soft text-accent',
                  materialsDisabled && 'cursor-not-allowed opacity-40',
                )}
                aria-label={materialsDisabled ? '退出微调后可打开素材库' : materialLibraryOpen ? '关闭素材库' : '打开素材库'}
                aria-pressed={materialLibraryOpen}
                title={materialsDisabled ? '退出微调后可打开素材库' : materialLibraryOpen ? '关闭素材库' : '打开素材库'}
                data-testid="titlebar-materials-toggle"
              >
                <LibraryBig className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isMac && !isFullscreen && <MinimizeWindowButton />}
          {hasCustomControls && (
            <>
              <div className="mr-0.5 h-4 w-px bg-border-subtle" />
              <WindowControls />
            </>
          )}
          {!hasCustomControls && <div className="w-2" />}
        </div>
      </header>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>为当前对话设置一个便于识别的标题。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={80}
              aria-label="对话标题"
              className="h-9 w-full rounded-md border border-border-default bg-elevated px-3 text-[12px] text-primary outline-none focus:border-border-strong focus:ring-0"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>取消</Button>
              <Button type="submit" disabled={!renameValue.trim()}>保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
