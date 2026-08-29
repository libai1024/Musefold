'use client';

import type { WorkbenchSession } from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@musefold/ui/components/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Input } from '@musefold/ui/components/input';
import { Kbd } from '@musefold/ui/components/kbd';
import { Skeleton } from '@musefold/ui/components/skeleton';
import {
  Archive,
  BellDot,
  Check,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { Fragment, useEffect, useState } from 'react';
import { usePreferences, useUpdatePreferences } from '../settings/hooks';
import { isMacPlatform, shortcutDisplay } from '../shell/shortcuts';
import {
  sessionHasActiveJob,
  useCreateSession,
  useRemoveSession,
  useSessionList,
  useUpdateSession,
} from './hooks';
import { isSessionUnread, useActiveSession } from './session-store';

/**
 * 壳侧栏「对话」区(承 v2.1 ProductSidebar 的 sessionList 槽):
 * 新设计钮 + 会话列表。行动作常驻(hover 渐显):置顶/重命名/归档/删除。
 * 置顶为本机偏好(D6);行首状态点:running 动画点 / unread 实心点(§3.3)。
 */

export interface SessionPanelProps {
  /** 打开会话后的宿主动作(切到工作台视图/路由)。 */
  onOpen(): void;
}

export type SessionDateGroup = '置顶' | '今天' | '昨天' | '更早';

function sessionDateGroup(updatedAt: string, now: Date): Exclude<SessionDateGroup, '置顶'> {
  const timestamp = new Date(updatedAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sessionDay = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
  ).getTime();
  if (sessionDay >= today) return '今天';
  if (sessionDay >= today - 86_400_000) return '昨天';
  return '更早';
}

/**
 * 行尾相对时间(承 ZCode/Cursor 列表行语法,01 §2):粗粒度即可,hover 时让位给动作组。
 * 未来时间(时钟偏差)按「刚刚」处理。
 */
export function sessionRelativeTime(updatedAt: string, now = new Date()): string {
  const elapsedMs = now.getTime() - new Date(updatedAt).getTime();
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  const date = new Date(updatedAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 会话日期分组(ui-parity 02 §7 P1,承旧 groupWorkbenchSessions):
 * 置顶组恒在最前(v2.5 置顶是本机偏好,不在会话实体上),其余按本地日界分今天/昨天/更早;
 * 组内保持服务端 updatedAt 降序。空组不渲染。
 */
export function groupWorkbenchSessions(
  items: WorkbenchSession[],
  pinnedIds: ReadonlySet<string>,
  now = new Date(),
): Array<{ label: SessionDateGroup; items: WorkbenchSession[] }> {
  const grouped = new Map<SessionDateGroup, WorkbenchSession[]>();
  for (const item of items) {
    const label = pinnedIds.has(item.id) ? '置顶' : sessionDateGroup(item.updatedAt, now);
    grouped.set(label, [...(grouped.get(label) ?? []), item]);
  }
  return (['置顶', '今天', '昨天', '更早'] as const)
    .map((label) => ({ label, items: grouped.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
}

/** 「新设计」:建会话并进入工作台(承旧侧栏首要动作,含 ⌘N 快捷键,V25-UI-SPEC §8-I7)。 */
export function NewSessionAction({ onOpen }: SessionPanelProps) {
  const createSession = useCreateSession();
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);
  const pending = createSession.isPending;
  // 平台键位依赖 navigator,SSR 首帧不可知;挂载后再显示,避免 hydration 不一致。
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    setShortcut(shortcutDisplay('new-session', isMacPlatform()));
  }, []);

  async function handleCreate() {
    if (createSession.isPending) return;
    const created = await createSession.mutateAsync({});
    setActiveSessionId(created.id);
    onOpen();
  }

  // 浏览器可能保留 ⌘N(新窗口);Electron 渲染层可正常接管。
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleCreate 每渲染都新建,以 pending 为等效依赖
  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault();
        void handleCreate();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [pending]);

  // 行样式与导航轨同构(承 ZCode「新建任务 ⌘N」行语法),Kbd 右列。
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-sidebar-accent/60 hover:text-sidebar-foreground disabled:opacity-60"
      disabled={pending}
      title={shortcut ? `新设计(${shortcut})` : '新设计'}
      onClick={() => void handleCreate()}
      data-testid="session-create"
    >
      <SquarePen className="size-4 text-muted-foreground/80" aria-hidden /> 新设计
      {shortcut && <Kbd className="ml-auto bg-transparent">{shortcut}</Kbd>}
    </button>
  );
}

/** 行首状态点(§3.3):running 动画点 / unread 实心点 / idle 无。 */
function SessionStatusDot({ running, unread }: { running: boolean; unread: boolean }) {
  if (running) {
    return (
      <span
        className="mf-status-breathe size-1.5 shrink-0 rounded-full bg-primary"
        aria-label="正在生成"
        data-testid="session-status-running"
      />
    );
  }
  if (unread) {
    return (
      <span
        className="size-1.5 shrink-0 rounded-full bg-foreground"
        aria-label="有新结果"
        data-testid="session-status-unread"
      />
    );
  }
  return null;
}

function SessionRow({
  session,
  active,
  pinned,
  running,
  unread,
  onSelect,
  onRename,
  onTogglePin,
  onArchive,
  onMarkUnread,
  onRequestRemove,
}: {
  session: WorkbenchSession;
  active: boolean;
  pinned: boolean;
  running: boolean;
  unread: boolean;
  onSelect(): void;
  onRename(title: string): void;
  onTogglePin(): void;
  onArchive(): void;
  onMarkUnread(): void;
  onRequestRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  function commit() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== session.title) onRename(next);
    else setTitle(session.title);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-1">
        <Input
          value={title}
          autoFocus
          data-testid="session-rename-input"
          className="h-8 text-sm"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setTitle(session.title);
              setEditing(false);
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="确认重命名"
          data-testid="session-rename-commit"
          onClick={commit}
        >
          <Check className="size-4" />
        </Button>
      </div>
    );
  }

  function startRename() {
    setTitle(session.title);
    setEditing(true);
  }

  // 五项菜单单源(02 §7 P1):右键菜单与触屏「更多」菜单同构;
  // 无一项有全局键位,按 00 法则 6 不渲染 Kbd 右列(02-C2 挂起至真实接线)。
  const menuItems: Array<{
    id: string;
    label: string;
    icon: LucideIcon;
    onSelect(): void;
    variant?: 'destructive';
  }> = [
    {
      id: 'pin',
      label: pinned ? '取消置顶' : '置顶对话',
      icon: pinned ? PinOff : Pin,
      onSelect: onTogglePin,
    },
    { id: 'rename', label: '重命名', icon: Pencil, onSelect: startRename },
    { id: 'archive', label: '归档对话', icon: Archive, onSelect: onArchive },
    { id: 'unread', label: '标记为未读', icon: BellDot, onSelect: onMarkUnread },
    {
      id: 'remove',
      label: '删除对话',
      icon: Trash2,
      onSelect: onRequestRemove,
      variant: 'destructive',
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-1 rounded-md pr-1 transition-colors',
            active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
          )}
        >
          <button
            type="button"
            onClick={onSelect}
            data-testid={`session-${session.id}`}
            className={cn(
              'flex h-8 min-w-0 flex-1 items-center gap-1.5 truncate px-2.5 text-left text-[13px]',
              active ? 'font-medium text-sidebar-foreground' : 'text-muted-foreground',
            )}
          >
            <SessionStatusDot running={running} unread={unread} />
            {pinned && <Pin className="size-3 shrink-0 text-primary" aria-label="已置顶" />}
            <span className="min-w-0 truncate">{session.title}</span>
          </button>
          {/* 静息态行尾显示相对时间(承 ZCode/Cursor);hover/focus 让位给动作组。 */}
          <span
            className="shrink-0 pr-1.5 text-[11px] text-muted-foreground/60 tabular-nums group-focus-within:hidden group-hover:hidden pointer-coarse:hidden"
            data-testid="session-updated-at"
          >
            {sessionRelativeTime(session.updatedAt)}
          </span>
          {/* 触屏(pointer-coarse)常显;鼠标 hover/键盘 focus 显示(§8-I2)。 */}
          <div className="hidden shrink-0 items-center pointer-coarse:flex group-focus-within:flex group-hover:flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label={pinned ? '取消置顶' : '置顶对话'}
              data-testid="session-pin"
              onClick={onTogglePin}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label="重命名对话"
              data-testid="session-rename"
              onClick={startRename}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label="归档对话"
              data-testid="session-archive"
              onClick={onArchive}
            >
              <Archive className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              aria-label="删除对话"
              data-testid="session-remove"
              onClick={onRequestRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  aria-label="更多操作"
                  data-testid="session-more"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" data-testid="session-more-menu">
                {menuItems.map((item, index) => (
                  <Fragment key={item.id}>
                    {index === menuItems.length - 1 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant={item.variant}
                      onSelect={item.onSelect}
                      data-testid={`session-menu-${item.id}`}
                    >
                      <item.icon /> {item.label}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="session-context-menu">
        {menuItems.map((item, index) => (
          <Fragment key={item.id}>
            {index === menuItems.length - 1 && <ContextMenuSeparator />}
            <ContextMenuItem
              variant={item.variant}
              onSelect={item.onSelect}
              data-testid={`session-context-${item.id}`}
            >
              <item.icon /> {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SessionListPanel({ onOpen }: SessionPanelProps) {
  const sessions = useSessionList({ limit: 50 });
  const updateSession = useUpdateSession();
  const removeSession = useRemoveSession();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const activeSessionId = useActiveSession((s) => s.activeSessionId);
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);
  const seenAt = useActiveSession((s) => s.seenAt);
  const markSeen = useActiveSession((s) => s.markSeen);
  const unreadMarks = useActiveSession((s) => s.unreadMarks);
  const markUnread = useActiveSession((s) => s.markUnread);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSession | null>(null);

  // 活动会话始终已读:正开着它时结果到达也随看随清。
  const activeLatestFinishedAt = sessions.data?.items.find(
    (session) => session.id === activeSessionId,
  )?.latestJobFinishedAt;
  useEffect(() => {
    if (activeSessionId && activeLatestFinishedAt) markSeen(activeSessionId);
  }, [activeSessionId, activeLatestFinishedAt, markSeen]);

  const pinnedIds = preferences.data?.pinnedSessionIds ?? [];
  const pinnedSet = new Set(pinnedIds);
  // 日期分组(02 §7 P1):置顶组恒前,其余按日界分组;组内保持服务端 updatedAt 序。
  const rawItems = sessions.data?.items ?? [];
  const groups = groupWorkbenchSessions(rawItems, pinnedSet);

  function togglePin(id: string) {
    updatePreferences.mutate({
      pinnedSessionIds: pinnedSet.has(id)
        ? pinnedIds.filter((pinned) => pinned !== id)
        : [...pinnedIds, id],
    });
  }

  function leaveSession(id: string) {
    if (activeSessionId === id) setActiveSessionId(null);
    // 会话离场(归档/删除)时顺带清置顶,避免偏好里积累孤儿 id。
    if (pinnedSet.has(id)) {
      updatePreferences.mutate({
        pinnedSessionIds: pinnedIds.filter((pinned) => pinned !== id),
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1" data-testid="session-panel">
      <p className="px-2.5 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        对话
      </p>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="对话列表">
        {sessions.isPending &&
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-8 shrink-0 rounded-md" />)}
        {sessions.isError && (
          <div className="flex flex-col items-start gap-2 px-2.5 py-3">
            <p className="text-muted-foreground text-xs">对话读取失败</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void sessions.refetch()}
              data-testid="session-list-retry"
            >
              重试
            </Button>
          </div>
        )}
        {sessions.isSuccess &&
          groups.map((group) => (
            /* 组标题 sticky 压住组内行(02-C1);组间 12px,不加分隔线(色阶已够)。 */
            <section key={group.label} aria-label={group.label} className="mb-3 last:mb-0">
              <p
                className="sticky top-0 z-1 bg-sidebar px-2.5 py-1 font-medium text-[11px] text-muted-foreground"
                data-testid="session-group-label"
              >
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    pinned={pinnedSet.has(session.id)}
                    running={sessionHasActiveJob(session)}
                    unread={isSessionUnread(session, activeSessionId, seenAt, unreadMarks)}
                    onTogglePin={() => togglePin(session.id)}
                    onSelect={() => {
                      setActiveSessionId(session.id);
                      onOpen();
                    }}
                    onRename={(next) =>
                      updateSession.mutate({
                        id: session.id,
                        patch: { expectedVersion: session.version, title: next },
                      })
                    }
                    onArchive={() => {
                      leaveSession(session.id);
                      updateSession.mutate({
                        id: session.id,
                        patch: { expectedVersion: session.version, archived: true },
                      });
                    }}
                    onMarkUnread={() => markUnread(session.id)}
                    onRequestRemove={() => setDeleteTarget(session)}
                  />
                ))}
              </div>
            </section>
          ))}
        {sessions.isSuccess && rawItems.length === 0 && (
          <p className="px-2.5 py-4 text-muted-foreground text-xs">
            还没有对话。点「新设计」开始，发送后会立即出现在这里。
          </p>
        )}
      </nav>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.title}」将从对话列表移除。已经生成的图片仍保留在生成历史中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="session-remove-confirm"
              onClick={() => {
                if (deleteTarget) {
                  leaveSession(deleteTarget.id);
                  removeSession.mutate(deleteTarget.id);
                }
                setDeleteTarget(null);
              }}
            >
              删除对话
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
