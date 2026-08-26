import { useEffect, useMemo, useState } from 'react';
import { getProductCapabilities, productViewTitle } from '@musefold/domain';
import { PanelLeft, Search, Sparkles } from '@musefold/ui/icons';
import { IconButton } from '@musefold/ui';
import {
  ProductSidebar,
  ProductTopbar,
  ProductViewIcon,
  productTopbarDisplayTitle,
  WorkbenchSessionContextMenu,
  WorkbenchSessionDeleteDialog,
  WorkbenchSessionMenuTrigger,
  WorkbenchSessionRenameDialog,
  WorkbenchSessionList,
  readPinnedSessionIds,
  readUnreadSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  SESSION_UNREAD_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
  buildSidebarNavItems,
  resolveProductViewKey,
  type WorkbenchSessionListItemViewModel,
} from '@musefold/product-ui';
import type { WebGateway } from '../runtime';

const webCapabilities = getProductCapabilities('web');

export type WebView = 'generate' | 'prompts' | 'history' | 'settings';
export type WebSettingsSection = 'account' | 'connections';

interface WebSidebarProps {
  view: WebView;
  settingsSection: WebSettingsSection;
  accountName: string;
  mode: WebGateway['mode'];
  promptCount: number;
  workbenchSessions: WorkbenchSessionListItemViewModel[];
  sessionListLoading: boolean;
  sessionListError: string | null;
  onNavigate: (view: WebView) => void;
  onSettingsSectionChange: (section: WebSettingsSection) => void;
  onNewDesign: () => void;
  onCollapse: () => void;
  onOpenWorkbenchSession: (item: WorkbenchSessionListItemViewModel) => void;
  onArchiveWorkbenchSession: (item: WorkbenchSessionListItemViewModel) => void;
  onRenameWorkbenchSession: (
    item: WorkbenchSessionListItemViewModel,
    title: string,
  ) => void | Promise<void>;
  onDeleteWorkbenchSession: (item: WorkbenchSessionListItemViewModel) => void | Promise<void>;
  onRetryWorkbenchSessions: () => void;
}

export function WebSidebar({
  view,
  settingsSection,
  accountName,
  mode,
  promptCount,
  workbenchSessions,
  sessionListLoading,
  sessionListError,
  onNavigate,
  onSettingsSectionChange,
  onNewDesign,
  onCollapse,
  onOpenWorkbenchSession,
  onArchiveWorkbenchSession,
  onRenameWorkbenchSession,
  onDeleteWorkbenchSession,
  onRetryWorkbenchSessions,
}: WebSidebarProps) {
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const [unreadSessionIds, setUnreadSessionIds] = useState(readUnreadSessionIds);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    item: WorkbenchSessionListItemViewModel;
    x: number;
    y: number;
    returnFocusTarget: HTMLElement;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSessionListItemViewModel | null>(null);

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    const syncUnread = () => setUnreadSessionIds(readUnreadSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    window.addEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
    return () => {
      window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
      window.removeEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
    };
  }, []);

  const sessionItems = useMemo(
    () =>
      workbenchSessions.map(
        (item) =>
          ({
            ...item,
            pinned: pinnedSessionIds.includes(item.id),
            status:
              item.status === 'running'
                ? 'running'
                : unreadSessionIds.includes(item.id)
                  ? 'unread'
                  : 'idle',
          }) satisfies WorkbenchSessionListItemViewModel,
      ),
    [pinnedSessionIds, unreadSessionIds, workbenchSessions],
  );

  const closeDeleteDialog = () => setDeleteTarget(null);
  const navItems = buildSidebarNavItems({
    surface: 'web',
    capabilities: webCapabilities,
    currentView: view,
    onSelect: (id) => onNavigate(id as WebView),
    counts: { prompts: promptCount },
  });

  return (
    <>
      <ProductSidebar
        navItems={navItems}
        onNewDesign={onNewDesign}
        onCollapse={onCollapse}
        sessionList={
          <WorkbenchSessionList
            items={sessionItems}
            loading={sessionListLoading}
            error={sessionListError}
            emptyLabel="还没有对话。点「新设计」开始，发送后会立即出现在这里。"
            editingId={editingId}
            editingValue={editingValue}
            onEditingValueChange={setEditingValue}
            onCancelRename={() => {
              setEditingId(null);
              setEditingValue('');
            }}
            onSubmitRename={(item) => {
              const title = editingValue.trim();
              if (!title) return;
              void Promise.resolve(onRenameWorkbenchSession(item, title)).then(() => {
                setEditingId(null);
                setEditingValue('');
              });
            }}
            onOpen={(item) => {
              setUnreadSessionIds(setSessionUnread(item.id, false));
              onOpenWorkbenchSession(item);
            }}
            onTogglePinned={(item) => setPinnedSessionIds(setSessionPinned(item.id, !item.pinned))}
            onArchive={(item) => {
              setUnreadSessionIds(setSessionUnread(item.id, false));
              onArchiveWorkbenchSession(item);
            }}
            onContextMenu={(item, anchor, returnFocusTarget) =>
              setContextMenu({ item, ...anchor, returnFocusTarget })
            }
            onRetry={onRetryWorkbenchSessions}
          />
        }
        account={{
          name: accountName,
          detail: mode === 'fixture' ? '开发数据' : '个人账户',
          active: view === 'settings' && settingsSection === 'account',
          onSelect: () => {
            onSettingsSectionChange('account');
            onNavigate('settings');
          },
        }}
      />
      {contextMenu ? (
        <WorkbenchSessionContextMenu
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          returnFocusTarget={contextMenu.returnFocusTarget}
          title={contextMenu.item.title}
          pinned={contextMenu.item.pinned ?? false}
          onClose={() => setContextMenu(null)}
          onTogglePinned={() =>
            setPinnedSessionIds(
              setSessionPinned(contextMenu.item.id, !(contextMenu.item.pinned ?? false)),
            )
          }
          onRename={() => {
            setEditingId(contextMenu.item.id);
            setEditingValue(contextMenu.item.title);
          }}
          onArchive={() => {
            setUnreadSessionIds(setSessionUnread(contextMenu.item.id, false));
            onArchiveWorkbenchSession(contextMenu.item);
          }}
          onMarkUnread={() => setUnreadSessionIds(setSessionUnread(contextMenu.item.id, true))}
          onDelete={() => {
            setPinnedSessionIds(setSessionPinned(contextMenu.item.id, false));
            setUnreadSessionIds(setSessionUnread(contextMenu.item.id, false));
            setDeleteTarget(contextMenu.item);
          }}
        />
      ) : null}
      <WorkbenchSessionDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
        onConfirm={() => {
          if (deleteTarget) void onDeleteWorkbenchSession(deleteTarget);
          closeDeleteDialog();
        }}
      />
    </>
  );
}

