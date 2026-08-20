import { useState } from 'react';
import { Download, Loader2, ShieldCheck, Trash2 } from '../../../components/ui/icons';
import type { ResetDataResult } from '@musefold/desktop-contracts/ipc';
import api from '../../../lib/ipc';
import { toast } from '../../../stores/toast';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

const CONFIRM_PHRASE = '清空数据';

interface DangerZonePanelProps {
  onExport: () => void;
  onReset: () => Promise<void>;
}

export function DangerZonePanel({ onExport, onReset }: DangerZonePanelProps) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ResetDataResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetDialog = () => {
    setPhrase('');
    setDone(null);
    setError(null);
  };

  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) resetDialog();
  };

  const run = async () => {
    if (phrase !== CONFIRM_PHRASE) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.system.resetData({ confirm: 'RESET' });
      await onReset();
      setDone(result);
      toast.success('数据已清空', 'Provider、API 密钥和图片文件保持不变');
    } catch (err) {
      setError((err as Error)?.message ?? '清空数据失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border-subtle" data-testid="danger-zone">
      <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-primary">危险区</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">清空提示词、组合内容和生成历史</p>
        </div>
        <Button size="sm" variant="danger" onClick={() => setOpen(true)} data-testid="reset-data-open">
          <Trash2 className="h-3 w-3" /> 清空全部数据
        </Button>
      </div>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-[460px]" hideClose={busy} data-testid="reset-data-dialog">
          <DialogHeader>
            <DialogTitle>{done ? '业务数据已清空' : '清空全部数据'}</DialogTitle>
            <DialogDescription>
              {done ? '可通过刚创建的数据库备份恢复。' : '此操作会删除所有业务内容与历史，执行前会自动创建数据库备份。'}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3.5 py-3" data-testid="reset-data-done">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-primary">清空完成</p>
                <p className="mt-1 truncate font-mono text-[10px] text-tertiary">{done.backupPath}</p>
                <p className="mt-1 text-[10.5px] text-tertiary">Provider、API 密钥与磁盘图片未改变。</p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-secondary">
                提示词、文件夹、标签、片段、模板、组合和生成历史将被永久清空。
              </div>
              <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                <span>
                  输入 <span className="font-mono font-semibold text-danger">{CONFIRM_PHRASE}</span> 以确认
                </span>
                <Input
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  data-testid="reset-data-phrase"
                />
              </label>
              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[11px] text-danger" data-testid="reset-data-error">
                  {error}
                </p>
              )}
            </>
          )}

          <DialogFooter>
            {done ? (
              <Button size="sm" onClick={() => changeOpen(false)}>完成</Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    changeOpen(false);
                    onExport();
                  }}
                  disabled={busy}
                  data-testid="reset-data-export"
                >
                  <Download className="h-3 w-3" /> 先导出
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run()}
                  disabled={busy || phrase !== CONFIRM_PHRASE}
                  data-testid="reset-data-confirm"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {busy ? '清空中…' : '永久清空'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
