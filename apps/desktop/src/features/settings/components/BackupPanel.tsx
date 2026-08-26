import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, RefreshCw, RotateCcw, ShieldCheck } from '../../../components/ui/icons';
import type { BackupInfo, RestoreBackupResult } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface BackupPanelProps {
  refreshKey?: number;
}

export function BackupPanel({ refreshKey = 0 }: BackupPanelProps) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<BackupInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState<RestoreBackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.system.listBackups();
      setBackups(Array.isArray(rows) ? rows : []);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message ?? '读取备份失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const createNow = async () => {
    setCreating(true);
    setError(null);
    try {
      await api.system.backupNow();
      await load();
      toast.success('备份已创建', '当前数据库已保存为一致性快照');
    } catch (err) {
      setError((err as Error)?.message ?? '创建备份失败');
    } finally {
      setCreating(false);
    }
  };

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      const result = await api.system.restoreBackup({ file: selected.file });
      setRestored(result);
    } catch (err) {
      setError((err as Error)?.message ?? '恢复备份失败');
    } finally {
      setRestoring(false);
    }
  };

  const closeDialog = (open: boolean) => {
    if (!open && !restoring && !restored) {
      setSelected(null);
      setError(null);
    }
  };

  return (
    <div className="border-b border-border-subtle" data-testid="backups-panel">
      <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-primary">数据库备份</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
            保留最近的手动、导入前和升级前快照
          </p>
        </div>
        <Button
          size="iconSm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading || creating}
          title="刷新备份列表"
          aria-label="刷新备份列表"
          data-testid="backup-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void createNow()}
          disabled={creating || restoring}
          data-testid="backup-now"
        >
          {creating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ShieldCheck className="h-3 w-3" />
          )}
          {creating ? '备份中…' : '立即备份'}
        </Button>
      </div>

      {error && !selected && (
        <p
          className="mb-3 rounded-md border border-danger/20 bg-danger/5 px-2.5 py-2 text-[11px] text-danger"
          data-testid="backup-error"
        >
          {error}
        </p>
      )}

      <div
        className="mb-4 overflow-hidden rounded-md border border-border-subtle"
        data-testid="backup-list"
      >
        {loading && backups.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-[11px] text-tertiary">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 加载中…
          </div>
        ) : backups.length === 0 ? (
          <div
            className="flex h-16 items-center justify-center text-[11px] text-tertiary"
            data-testid="backup-empty"
          >
            暂无数据库备份
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {backups.map((backup) => (
              <div
                key={backup.file}
                className="flex min-h-14 items-center gap-3 border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
                data-testid="backup-row"
                data-backup-file={backup.file}
              >
                <span
                  className={`min-w-10 shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-center text-meta font-medium ${
                    backup.kind === 'manual' ? 'bg-pressed text-primary' : 'bg-inset text-tertiary'
                  }`}
                >
                  {backup.kind === 'manual' ? '手动' : '自动'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-meta text-secondary" title={backup.file}>
                    {backup.file}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-meta text-quaternary">
                    <Clock3 className="h-2.5 w-2.5" /> {formatDate(backup.createdAt)} ·{' '}
                    {formatBytes(backup.size)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelected(backup);
                    setRestored(null);
                    setError(null);
                  }}
                  data-testid="backup-restore"
                >
                  <RotateCcw className="h-3 w-3" /> 恢复
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={selected !== null} onOpenChange={closeDialog}>
        <DialogContent
          className="max-w-[440px]"
          hideClose={Boolean(restored)}
          data-testid="backup-confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle>{restored ? '数据库已恢复' : '恢复数据库备份'}</DialogTitle>
            <DialogDescription>
              {restored
                ? '需要立即重启 Musefold，才能使用恢复后的数据。'
                : '恢复会覆盖当前数据库。当前状态会先自动保存为安全备份。'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {selected && (
              <div className="rounded-md border border-border-subtle bg-inset/50 px-3.5 py-3">
                <p className="truncate font-mono text-[11px] text-primary">{selected.file}</p>
                <p className="mt-1 text-meta text-tertiary">
                  {formatDate(selected.createdAt)} · {formatBytes(selected.size)}
                </p>
              </div>
            )}

            {!restored && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-secondary">
                API 密钥和生成图片不会改变；未备份的数据库修改将被替换。
              </div>
            )}

            {restored && (
              <div
                className="flex items-start gap-2.5 rounded-md border border-success/30 bg-success/10 px-3.5 py-2.5 text-[11px] text-secondary"
                data-testid="backup-restored"
              >
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                恢复完成，原数据库也已自动保留。应用重启前请勿继续编辑数据。
              </div>
            )}

            {error && selected && (
              <p
                className="rounded-md border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[11px] text-danger"
                data-testid="backup-restore-error"
              >
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            {!restored && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => closeDialog(false)}
                  disabled={restoring}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void restore()}
                  disabled={restoring}
                  data-testid="backup-confirm"
                >
                  {restoring && <Loader2 className="h-3 w-3 animate-spin" />}
                  {restoring ? '恢复中…' : '恢复数据库'}
                </Button>
              </>
            )}
            {restored && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void api.system.relaunch()}
                data-testid="backup-restart"
              >
                <RefreshCw className="h-3 w-3" /> 立即重启
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
