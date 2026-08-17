// src/features/library/components/TrashDialog.tsx
// 回收站（TASK-LIB-12）
// 详见 docs/product/10-library-deep-dive.md §4.3
//
// 软删除的条目在这里恢复或彻底删除。「清空回收站」是不可逆的，所以走双重确认。

import { useEffect, useState } from 'react';
import { RotateCcw, Trash2, Trash } from '../../../components/ui/icons';
import { useLibraryStore } from '../store';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { formatTime } from '../../../lib/format';

export function TrashDialog() {
  const open = useLibraryStore((s) => s.trashOpen);
  const setTrashOpen = useLibraryStore((s) => s.setTrashOpen);
  const deleted = useLibraryStore((s) => s.deleted);
  const loadDeleted = useLibraryStore((s) => s.loadDeleted);
  const restorePrompt = useLibraryStore((s) => s.restorePrompt);
  const purgePrompt = useLibraryStore((s) => s.purgePrompt);
  const purgeAll = useLibraryStore((s) => s.purgeAll);

  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [purgeAllStage, setPurgeAllStage] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmPurgeId(null);
      setPurgeAllStage(0);
      void loadDeleted();
    }
  }, [open, loadDeleted]);

  return (
    <Dialog open={open} onOpenChange={setTrashOpen}>
      <DialogContent className="max-w-lg" data-testid="trash-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Trash className="h-3.5 w-3.5" /> 回收站
            <span className="font-mono text-[11px] tabular-nums text-quaternary">
              {deleted.length}
            </span>
          </DialogTitle>
          <DialogDescription>
            删除的提示词会留在这里。彻底删除不可恢复。
          </DialogDescription>
        </DialogHeader>

        {deleted.length === 0 ? (
          <EmptyState
            icon={Trash}
            title="回收站是空的"
            hint="删除提示词后可以在这里找回。"
            data-testid="trash-empty"
          />
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {deleted.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2.5 py-2"
                data-testid="trash-item"
                data-prompt-id={p.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-primary">{p.title}</p>
                  <p className="truncate font-mono text-[10px] text-quaternary">{p.content}</p>
                  {p.deletedAt && (
                    <p className="mt-0.5 text-[10px] text-quaternary">
                      删除于 {formatTime(p.deletedAt)}
                    </p>
                  )}
                </div>

                {confirmPurgeId === p.id ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setConfirmPurgeId(null)}>
                      取消
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      data-testid="trash-purge-confirm"
                      onClick={() => {
                        setConfirmPurgeId(null);
                        void purgePrompt(p.id);
                      }}
                    >
                      彻底删除
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void restorePrompt(p.id)}
                      data-testid="trash-restore"
                      title="恢复"
                    >
                      <RotateCcw className="h-3 w-3" /> 恢复
                    </Button>
                    <Button
                      size="iconXs"
                      variant="ghost"
                      className="text-danger hover:text-danger"
                      onClick={() => setConfirmPurgeId(p.id)}
                      data-testid="trash-purge"
                      title="彻底删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {deleted.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
            {purgeAllStage === 0 && (
              <>
                <span className="text-[10px] text-quaternary">
                  共 {deleted.length} 条可恢复
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => setPurgeAllStage(1)}
                  data-testid="trash-purge-all"
                >
                  清空回收站
                </Button>
              </>
            )}
            {purgeAllStage === 1 && (
              <>
                <span className="text-[11px] text-warning">
                  将永久删除 {deleted.length} 条，无法恢复。
                </span>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setPurgeAllStage(0)}>
                    取消
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => setPurgeAllStage(2)}
                    data-testid="trash-purge-all-step2"
                  >
                    我确定
                  </Button>
                </div>
              </>
            )}
            {purgeAllStage === 2 && (
              <>
                <span className="text-[11px] text-danger">最后确认：真的清空？</span>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setPurgeAllStage(0)}>
                    算了
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    disabled={busy}
                    data-testid="trash-purge-all-confirm"
                    onClick={async () => {
                      setBusy(true);
                      await purgeAll();
                      setBusy(false);
                      setPurgeAllStage(0);
                    }}
                  >
                    {busy ? '清空中…' : '永久清空'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
