import { useMemo, useState } from 'react';
import type {
  WorkbenchConversationKind,
  WorkbenchSessionSummary,
} from '@musefold/desktop-contracts/workbench';
import {
  Archive,
  LibraryBig,
  Loader2,
  MessageSquareText,
  Power,
  RefreshCw,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import {
  useDesktopWorkbenchSessionList,
  useGenerationWorkbenchStore,
  WORKBENCH_SESSION_RESTART_REQUIRED,
} from '@renderer/runtime/workbench-access';
import { SectionShell, SettingsCard } from '../components/SectionShell';

const TYPE_META: Record<WorkbenchConversationKind, { label: string; icon: LucideIcon }> = {
  chat: { label: '普通聊天', icon: MessageSquareText },
  prompt: { label: '引用提示词', icon: LibraryBig },
};

function formatUpdatedAt(timestamp: number): string {
  // 含年份:归档项常跨年,MM/dd 无法分辨(设置评审 P2-7)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function ArchivedChatsSection() {
  const {
    sessions: archivedSessions,
    loading,
    error: queryError,
    refetch,
  } = useDesktopWorkbenchSessionList(true);
  // 列表错误态只认查询错误:全局 store 的 mutation 错误会串台且在成功 refetch 后
  // 仍抢占空态分支;恢复/删除失败已就地 toast(设置评审 A-1)
  const error = queryError;
  const openSession = useGenerationWorkbenchStore((state) => state.openSession);
  const archiveSession = useGenerationWorkbenchStore((state) => state.archiveSession);
  const deleteSession = useGenerationWorkbenchStore((state) => state.deleteSession);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const sessions = useMemo(
    () => [...archivedSessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [archivedSessions],
  );
  const restartRequired = error === WORKBENCH_SESSION_RESTART_REQUIRED;

  const restore = async (session: WorkbenchSessionSummary) => {
    setRestoringId(session.id);
    try {
      await archiveSession(session.id, false);
      toast.success('聊天已恢复', session.title);
    } catch (restoreError) {
      toast.error('恢复失败', restoreError instanceof Error ? restoreError.message : '请稍后重试');
    } finally {
      setRestoringId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget.id);
      toast.success('聊天已删除', deleteTarget.title);
      setDeleteTarget(null);
    } catch (deleteError) {
      toast.error('删除失败', deleteError instanceof Error ? deleteError.message : '请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionShell
      title="已归档聊天"
      description="管理暂时收起的聊天。"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={loading}
          data-testid="settings-archived-refresh"
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          刷新
        </Button>
      }
    >
      <SettingsCard title="归档记录" description="恢复暂时收起的聊天，或删除不再需要的记录">
        {loading && sessions.length === 0 ? (
          <div
            className="flex min-h-32 items-center justify-center gap-2 px-6 text-[12px] text-tertiary"
            data-testid="settings-archived-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取归档聊天…
          </div>
        ) : error && sessions.length === 0 ? (
          <div className="px-6 py-5" role="alert" data-testid="settings-archived-error">
            <p className="text-[13px] font-medium text-primary">
              {restartRequired ? '需要重启应用' : '归档聊天读取失败'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-secondary">{error}</p>
            <div className="mt-3 flex gap-2">
              {restartRequired && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void api.system.relaunch()}
                  data-testid="settings-archived-relaunch"
                >
                  <Power className="h-3.5 w-3.5" />
                  立即重启
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div
            className="flex min-h-40 flex-col items-center justify-center px-4 text-center"
            data-testid="settings-archived-empty"
          >
            <Archive className="h-5 w-5 text-quaternary" />
            <p className="mt-3 text-[13px] font-medium text-primary">还没有已归档聊天</p>
          </div>
        ) : (
          <div data-testid="settings-archived-list">
            {sessions.map((session) => {
              const kind = session.conversationKind ?? 'chat';
              const meta = TYPE_META[kind];
              const TypeIcon = meta.icon;
              const restoring = restoringId === session.id;
              return (
                <div
                  key={session.id}
                  className="setting-item group"
                  data-testid={`settings-archived-row-${session.id}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    onClick={() => void openSession(session.id)}
                    data-testid={`settings-archived-open-${session.id}`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-inset text-secondary"
                      title={meta.label}
                      aria-label={meta.label}
                    >
                      <TypeIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-primary">
                        {session.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-tertiary">
                        {meta.label} · {session.turnCount} 轮 · {formatUpdatedAt(session.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={restoring || deleting}
                      onClick={() => void restore(session)}
                      data-testid={`settings-archived-restore-${session.id}`}
                    >
                      {restoring ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      恢复
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-tertiary hover:text-danger"
                      disabled={restoring || deleting}
                      onClick={() => setDeleteTarget(session)}
                      title="删除聊天"
                      aria-label={`删除已归档聊天：${session.title}`}
                      data-testid={`settings-archived-delete-${session.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除已归档聊天？</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title}”将从聊天列表移除，已经生成的图片仍保留在生成历史中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              删除聊天
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}
