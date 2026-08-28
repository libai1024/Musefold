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
import { Input } from '@musefold/ui/components/input';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Archive, Check, Pencil, SquarePen, Trash2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import { useCreateSession, useRemoveSession, useSessionList, useUpdateSession } from './hooks';
import { useActiveSession } from './session-store';

/**
 * 壳侧栏「对话」区(承 v2.1 ProductSidebar 的 sessionList 槽):
 * 新设计钮 + 会话列表。行动作常驻(hover 渐显):重命名/归档/删除。
 * 置顶与未读/运行中状态点待契约补 latestStatus 与偏好通道(M4e)。
 */

export interface SessionPanelProps {
  /** 打开会话后的宿主动作(切到工作台视图/路由)。 */
  onOpen(): void;
}

/** 「新设计」:建会话并进入工作台(承旧侧栏首要动作,⌘N 由宿主绑定)。 */
export function NewSessionAction({ onOpen }: SessionPanelProps) {
  const createSession = useCreateSession();
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);

  async function handleCreate() {
    const created = await createSession.mutateAsync({});
    setActiveSessionId(created.id);
    onOpen();
  }

  return (
    <Button
      variant="outline"
      className="w-full justify-start gap-2 bg-transparent"
      disabled={createSession.isPending}
      onClick={() => void handleCreate()}
      data-testid="session-create"
    >
      <SquarePen className="size-4" /> 新设计
    </Button>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onArchive,
  onRequestRemove,
}: {
  session: WorkbenchSession;
  active: boolean;
  onSelect(): void;
  onRename(title: string): void;
  onArchive(): void;
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

  return (
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
          'min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-sm',
          active ? 'font-medium text-sidebar-foreground' : 'text-muted-foreground',
        )}
      >
        {session.title}
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="重命名对话"
          data-testid="session-rename"
          onClick={() => {
            setTitle(session.title);
            setEditing(true);
          }}
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
      </div>
    </div>
  );
}

export function SessionListPanel({ onOpen }: SessionPanelProps) {
  const sessions = useSessionList({ limit: 50 });
  const updateSession = useUpdateSession();
  const removeSession = useRemoveSession();
  const activeSessionId = useActiveSession((s) => s.activeSessionId);
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSession | null>(null);

  const items = sessions.data?.items ?? [];

  function leaveSession(id: string) {
    if (activeSessionId === id) setActiveSessionId(null);
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
          items.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
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
              onRequestRemove={() => setDeleteTarget(session)}
            />
          ))}
        {sessions.isSuccess && items.length === 0 && (
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