interface WebTopbarProps {
  view: WebView;
  quota: string;
  mode: WebGateway['mode'];
  workbenchTitle: string | null;
  workbenchSession: WorkbenchSessionListItemViewModel | null;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onSearch: () => void;
  onRenameSession: (item: WorkbenchSessionListItemViewModel, title: string) => void | Promise<void>;
  onArchiveSession: (item: WorkbenchSessionListItemViewModel) => void | Promise<void>;
  onDeleteSession: (item: WorkbenchSessionListItemViewModel) => void | Promise<void>;
}

export function WebTopbar({
  view,
  quota,
  mode,
  workbenchTitle,
  workbenchSession,
  sidebarOpen,
  onOpenSidebar,
  onSearch,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
}: WebTopbarProps) {
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSessionListItemViewModel | null>(null);
  const [renameTarget, setRenameTarget] = useState<WorkbenchSessionListItemViewModel | null>(null);

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    return () => window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
  }, []);

  const fullTitle = view === 'generate' && workbenchTitle ? workbenchTitle : productViewTitle(view);

  return (
    <>
      <ProductTopbar
        title={fullTitle}
        displayTitle={productTopbarDisplayTitle(fullTitle)}
        icon={<ProductViewIcon view={resolveProductViewKey(view)} />}
        statusLabel={mode === 'fixture' ? '开发预览' : undefined}
        titleSuffix={
          view === 'generate' && workbenchSession ? (
            <WorkbenchSessionMenuTrigger
              title={workbenchSession.title}
              pinned={pinnedSessionIds.includes(workbenchSession.id)}
              onTogglePinned={() =>
                setPinnedSessionIds(
                  setSessionPinned(
                    workbenchSession.id,
                    !pinnedSessionIds.includes(workbenchSession.id),
                  ),
                )
              }
              onRename={() => setRenameTarget(workbenchSession)}
              onArchive={() => void onArchiveSession(workbenchSession)}
              onMarkUnread={() => {
                setSessionUnread(workbenchSession.id, true);
              }}
              onDelete={() => setDeleteTarget(workbenchSession)}
              className="mf-product-topbar-icon-button"
              testId="web-topbar-session-menu-trigger"
            />
          ) : null
        }
        leading={
          !sidebarOpen ? (
            <IconButton
              onClick={onOpenSidebar}
              className="mf-product-topbar-icon-button"
              label="展开侧栏"
            >
              <PanelLeft aria-hidden="true" />
            </IconButton>
          ) : undefined
        }
        actions={
          <>
            <IconButton
              className="mf-product-topbar-icon-button"
              title="搜索"
              label="搜索"
              onClick={onSearch}
              data-testid="web-topbar-search"
            >
              <Search aria-hidden="true" />
            </IconButton>
            {/* quota-readout 类名保留：680px 媒体块的移动端尺寸规则挂在它上（批次 5 收口） */}
            <div
              className="quota-readout inline-flex h-[28px] items-center gap-[6px] rounded-sm border border-solid border-subtle px-[8px] text-[11px] text-secondary tabular-nums"
              aria-label={`可用额度 ${quota}`}
            >
              <Sparkles aria-hidden="true" className="h-[13px] w-[13px] text-accent" />
              <span>{quota}</span>
            </div>
          </>
        }
      />
      <WorkbenchSessionDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void onDeleteSession(deleteTarget);
          setDeleteTarget(null);
        }}
      />
      <WorkbenchSessionRenameDialog
        open={renameTarget !== null}
        title={renameTarget?.title ?? null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onConfirm={async (title) => {
          if (renameTarget) await onRenameSession(renameTarget, title);
          setRenameTarget(null);
        }}
      />
    </>
  );
}
