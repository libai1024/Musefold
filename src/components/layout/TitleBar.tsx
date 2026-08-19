// 平台自适应标题栏：当前对话入口 + 全局搜索。
// 品牌与常用设置归侧栏所有；侧栏收起时 mac 标题栏为原生交通灯让位。

import { useEffect, useState } from "react";
import { LibraryBig, PanelLeft, Search } from "../ui/icons";
import { useAppStore } from "../../stores/app";
import { useGenerationWorkbenchStore } from "../../features/generation/workbench/store";
import {
  readPinnedSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
} from "../../features/generation/workbench/sessionPreferences";
import { usePlatform, useWindowFullscreen } from "../../lib/usePlatform";
import { MinimizeWindowButton, WindowControls } from "./WindowControls";
import { cn } from "../../lib/utils";
import { IconButton } from "@musefold/ui";
import {
  ProductTopbar,
  ProductViewIcon,
  productTopbarDisplayTitle,
  WorkbenchSessionDeleteDialog,
  WorkbenchSessionMenuTrigger,
  WorkbenchSessionRenameDialog,
} from "@musefold/product-ui";

const VIEW_TITLES = {
  generate: "新设计",
  library: "提示词库",
  "design-schemes": "设计方案",
  history: "生成历史",
  settings: "设置",
} as const;

export function TitleBar() {
  const { isMac, isWin, isLinux } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const openCommand = useAppStore((state) => state.toggleCommand);
  const materialLibraryOpen = useAppStore((state) => state.materialLibraryOpen);
  const toggleMaterialLibrary = useAppStore(
    (state) => state.toggleMaterialLibrary,
  );
  const currentView = useAppStore((state) => state.currentView);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const turns = useGenerationWorkbenchStore((state) => state.turns);
  const sessions = useGenerationWorkbenchStore((state) => state.sessions);
  const activeSessionId = useGenerationWorkbenchStore(
    (state) => state.activeSessionId,
  );
  const materialsDisabled = useGenerationWorkbenchStore((state) =>
    Boolean(state.refinementContext),
  );
  const renameSession = useGenerationWorkbenchStore(
    (state) => state.renameSession,
  );
  const archiveSession = useGenerationWorkbenchStore(
    (state) => state.archiveSession,
  );
  const deleteSession = useGenerationWorkbenchStore(
    (state) => state.deleteSession,
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pinnedSessionIds, setPinnedSessionIds] =
    useState(readPinnedSessionIds);
  const hasCustomControls = isWin || isLinux;

  const persistedSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const firstPrompt = turns[0]?.prompt.trim() ?? "";
  const sessionTitle = (persistedSession?.title ?? firstPrompt) || "新设计";
  const fullTitle =
    currentView === "generate" ? sessionTitle : VIEW_TITLES[currentView];
  const shortTitle = productTopbarDisplayTitle(fullTitle);
  const isPinned = activeSessionId
    ? pinnedSessionIds.includes(activeSessionId)
    : false;

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    return () =>
      window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
  }, []);

  const openRename = () => {
    setRenameOpen(true);
  };

  // 侧栏可见时交通灯落在侧栏品牌区；侧栏收起后由主标题栏让位。
  const leftInset = isMac && !isFullscreen && sidebarCollapsed ? 78 : 12;

  const sessionMenu =
    currentView === "generate" && activeSessionId ? (
      <WorkbenchSessionMenuTrigger
        title={sessionTitle}
        pinned={isPinned}
        onTogglePinned={() =>
          setPinnedSessionIds(setSessionPinned(activeSessionId, !isPinned))
        }
        onRename={openRename}
        onArchive={() => void archiveSession(activeSessionId)}
        onMarkUnread={() => {
          setSessionUnread(activeSessionId, true);
        }}
        onDelete={() => setDeleteOpen(true)}
        className="mf-product-topbar-icon-button"
        testId="titlebar-session-menu-trigger"
      />
    ) : undefined;

  const leading = sidebarCollapsed ? (
    <div
      className="no-drag"
      style={{ marginLeft: Math.max(0, leftInset - 12) }}
    >
      <IconButton
        onClick={toggleSidebar}
        className="mf-product-topbar-icon-button"
        label="展开侧栏"
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </div>
  ) : undefined;

  const actions = (
    <>
      <div className="no-drag flex items-center pr-1">
        <IconButton
          onClick={openCommand}
          className="mf-product-topbar-icon-button"
          label="搜索与命令"
          title={`搜索与命令（${isMac ? "⌘" : "Ctrl"} K）`}
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
        {currentView === "generate" && (
          <IconButton
            onClick={toggleMaterialLibrary}
            disabled={materialsDisabled}
            className={cn(
              "mf-product-topbar-icon-button",
              materialLibraryOpen && "bg-accent-soft text-accent",
              materialsDisabled && "cursor-not-allowed opacity-40",
            )}
            label={
              materialsDisabled
                ? "退出微调后可打开素材库"
                : materialLibraryOpen
                  ? "关闭素材库"
                  : "打开素材库"
            }
            aria-pressed={materialLibraryOpen}
            title={
              materialsDisabled
                ? "退出微调后可打开素材库"
                : materialLibraryOpen
                  ? "关闭素材库"
                  : "打开素材库"
            }
            data-testid="titlebar-materials-toggle"
          >
            <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        )}
      </div>
      {isMac && !isFullscreen && <MinimizeWindowButton />}
      {hasCustomControls ? (
        <>
          <div className="mr-0.5 h-4 w-px bg-border-subtle" />
          <WindowControls />
        </>
      ) : (
        <div className="w-2" />
      )}
    </>
  );

  return (
    <>
      <ProductTopbar
        title={fullTitle}
        displayTitle={shortTitle}
        icon={<ProductViewIcon view={currentView} />}
        leading={leading}
        titleSuffix={sessionMenu}
        actions={actions}
        className="relative z-30"
      />

      <WorkbenchSessionRenameDialog
        open={renameOpen}
        title={sessionTitle}
        onOpenChange={setRenameOpen}
        onConfirm={async (title) => {
          if (activeSessionId) await renameSession(activeSessionId, title);
          setRenameOpen(false);
        }}
      />
      <WorkbenchSessionDeleteDialog
        open={deleteOpen}
        title={sessionTitle}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (activeSessionId) void deleteSession(activeSessionId);
          setDeleteOpen(false);
        }}
      />
    </>
  );
}
