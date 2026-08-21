import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from '../../components/ui/icons';
import { ShareCard } from './ShareCard';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../stores/toast';
import { useAppStore } from '../../stores/app';
import { useLibraryStore } from '../../runtime/library-access';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';

export function ImportConfirmDialog() {
  const payload = useAppStore((s) => s.pendingShareImport);
  const clearShareImport = useAppStore((s) => s.clearShareImport);
  const requestHighlightPrompt = useAppStore((s) => s.requestHighlightPrompt);
  const loadAll = useLibraryStore((s) => s.loadAll);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = api.share.onIncoming((incoming) => {
      useAppStore.getState().requestShareImport(incoming);
    });
    void api.share
      .consumePending()
      .then((res) => {
        for (const incoming of res.payloads) {
          useAppStore.getState().requestShareImport(incoming);
        }
      })
      .catch(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!payload) {
      setBusy(false);
      setError(null);
    }
  }, [payload]);

  const confirm = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.share.import({ payload });
      await loadAll();
      requestHighlightPrompt(res.prompt.id);
      toast.success('已导入分享', res.prompt.title);
      clearShareImport();
    } catch (err) {
      const message = (err as Error)?.message ?? '导入失败';
      setError(message);
      toast.error('导入失败', message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    clearShareImport();
    setError(null);
    setBusy(false);
  };

  return (
    <Dialog open={Boolean(payload)} onOpenChange={(open) => (!open ? cancel() : undefined)}>
      <DialogContent className="max-w-[880px]" data-testid="share-import-dialog">
        <DialogHeader>
          <DialogTitle>导入分享内容</DialogTitle>
          <DialogDescription>
            这是外部输入，已先做白名单清洗。确认后才会写入提示词库。
          </DialogDescription>
        </DialogHeader>

        {payload && (
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <ShareCard payload={payload} compact className="h-full" />

            <div className="space-y-3">
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-[11px] leading-relaxed text-secondary">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-primary">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  导入前请确认来源可信
                </div>
                这条内容不会自动执行，也不会携带本地路径或密钥。确认后才会落库。
              </div>

              <div className="rounded-lg border border-border-subtle bg-inset/40 px-3.5 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-quaternary">
                  白名单内容
                </div>
                <dl className="mt-2 space-y-1.5 text-[11px]">
                  <Meta label="标题" value={payload.title} />
                  <Meta label="正文" value={payload.content} mono />
                  {payload.contentNegative && <Meta label="负面" value={payload.contentNegative} mono />}
                  {payload.target && <Meta label="Target" value={payload.target} mono />}
                </dl>
              </div>

              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[11px] text-secondary">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            取消
          </Button>
          <Button onClick={confirm} disabled={!payload || busy} data-testid="share-import-confirm">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="shrink-0 text-quaternary">{label}</dt>
      <dd className={`max-w-[68%] truncate text-right text-secondary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
