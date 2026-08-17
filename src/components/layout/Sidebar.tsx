// src/components/layout/Sidebar.tsx
// Codex 指挥中心导航轨 —— 分区导航（计数 + 活动指示） + 底部 Provider 状态
// 详见 docs/06-ui-design-system.md §6.2

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Blocks, MessageSquareText, PanelLeft, Pencil, Pin, PinOff, SquarePen, LibraryBig, History, Power, RefreshCw, Trash2, type LucideIcon } from '../ui/icons';
import { useAppStore, type ViewKey } from '../../stores/app';
import { useLibraryStore } from '../../features/library/store';
import { useHistoryStore } from '../../features/history/store';
import { cn } from '../../lib/utils';
import { useGenerationWorkbenchStore } from '../../features/generation/workbench/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import api from '../../lib/ipc';
import { WORKBENCH_SESSION_RESTART_REQUIRED } from '../../features/generation/workbench/sessionErrors';
import { usePlatform, useWindowFullscreen } from '../../lib/usePlatform';
import { SidebarAccessSwitcher } from './SidebarAccessSwitcher';
import {
  readPinnedSessionIds,
  readUnreadSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  SESSION_UNREAD_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
} from '../../features/generation/workbench/sessionPreferences';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
  useCount: () => number;
  hidden?: boolean;
}

// 导航目的地（Codex 式）：制作工作台不设独立入口——「新设计」和对话列表就是入口。
// 图标遵循契约（icons.ts）：库=LibraryBig、方案=Blocks、历史=History、设置=Settings。
const NAV: NavItem[] = [
  { key: 'library', label: '提示词库', icon: LibraryBig, useCount: () => useLibraryStore((s) => s.prompts.length) },
  { key: 'design-schemes', label: '设计方案', icon: Blocks, useCount: () => 0 },
  { key: 'history', label: '生成历史', icon: History, useCount: () => useHistoryStore((s) => s.records.length) },
];

