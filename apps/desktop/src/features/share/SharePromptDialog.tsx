import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ImageDown, Loader2, Save } from '../../components/ui/icons';
import type { Prompt } from '@musefold/desktop-contracts/models';
import type { ShareRenderCardResult } from '@musefold/desktop-contracts/ipc';
import api from '../../lib/ipc';
import { toImageSrc } from '../../lib/media';
import { toast } from '../../stores/toast';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { ShareCard } from './ShareCard';
import { promptTargetFromParams } from '../generation/promptParams';

interface Props {
  open: boolean;
  prompt: Prompt | null;
  onOpenChange: (open: boolean) => void;
}

export function SharePromptDialog({ open, prompt, onOpenChange }: Props) {
  const [result, setResult] = useState<ShareRenderCardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const previewSrc = useMemo(() => (result ? toImageSrc(result.pngPath) : ''), [result]);

  useEffect(() => {
    if (!open || !prompt) {
      setResult(null);
      setError(null);
      setBusy(false);
      setCopyState('idle');
      return;
    }

    let alive = true;
    setBusy(true);
    setError(null);
    api.share
      .renderCard({ promptId: prompt.id })
      .then((res) => {
        if (!alive) return;
        setResult(res);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError((err as Error)?.message ?? '生成分享卡片失败');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });

    return () => {
      alive = false;
    };
  }, [open, prompt?.id]);

  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.deeplink);
      setCopyState('done');
      toast.success('已复制 deeplink');
      window.setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  const copyImage = async () => {
    if (!result) return;
    try {
      await api.system.copyImage(result.pngPath);
      toast.success('已复制 PNG');
    } catch (err) {
      toast.error('复制失败', (err as Error)?.message ?? '图片复制失败');
    }
  };

  const saveImage = async () => {
    if (!result) return;
    try {
      const res = await api.system.saveImage(result.pngPath);
      if ('cancelled' in res) return;
      toast.success('已保存 PNG');
    } catch (err) {
      toast.error('保存失败', (err as Error)?.message ?? '图片保存失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[920px]" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>分享提示词</DialogTitle>
          <DialogDescription>生成本地 PNG 卡片与导入链接，收方可直接导入到提示词库。</DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="flex items-center gap-2 px-1 py-10 text-[12px] text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            生成分享卡片中…
          </div>
        )}

        {!busy && error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12px] text-secondary">
            {error}
          </div>
        )}

        {!busy && !error && result && prompt && (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-border-subtle bg-inset/40">
                <img
                  src={previewSrc}
                  alt=""
                  className="block w-full object-contain"
                  data-testid="share-png-preview"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={saveImage} data-testid="share-save-png">
                  <Save className="h-3 w-3" /> 保存 PNG
                </Button>
                <Button variant="outline" size="sm" onClick={copyImage} data-testid="share-copy-png">
                  <ImageDown className="h-3 w-3" /> 复制 PNG
                </Button>
                <Button variant="outline" size="sm" onClick={copyLink} data-testid="share-copy-link">
                  {copyState === 'done' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copyState === 'done' ? '已复制' : '复制链接'}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <ShareCard
                payload={{
                  title: prompt.title,
                  content: prompt.content,
                  contentNegative: prompt.contentNegative ?? undefined,
                  params: prompt.params ?? undefined,
                  target: promptTargetFromParams(prompt.params),
                }}
                compact
              />
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-quaternary">
                  deeplink
                </div>
                <Textarea
                  readOnly
                  value={result.deeplink}
                  mono
                  className="min-h-[9rem] resize-none text-[10.5px]"
                  data-testid="share-deeplink"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="share-close">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
