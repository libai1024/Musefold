// src/components/layout/Sidebar.tsx
// Codex 指挥中心导航轨 —— 分区导航（计数 + 活动指示） + 底部 Provider 状态
// 详见 docs/06-ui-design-system.md §6.2

import { useEffect, useMemo, useState } from "react";
import { Power } from "../ui/icons";
import { useAppStore, type ViewKey } from "../../stores/app";
import { useGenerationWorkbenchStore } from "../../features/generation/workbench/store";
import { useDesktopWorkbenchSessionList } from "../../features/generation/workbench/workbench-session-query";
import { Button } from "../ui/button";
import { desktopHost as api } from "@renderer/runtime/desktop-host-services";
import { WORKBENCH_SESSION_RESTART_REQUIRED } from "../../features/generation/workbench/sessionErrors";
import { usePlatform, useWindowFullscreen } from "../../lib/usePlatform";
import { SidebarAccessSwitcher } from "./SidebarAccessSwitcher";
import {
  readPinnedSessionIds,
  readUnreadSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  SESSION_UNREAD_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
} from "../../features/generation/workbench/sessionPreferences";
import {
  WorkbenchSessionList,
  WorkbenchSessionContextMenu,
  WorkbenchSessionDeleteDialog,
  type WorkbenchSessionListItemViewModel,
  ProductSidebar,
  buildSidebarNavItems,
} from "@musefold/product-ui";
import { capabilities } from "../../runtime/capabilities";

export function Sidebar() {
  const { isMac } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const newConversation = useAppStore((s) => s.newConversation);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const navItems = buildSidebarNavItems({
    surface: "desktop",
    capabilities,
    currentView,
    onSelect: (id) => setView(id as ViewKey),
  });

  return (
    <ProductSidebar
      navItems={navItems}
      onNewDesign={newConversation}
      onCollapse={() => setSidebarCollapsed(true)}
      newShortcut={`${isMac ? "⌘" : "Ctrl"} N`}
      headerStartInset={isMac && !isFullscreen ? 86 : 12}
      sessionList={<ConversationList />}
      footer={<SidebarAccessSwitcher />}
      ariaLabel="Musefold 导航"
    />
  );
}

