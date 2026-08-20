// History 顶栏清理菜单（TASK-HIS-10）

import { useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, Trash2, XCircle } from '../../../components/ui/icons';
import type { HistoryClearRequest } from '@musefold/desktop-contracts/ipc';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { useHistoryStore } from '../store';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

type CleanupKind = 'older' | 'failed-cancelled' | 'all';

interface CleanupAction {
  kind: CleanupKind;
  title: string;
  description: string;
  confirmLabel: string;
  request: HistoryClearRequest;
}

export function HistoryCleanupMenu() {
  const clear = useHistoryStore((s) => s.clear);
  const [pending, setPending] = useState<CleanupAction | null>(null);
  const [busy, setBusy] = useState(false);

  const openOlder = () => {
    setPending({
      kind: 'older',
      title: '清除 30 天前的历史？',
      description: '只会删除创建时间早于 30 天前的生成历史，生成图片文件仍会保留在磁盘上。',
      confirmLabel: '清除旧记录',
      request: { before: Date.now() - THIRTY_DAYS },
    });
  };

  const openFailedCancelled = () => {
    setPending({
      kind: 'failed-cancelled',
      title: '清除失败与取消记录？',
      description: '会删除全部失败和已取消的生成历史，成功结果会保留。',
      confirmLabel: '清除失败与取消',
      request: { statuses: ['failed', 'cancelled'] },
    });
  };

  const openAll = () => {
    setPending({
      kind: 'all',
      title: '清空全部历史？',
      description: '会删除所有生成历史。默认只删除数据库内容，已经生成的图片文件仍会保留。',
      confirmLabel: '清空全部',
      request: {},
    });
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await clear(pending.request);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" data-testid="history-clean-trigger">
            <Trash2 className="h-3.5 w-3.5" />
            清理
            <ChevronDown className="h-3 w-3 text-tertiary" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>清理历史</DropdownMenuLabel>
          <DropdownMenuItem onSelect={openOlder} data-testid="history-clear-older">
            <CalendarClock className="h-3.5 w-3.5 text-tertiary" />
            清除 30 天前
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={openFailedCancelled}
            data-testid="history-clear-failed-cancelled"
          >
            <XCircle className="h-3.5 w-3.5 text-tertiary" />
            清失败与取消
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={openAll}
            className="text-danger focus:bg-danger/10 focus:text-danger"
            data-testid="history-clear-all"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空全部
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <DialogContent
          className="max-w-md"
          data-testid="history-clear-confirm-dialog"
          data-clear-kind={pending?.kind}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {pending?.title}
            </DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              variant={pending?.kind === 'all' ? 'danger' : 'outline'}
              disabled={busy}
              onClick={() => void confirm()}
              data-testid="history-clear-confirm"
            >
              {busy ? '清理中…' : pending?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