function NavButton({ item }: { item: NavItem }) {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const count = item.useCount();
  const active = currentView === item.key;
  const Icon = item.icon;

  return (
    <button
      onClick={() => setView(item.key)}
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${item.key}`}
      className={cn(
        'no-drag group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors duration-[var(--dur-fast)] ease-out',
        active
          ? 'bg-pressed font-medium text-primary'
          : 'text-secondary hover:bg-hover hover:text-primary'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.3 : 2} />
      <span className="flex-1 truncate text-left">{item.label}</span>
      {count > 0 && (
        <span className="rounded-full bg-inset px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-tertiary">
          {count}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-3.5 text-[10px] font-medium text-tertiary">
      {children}
    </p>
  );
}

export function Sidebar() {
  const { isMac } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const newConversation = useAppStore((s) => s.newConversation);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  return (
    <aside className="drag-region flex h-full w-full min-w-0 flex-col" aria-label="Musefold 导航">
      <div
        className={cn(
          'flex h-[52px] shrink-0 items-center gap-2 border-b border-border-subtle px-3',
          isMac && !isFullscreen && 'pl-[86px]',
        )}
      >
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          className="no-drag ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary"
          aria-label="收起侧栏"
          title="收起侧栏"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* 新设计：Codex 式撰写行 —— 开一条新对话（草稿态，首次发送才落库），⌘N 直达 */}
      <div className="no-drag px-2 pt-2">
        <button
          onClick={newConversation}
          data-testid="sidebar-new-design"
          title={`新设计（${isMac ? '⌘' : 'Ctrl'} N）`}
          className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium text-primary transition-colors duration-[var(--dur-fast)] ease-out hover:bg-hover"
        >
          <SquarePen className="h-4 w-4 shrink-0" strokeWidth={2.1} />
          <span className="flex-1 truncate text-left">新设计</span>
          <span
            className="shrink-0 font-mono text-[10px] tracking-wide text-quaternary opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            {isMac ? '⌘N' : 'Ctrl N'}
          </span>
        </button>
      </div>

      {/* 导航目的地：工作台不在其中——对话即入口 */}
      <nav className="flex flex-col px-2 pt-4" aria-label="工作区导航">
        {NAV.filter((item) => !item.hidden).map((item) => (
          <NavButton key={item.key} item={item} />
        ))}
      </nav>

      {/* 持久对话列表 */}
      <ConversationList />

      {/* 底部：一个入口切换账号 / 中转站；模型只在设置中配置。 */}
      <div className="no-drag border-t border-border-subtle px-2 py-2">
        <SidebarAccessSwitcher />
      </div>
    </aside>
  );
}

function sessionDateGroup(timestamp: number): '今天' | '昨天' | '更早' {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const date = new Date(timestamp);
  const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (sessionDay >= today) return '今天';
  if (sessionDay >= today - 86_400_000) return '昨天';
  return '更早';
}

// 对话状态光晕：生成中 = Ember 呼吸光晕；完成未读 = 静态绿光晕；已读 = 不显示。
// 空槽位保留宽度，保证所有标题左对齐。
function ConversationStatusGlow({ running, unread }: { running: boolean; unread: boolean }) {
  return (
    <span className="flex w-2 shrink-0 items-center justify-center" aria-hidden="true">
      {(running || unread) && (
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            running ? 'conversation-glow-running' : 'conversation-glow-unread',
          )}
          data-testid="conversation-status-dot"
          data-status={running ? 'running' : 'unread'}
        />
      )}
    </span>
  );
}

function ConversationContextMenu({
  anchor,
  title,
  pinned,
  onClose,
  onTogglePinned,
  onRename,
  onArchive,
  onMarkUnread,
  onDelete,
}: {
  anchor: { x: number; y: number };
  title: string;
  pinned: boolean;
  onClose: () => void;
  onTogglePinned: () => void;
  onRename: () => void;
  onArchive: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      setPosition({
        x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[currentIndex >= 0 ? (currentIndex + 1) % items.length : 0]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[currentIndex >= 0 ? (currentIndex - 1 + items.length) % items.length : items.length - 1]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      data-conversation-context-menu
      aria-label={`对话操作：${title}`}
      onKeyDown={handleMenuKeyDown}
      className="no-drag fixed z-[1000] max-h-[calc(100vh-16px)] w-[196px] overflow-y-auto rounded-xl border border-border-default/80 bg-popover/85 p-1.5 text-[11px] shadow-[0_18px_48px_rgba(28,30,34,0.18),0_4px_12px_rgba(28,30,34,0.08)] backdrop-blur-xl outline-none"
      style={{ left: position.x, top: position.y }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => { onTogglePinned(); onClose(); }}
        className="menu-action"
        data-testid="conversation-context-pin"
      >
        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        <span>{pinned ? '取消置顶聊天' : '置顶聊天'}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => { onRename(); onClose(); }}
        className="menu-action"
        data-testid="conversation-context-rename"
      >
        <Pencil className="h-3.5 w-3.5" />
        <span>重命名聊天</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => { onArchive(); onClose(); }}
        className="menu-action"
        data-testid="conversation-context-archive"
      >
        <Archive className="h-3.5 w-3.5" />
        <span>归档聊天</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => { onMarkUnread(); onClose(); }}
        className="menu-action"
        data-testid="conversation-context-unread"
      >
        <MessageSquareText className="h-3.5 w-3.5" />
        <span>标记为未读</span>
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      <button
        type="button"
        role="menuitem"
        onClick={() => { onDelete(); onClose(); }}
        className="menu-action text-danger hover:text-danger"
        data-testid="conversation-context-delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>删除聊天</span>
      </button>
    </div>,
    document.body,
  );
}

function ConversationList() {
  const currentView = useAppStore((s) => s.currentView);
  const sessions = useGenerationWorkbenchStore((s) => s.sessions);
  const activeSessionId = useGenerationWorkbenchStore((s) => s.activeSessionId);
  // 并行生成：逐会话点亮运行指示（稳定字符串选择器避免无谓重渲）。
  const runningSessionKey = useGenerationWorkbenchStore(
    (s) => Object.values(s.runningTurns).map((entry) => entry.sessionId).sort().join(','),
  );
  const loading = useGenerationWorkbenchStore((s) => s.sessionsLoading);
  const error = useGenerationWorkbenchStore((s) => s.sessionsError);
  const loadSessions = useGenerationWorkbenchStore((s) => s.loadSessions);
  const openSession = useGenerationWorkbenchStore((s) => s.openSession);
  const renameSession = useGenerationWorkbenchStore((s) => s.renameSession);
  const archiveSession = useGenerationWorkbenchStore((s) => s.archiveSession);
  const deleteSession = useGenerationWorkbenchStore((s) => s.deleteSession);
  const [contextMenu, setContextMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [pinnedSessionIds, setPinnedSessionIds] = useState(readPinnedSessionIds);
  const [unreadSessionIds, setUnreadSessionIds] = useState(readUnreadSessionIds);
  const conversations = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const restartRequired = error === WORKBENCH_SESSION_RESTART_REQUIRED;
  const groupedConversations = useMemo(() => {
    const pinned = conversations.filter((conversation) => pinnedSessionIds.includes(conversation.id));
    const groups = new Map<'今天' | '昨天' | '更早', typeof conversations>();
    for (const conversation of conversations.filter((item) => !pinnedSessionIds.includes(item.id))) {
      const label = sessionDateGroup(conversation.updatedAt);
      groups.set(label, [...(groups.get(label) ?? []), conversation]);
    }
    return [
      { label: '置顶' as const, items: pinned },
      ...(['今天', '昨天', '更早'] as const).map((label) => ({ label, items: groups.get(label) ?? [] })),
    ]
      .filter((group) => group.items.length > 0);
  }, [conversations, pinnedSessionIds]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const syncPins = () => setPinnedSessionIds(readPinnedSessionIds());
    window.addEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
    return () => window.removeEventListener(SESSION_PINS_CHANGED_EVENT, syncPins);
  }, []);

  useEffect(() => {
    const syncUnread = () => setUnreadSessionIds(readUnreadSessionIds());
    window.addEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
    return () => window.removeEventListener(SESSION_UNREAD_CHANGED_EVENT, syncUnread);
  }, []);

  // 回到制作工作台查看当前会话即视为已读；仅在视图/会话切换时清除，
  // 不清除用户在停留期间手动标记的未读。
  useEffect(() => {
    if (currentView !== 'generate' || !activeSessionId) return;
    if (readUnreadSessionIds().includes(activeSessionId)) {
      setUnreadSessionIds(setSessionUnread(activeSessionId, false));
    }
  }, [currentView, activeSessionId]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-conversation-context-menu]')) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  const submitRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) return;
    await renameSession(id, title);
    setRenameId(null);
    setRenameValue('');
  };

  return (
    <div className="no-drag mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden px-2">
      <div className="flex items-center justify-between">
        <SectionLabel>最近对话</SectionLabel>
      </div>
      {loading && conversations.length === 0 ? (
        <p className="px-2.5 py-1 text-[11px] text-quaternary">正在读取对话…</p>
      ) : error && conversations.length === 0 ? (
        <div className="mx-1 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2" role="alert" data-testid="workbench-session-error">
          <p className="text-[11px] font-medium text-primary">
            {restartRequired ? '需要重启应用' : '对话读取失败'}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-secondary">{error}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {restartRequired && (
              <Button
                size="xs"
                onClick={() => void api.system.relaunch()}
                data-testid="workbench-session-relaunch"
              >
                <Power className="h-3 w-3" /> 立即重启
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              onClick={() => void loadSessions()}
              data-testid="workbench-session-retry"
            >
              <RefreshCw className="h-3 w-3" /> 重试
            </Button>
          </div>
        </div>
      ) : conversations.length === 0 ? (
        <p className="px-2.5 py-1 text-[11px] leading-relaxed text-quaternary">
          还没有对话。点「新设计」开始，发送后会立即出现在这里。
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {groupedConversations.map((group) => (
            <section key={group.label} aria-label={`${group.label}的对话`} className="mb-1">
              <p className="px-2.5 pb-0.5 pt-1.5 text-[9.5px] font-medium text-quaternary">{group.label}</p>
              {group.items.map((c) => {
                const pinned = pinnedSessionIds.includes(c.id);
                const running = runningSessionKey.split(',').includes(c.id)
                  || c.latestStatus === 'queued'
                  || c.latestStatus === 'running';
                const unread = !running && unreadSessionIds.includes(c.id);
                const openConversationMenu = (event: MouseEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setContextMenu({ id: c.id, title: c.title, x: event.clientX + 2, y: event.clientY + 2 });
                };
                const openConversationMenuFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setContextMenu({ id: c.id, title: c.title, x: rect.left + 24, y: rect.top + rect.height });
                };
                return (
                <div
                  key={c.id}
                  className="group relative"
                  onContextMenu={openConversationMenu}
                  onKeyDown={openConversationMenuFromKeyboard}
                  data-conversation-row={c.id}
                  data-conversation-kind={c.conversationKind ?? 'chat'}
                >
                  {renameId === c.id ? (
                    <form
                      onSubmit={(event) => { event.preventDefault(); void submitRename(c.id); }}
                      className="flex items-center gap-1 px-1 py-0.5"
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Escape') setRenameId(null); }}
                        maxLength={80}
                        aria-label="对话标题"
                        className="min-w-0 flex-1 rounded-md border border-border-default bg-elevated px-2 py-1 text-[12px] text-primary outline-none focus:border-border-strong"
                      />
                      <button type="submit" className="h-6 rounded-md px-1.5 text-[10px] text-secondary hover:bg-hover hover:text-primary">保存</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setUnreadSessionIds(setSessionUnread(c.id, false));
                        void openSession(c.id);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 pr-14 text-left text-[13px] transition-colors',
                        activeSessionId === c.id
                          ? 'bg-pressed text-primary'
                          : 'text-secondary hover:bg-hover hover:text-primary',
                        unread && 'font-medium text-primary',
                      )}
                      aria-label={`${c.title}${running ? '，正在生成' : unread ? '，未读' : ''}`}
                    >
                      <ConversationStatusGlow running={running} unread={unread} />
                      <span className="flex-1 truncate">{c.title}</span>
                    </button>
                  )}
                  {renameId !== c.id && (
                    <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPinnedSessionIds(setSessionPinned(c.id, !pinned));
                        }}
                        aria-label={`${pinned ? '取消置顶聊天' : '置顶聊天'}：${c.title}`}
                        aria-pressed={pinned}
                        title={pinned ? '取消置顶' : '置顶'}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong',
                          pinned && 'text-primary',
                        )}
                        data-testid="conversation-hover-pin"
                      >
                        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setUnreadSessionIds(setSessionUnread(c.id, false));
                          void archiveSession(c.id, true);
                        }}
                        aria-label={`归档聊天：${c.title}`}
                        title="归档"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                        data-testid="conversation-hover-archive"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );})}
            </section>
          ))}
        </div>
      )}
      {contextMenu && (
        <ConversationContextMenu
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
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
          onDelete={() => setDeleteTarget({ id: contextMenu.id, title: contextMenu.title })}
        />
      )}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除对话？</DialogTitle>
            <DialogDescription>
              「{deleteTarget?.title}」将从对话列表移除。已经生成的图片仍保留在生成历史中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteTarget) void deleteSession(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              删除对话
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
