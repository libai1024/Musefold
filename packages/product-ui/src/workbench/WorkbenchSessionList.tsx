import { Archive, LoaderCircle, MoreHorizontal, Pin, PinOff, RefreshCw } from '@musefold/ui/icons';
import { Button, IconButton, Input } from '@musefold/ui';
import {
  useMemo,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { WorkbenchSessionListItemViewModel } from '../models';

type WorkbenchSessionDateGroup = '置顶' | '今天' | '昨天' | '更早';

function sessionDateGroup(
  updatedAt: string,
  now: Date,
): Exclude<WorkbenchSessionDateGroup, '置顶'> {
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

export function groupWorkbenchSessions(
  items: WorkbenchSessionListItemViewModel[],
  now = new Date(),
): Array<{
  label: WorkbenchSessionDateGroup;
  items: WorkbenchSessionListItemViewModel[];
}> {
  const ordered = [...items].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  const grouped = new Map<WorkbenchSessionDateGroup, typeof ordered>();
  for (const item of ordered) {
    const label = item.pinned ? '置顶' : sessionDateGroup(item.updatedAt, now);
    grouped.set(label, [...(grouped.get(label) ?? []), item]);
  }
  return (['置顶', '今天', '昨天', '更早'] as const)
    .map((label) => ({ label, items: grouped.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
}

export interface WorkbenchSessionListProps {
  items: WorkbenchSessionListItemViewModel[];
  loading?: boolean;
  error?: string | null;
  errorTitle?: string;
  errorActions?: ReactNode;
  emptyLabel?: string;
  editingId?: string | null;
  editingValue?: string;
  onOpen: (item: WorkbenchSessionListItemViewModel) => void;
  onTogglePinned?: (item: WorkbenchSessionListItemViewModel) => void;
  onArchive?: (item: WorkbenchSessionListItemViewModel) => void;
  onContextMenu?: (
    item: WorkbenchSessionListItemViewModel,
    anchor: { x: number; y: number },
    returnFocusTarget: HTMLElement,
  ) => void;
  onEditingValueChange?: (value: string) => void;
  onSubmitRename?: (item: WorkbenchSessionListItemViewModel) => void;
  onCancelRename?: () => void;
  onRetry?: () => void;
}

export function WorkbenchSessionList({
  items,
  loading = false,
  error = null,
  errorTitle = '对话读取失败',
  errorActions,
  emptyLabel = '还没有对话。发送第一条设计请求后会出现在这里。',
  editingId = null,
  editingValue = '',
  onOpen,
  onTogglePinned,
  onArchive,
  onContextMenu,
  onEditingValueChange,
  onSubmitRename,
  onCancelRename,
  onRetry,
}: WorkbenchSessionListProps) {
  const groups = useMemo(() => groupWorkbenchSessions(items), [items]);
  const errorContent = error ? (
    <div className="mf-workbench-session-error" role="alert" data-testid="workbench-session-error">
      <strong>{errorTitle}</strong>
      <span>{error}</span>
      {errorActions}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} icon={<RefreshCw aria-hidden="true" />}>
          重试
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="mf-workbench-session-list" data-testid="workbench-session-list">
      <header>最近对话</header>
      {loading && items.length === 0 ? (
        <div className="mf-workbench-session-message" role="status">
          <LoaderCircle className="mf-spin" aria-hidden="true" />
          <span>正在读取对话</span>
        </div>
      ) : error && items.length === 0 ? (
        errorContent
      ) : items.length === 0 ? (
        <p className="mf-workbench-session-empty">{emptyLabel}</p>
      ) : (
        <>
          {errorContent}
          <div className="mf-workbench-session-groups">
            {groups.map((group) => (
              <section key={group.label} aria-label={`${group.label}的对话`}>
                <h3>{group.label}</h3>
                {group.items.map((item) => {
                  const status = item.status ?? 'idle';
                  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
                    if (!onContextMenu) return;
                    event.preventDefault();
                    onContextMenu(
                      item,
                      {
                        x: event.clientX + 2,
                        y: event.clientY + 2,
                      },
                      event.currentTarget.querySelector<HTMLElement>(
                        '.mf-workbench-session-open',
                      ) ?? event.currentTarget,
                    );
                  };
                  const openContextMenuFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
                    if (
                      !onContextMenu ||
                      (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                    ) {
                      return;
                    }
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onContextMenu(
                      item,
                      {
                        x: rect.left + 24,
                        y: rect.top + rect.height,
                      },
                      event.currentTarget.querySelector<HTMLElement>(
                        '.mf-workbench-session-open',
                      ) ?? event.currentTarget,
                    );
                  };
                  const submitRename = (event: FormEvent) => {
                    event.preventDefault();
                    onSubmitRename?.(item);
                  };
                  return (
                    <div
                      className="mf-workbench-session-row"
                      data-selected={item.selected ? 'true' : 'false'}
                      data-status={status}
                      data-session-id={item.id}
                      data-conversation-row={item.id}
                      data-conversation-kind={item.kind ?? 'chat'}
                      data-action-count={
                        Number(Boolean(onTogglePinned)) + Number(Boolean(onArchive))
                      }
                      onContextMenu={openContextMenu}
                      onKeyDown={openContextMenuFromKeyboard}
                      key={item.id}
                    >
                      {editingId === item.id ? (
                        <form className="mf-workbench-session-rename" onSubmit={submitRename}>
                          <Input
                            autoFocus
                            value={editingValue}
                            onChange={(event) => onEditingValueChange?.(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') onCancelRename?.();
                            }}
                            maxLength={80}
                            aria-label="对话标题"
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            type="submit"
                            className="mf-workbench-session-rename-submit"
                          >
                            保存
                          </Button>
                        </form>
                      ) : (
                        <>
                          <Button
                            unstyled
                            className="mf-workbench-session-open"
                            type="button"
                            onClick={() => onOpen(item)}
                            aria-current={item.selected ? 'page' : undefined}
                            aria-label={`${item.title}${status === 'running' ? '，正在生成' : status === 'unread' ? '，未读' : ''}`}
                          >
                            <span
                              className="mf-workbench-session-status"
                              aria-hidden="true"
                              data-status={status}
                              data-testid={
                                status === 'idle' ? undefined : 'conversation-status-dot'
                              }
                            />
                            <span>{item.title}</span>
                          </Button>
                          <div className="mf-workbench-session-actions">
                            {onTogglePinned ? (
                              <IconButton
                                onClick={() => onTogglePinned(item)}
                                label={`${item.pinned ? '取消置顶聊天' : '置顶聊天'}：${item.title}`}
                                aria-pressed={item.pinned}
                                title={item.pinned ? '取消置顶' : '置顶'}
                                className="mf-workbench-session-quick-action"
                                data-testid="conversation-hover-pin"
                              >
                                {item.pinned ? (
                                  <PinOff aria-hidden="true" />
                                ) : (
                                  <Pin aria-hidden="true" />
                                )}
                              </IconButton>
                            ) : null}
                            {onArchive ? (
                              <IconButton
                                onClick={() => onArchive(item)}
                                title="归档"
                                label={`归档聊天：${item.title}`}
                                className="mf-workbench-session-quick-action"
                                data-testid="conversation-hover-archive"
                              >
                                <Archive aria-hidden="true" />
                              </IconButton>
                            ) : null}
                            {onContextMenu ? (
                              /* Touch-визуальная замена правого клика: кнопка
                                 показывается только на устройствах без hover
                                 (см. .mf-workbench-session-more в styles.css). */
                              <IconButton
                                onClick={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  onContextMenu(
                                    item,
                                    {
                                      x: rect.left,
                                      y: rect.bottom + 4,
                                    },
                                    event.currentTarget,
                                  );
                                }}
                                title="更多操作"
                                label={`对话操作：${item.title}`}
                                aria-haspopup="menu"
                                className="mf-workbench-session-more"
                                data-workbench-session-menu-trigger
                                data-testid="conversation-more"
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </IconButton>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