function ConversationList() {
  const currentView = useAppStore((s) => s.currentView);
  const {
    sessions,
    loading,
    error: queryError,
    refetch,
  } = useDesktopWorkbenchSessionList();
  const activeSessionId = useGenerationWorkbenchStore((s) => s.activeSessionId);
  // 并行生成：逐会话点亮运行指示（稳定字符串选择器避免无谓重渲）。
  const runningSessionKey = useGenerationWorkbenchStore((s) =>
    Object.values(s.runningTurns)
      .map((entry) => entry.sessionId)
      .sort()
      .join(","),
  );
  const mutationError = useGenerationWorkbenchStore((s) => s.sessionsError);
  const error = mutationError ?? queryError;
  const openSession = useGenerationWorkbenchStore((s) => s.openSession);
  const renameSession = useGenerationWorkbenchStore((s) => s.renameSession);
  const archiveSession = useGenerationWorkbenchStore((s) => s.archiveSession);
  const deleteSession = useGenerationWorkbenchStore((s) => s.deleteSession);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
    returnFocusTarget: HTMLElement;
  } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [pinnedSessionIds, setPinnedSessionIds] =
    useState(readPinnedSessionIds);
  const [unreadSessionIds, setUnreadSessionIds] =
    useState(readUnreadSessionIds);
  const restartRequired = error === WORKBENCH_SESSION_RESTART_REQUIRED;
  const conversationItems = useMemo<WorkbenchSessionListItemViewModel[]>(() => {
    const runningSessionIds = new Set(
      runningSessionKey ? runningSessionKey.split(",") : [],
    );
    return sessions.map((session) => {
      const running =
        runningSessionIds.has(session.id) ||
        session.latestStatus === "queued" ||
        session.latestStatus === "running";
      const unread = !running && unreadSessionIds.includes(session.id);
      return {
        id: session.id,
        title: session.title,
        updatedAt: new Date(session.updatedAt).toISOString(),
        kind: session.conversationKind ?? "chat",
        selected: activeSessionId === session.id,
        pinned: pinnedSessionIds.includes(session.id),
        status: running ? "running" : unread ? "unread" : "idle",
      };
    });
  }, [
    activeSessionId,
    pinnedSessionIds,
    runningSessionKey,
    sessions,
    unreadSessionIds,
  ]);

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    return () =>
      window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
  }, []);

  useEffect(() => {
    const syncUnread = () => setUnreadSessionIds(readUnreadSessionIds());
    window.addEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
    return () =>
      window.removeEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
  }, []);

  // 回到制作工作台查看当前会话即视为已读；仅在视图/会话切换时清除，
  // 不清除用户在停留期间手动标记的未读。
  useEffect(() => {
    if (currentView !== "generate" || !activeSessionId) return;
    if (readUnreadSessionIds().includes(activeSessionId)) {
      setUnreadSessionIds(setSessionUnread(activeSessionId, false));
    }
  }, [currentView, activeSessionId]);

  const submitRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) return;
    await renameSession(id, title);
    setRenameId(null);
    setRenameValue("");
  };

  return (
    <div className="no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkbenchSessionList
        items={conversationItems}
        loading={loading}
        error={error}
        errorTitle={restartRequired ? "需要重启应用" : "对话读取失败"}
        errorActions={
          restartRequired ? (
            <Button
              size="xs"
              onClick={() => void api.system.relaunch()}
              data-testid="workbench-session-relaunch"
            >
              <Power className="h-3 w-3" /> 立即重启
            </Button>
          ) : undefined
        }
        emptyLabel="还没有对话。点「新设计」开始，发送后会立即出现在这里。"
        editingId={renameId}
        editingValue={renameValue}
        onEditingValueChange={setRenameValue}
        onCancelRename={() => setRenameId(null)}
        onSubmitRename={(item) => void submitRename(item.id)}
        onOpen={(item) => {
          setUnreadSessionIds(setSessionUnread(item.id, false));
          void openSession(item.id);
        }}
        onTogglePinned={(item) => {
          setPinnedSessionIds(setSessionPinned(item.id, !item.pinned));
        }}
        onArchive={(item) => {
          setUnreadSessionIds(setSessionUnread(item.id, false));
          void archiveSession(item.id, true);
        }}
        onContextMenu={(item, anchor, returnFocusTarget) => {
          setContextMenu({
            id: item.id,
            title: item.title,
            ...anchor,
            returnFocusTarget,
          });
        }}
        onRetry={() => void refetch()}
      />
      {contextMenu && (
        <WorkbenchSessionContextMenu
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          returnFocusTarget={contextMenu.returnFocusTarget}
          title={contextMenu.title}
          pinned={pinnedSessionIds.includes(contextMenu.id)}
          onClose={() => setContextMenu(null)}
          onTogglePinned={() => {
            const pinned = pinnedSessionIds.includes(contextMenu.id);
            setPinnedSessionIds(setSessionPinned(contextMenu.id, !pinned));
          }}
          onRename={() => {
            setRenameId(contextMenu.id);
            setRenameValue(contextMenu.title);
          }}
          onArchive={() => {
            setUnreadSessionIds(setSessionUnread(contextMenu.id, false));
            void archiveSession(contextMenu.id, true);
          }}
          onMarkUnread={() => {
            setUnreadSessionIds(setSessionUnread(contextMenu.id, true));
          }}
          onDelete={() =>
            setDeleteTarget({ id: contextMenu.id, title: contextMenu.title })
          }
        />
      )}
      <WorkbenchSessionDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void deleteSession(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
