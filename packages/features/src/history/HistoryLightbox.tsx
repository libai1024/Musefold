'use client';

import type { GenerationAsset, GenerationJob } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@musefold/ui/components/dialog';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { toast } from '@musefold/ui/components/sonner';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  ImageIcon,
} from '@musefold/ui/icons';
import { useEffect } from 'react';

/** Lightbox 可翻集合的条目:成功且有资产的记录(顺序与列表可视顺序一致)。 */
export interface LightboxEntry {
  job: GenerationJob;
  asset: GenerationAsset;
}

export interface HistoryLightboxProps {
  /** 成功集合(已按列表顺序过滤);为空时组件不渲染。 */
  entries: readonly LightboxEntry[];
  /** 当前展示的记录 id;null = 关闭。 */
  activeId: string | null;
  /** 翻图/开启时回调(选中行跟随,05 §7);id 为集合内记录。 */
  onNavigate(id: string): void;
  onClose(): void;
  /** 保存图片(mutation 与 toast 由 Screen 层持有,与检视动作共用)。 */
  onSaveAsset(asset: GenerationAsset): void;
  /** 桌面文件操作(05 §7):按 canRevealLocalFile 门控注入,Web 不渲染。 */
  onRevealAsset?(asset: GenerationAsset): void;
  onCopyAsset?(asset: GenerationAsset): void;
}

async function copyPrompt(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt);
    toast.success('已复制提示词');
  } catch {
    toast.error('复制失败,剪贴板不可用');
  }
}

/**
 * 历史 Lightbox(ui-parity 05 §7 P1 + 05-C1 工艺):
 * 成功集合内左右翻(按钮 + 方向键),计数「n / N」tabular;
 * 遮罩 background/90 + backdrop-blur;图片落定 scale 0.98→1;
 * 相邻资产预取(翻图无白闪);Esc 关闭由 Dialog 原生承接并归还焦点(I9)。
 */
export function HistoryLightbox({
  entries,
  activeId,
  onNavigate,
  onClose,
  onSaveAsset,
  onRevealAsset,
  onCopyAsset,
}: HistoryLightboxProps) {
  const index = activeId ? entries.findIndex((entry) => entry.job.id === activeId) : -1;
  const current = index >= 0 ? entries[index] : null;
  const prev = index > 0 ? entries[index - 1] : null;
  const next = index >= 0 && index < entries.length - 1 ? entries[index + 1] : null;

  // 05-C1:预取相邻资产,方向键连翻不见白闪。
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    for (const neighbor of [prev, next]) {
      if (neighbor) new Image().src = neighbor.asset.url;
    }
  }, [prev, next]);

  return (
    <Dialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-[min(94vw,72rem)] gap-2 border-none bg-transparent p-0 shadow-none"
        overlayClassName="bg-background/90 backdrop-blur-sm"
        aria-describedby={undefined}
        data-testid="history-lightbox"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && prev) {
            event.preventDefault();
            onNavigate(prev.job.id);
          }
          if (event.key === 'ArrowRight' && next) {
            event.preventDefault();
            onNavigate(next.job.id);
          }
        }}
      >
        <DialogTitle className="sr-only">图片放大预览</DialogTitle>
        {current && (
          <>
            <div className="relative flex items-center justify-center">
              {/* key 翻图重挂:落定动画重播,FadeImage 独立管理淡入。 */}
              <div key={current.job.id} className="mf-lightbox-settle flex justify-center">
                <FadeImage
                  src={current.asset.url}
                  alt={current.job.request.prompt.slice(0, 60)}
                  className="max-h-[82vh] w-auto max-w-full rounded-xl object-contain"
                  data-testid="lightbox-image"
                />
              </div>
              {prev && (
                <Button
                  variant="outline"
                  size="icon"
                  className="-translate-y-1/2 absolute top-1/2 left-2 size-8 rounded-full bg-background/80 backdrop-blur"
                  aria-label="上一张"
                  data-testid="lightbox-prev"
                  onClick={() => onNavigate(prev.job.id)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
              )}
              {next && (
                <Button
                  variant="outline"
                  size="icon"
                  className="-translate-y-1/2 absolute top-1/2 right-2 size-8 rounded-full bg-background/80 backdrop-blur"
                  aria-label="下一张"
                  data-testid="lightbox-next"
                  onClick={() => onNavigate(next.job.id)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 px-1 pb-1">
              <p className="line-clamp-1 min-w-0 text-muted-foreground text-xs">
                {current.job.request.prompt}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className="text-muted-foreground text-xs tabular-nums"
                  data-testid="lightbox-counter"
                >
                  {index + 1} / {entries.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  data-testid="lightbox-copy-prompt"
                  onClick={() => void copyPrompt(current.job.request.prompt)}
                >
                  <Copy className="size-3.5" /> 复制提示词
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  data-testid="lightbox-save-asset"
                  onClick={() => onSaveAsset(current.asset)}
                >
                  <Download className="size-3.5" /> 保存图片
                </Button>
                {onCopyAsset && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-copy-asset"
                    onClick={() => onCopyAsset(current.asset)}
                  >
                    <ImageIcon className="size-3.5" /> 复制图片
                  </Button>
                )}
                {onRevealAsset && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-reveal-asset"
                    onClick={() => onRevealAsset(current.asset)}
                  >
                    <FolderOpen className="size-3.5" /> 在文件夹中显示
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
