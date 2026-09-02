'use client';

import type { DesignSchemeAsset } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@musefold/ui/components/dialog';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ChevronLeft, ChevronRight, Images } from '@musefold/ui/icons';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, TouchEvent } from 'react';
import { ASSET_ORIGIN_LABEL } from './scheme-labels';
import type { ResolveSchemeAssetUrl } from './types';

/**
 * 试运行产物相册(承旧 RuntimeAlbum):封面在前,后面叠放 ≤3 张(7px/层偏移),
 * 点击后层切换查看,前层点开全屏;支持左右方向键与横向触控滑动;空态引导承旧文案。
 * 资产是 path-free 元数据,展示地址经宿主注入的 resolveAssetUrl 解析。
 */
export function SchemeAlbum({
  assets,
  coverAssetId,
  resolveAssetUrl,
  onSetCover,
  coverBusy,
}: {
  assets: DesignSchemeAsset[];
  coverAssetId: string | null;
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  onSetCover(assetId: string): void;
  coverBusy: boolean;
}) {
  const [activeId, setActiveId] = useState(coverAssetId ?? assets[0]?.id ?? '');
  const [lightbox, setLightbox] = useState<DesignSchemeAsset | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => setActiveId(coverAssetId ?? assets[0]?.id ?? ''), [coverAssetId, assets]);

  if (assets.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-border border-dashed bg-muted/30 px-6 text-center">
        <Images className="size-6 text-muted-foreground/60" aria-hidden />
        <p className="mt-3 font-medium text-foreground text-xs">还没有本机试运行结果</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          完成一次试运行后,这里会展示生成的示例。
        </p>
      </div>
    );
  }

  const activeIndex = Math.max(
    0,
    assets.findIndex((asset) => asset.id === activeId),
  );
  const active = assets[activeIndex] ?? assets[0];
  const behind = Array.from(
    { length: Math.min(3, assets.length - 1) },
    (_, offset) => assets[(activeIndex + offset + 1) % assets.length],
  );
  const previous = () => setActiveId(assets[(activeIndex - 1 + assets.length) % assets.length].id);
  const next = () => setActiveId(assets[(activeIndex + 1) % assets.length].id);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    }
  }
  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    suppressClickRef.current = false;
  }
  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    suppressClickRef.current = true;
    if (deltaX > 0) previous();
    else next();
  }
  function handleSwipeClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }
  const activeUrl = resolveAssetUrl?.(active.id) ?? null;
  const lightboxUrl = lightbox ? (resolveAssetUrl?.(lightbox.id) ?? null) : null;

  return (
    <>
      <div className="mx-auto w-full max-w-[660px]" data-testid="runtime-scheme-album">
        <div
          className="relative mr-6 mb-6 min-h-[300px] touch-pan-y max-[720px]:mr-3 max-[720px]:mb-3"
          tabIndex={0}
          role="region"
          aria-label="方案示例相册"
          onKeyDown={handleKeyDown}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClickCapture={handleSwipeClickCapture}
        >
          {[...behind].reverse().map((asset, reverseIndex) => {
            const depth = behind.length - reverseIndex;
            const url = resolveAssetUrl?.(asset.id) ?? null;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => setActiveId(asset.id)}
                className="absolute inset-0 overflow-hidden rounded-md border border-border bg-card transition-transform duration-(--dur-base) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  transform: `translate(${depth * 7}px, ${depth * 7}px)`,
                  zIndex: 5 - depth,
                }}
                aria-label="查看这张示例"
              >
                {url ? (
                  <FadeImage src={url} alt="" className="h-full w-full object-contain opacity-70" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                    <Images className="size-6" aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setLightbox(active)}
            className="relative z-10 flex h-[min(48dvh,440px)] min-h-[300px] w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="全屏查看当前示例"
          >
            {activeUrl ? (
              <FadeImage src={activeUrl} alt="方案示例" className="h-full w-full object-contain" />
            ) : (
              <Images className="size-8 text-muted-foreground/60" aria-hidden />
            )}
          </button>
        </div>
        <div className="flex min-h-8 items-center gap-2 text-[11px] text-muted-foreground">
          <span>{ASSET_ORIGIN_LABEL[active.origin]}</span>
          <span>·</span>
          <span className="tabular-nums">
            {activeIndex + 1} / {assets.length}
          </span>
          {active.id === coverAssetId ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px]">
              封面
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {active.id !== coverAssetId ? (
              <button
                type="button"
                disabled={coverBusy}
                onClick={() => onSetCover(active.id)}
                className="mr-2 min-h-8 rounded-md px-2 font-medium text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-set-cover"
              >
                设为封面
              </button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={previous}
              title="上一张"
              aria-label="上一张"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={next}
              title="下一张"
              aria-label="下一张"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={lightbox != null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          className="flex max-h-[92dvh] max-w-[92vw] items-center justify-center border-none bg-transparent p-0 shadow-none sm:max-w-[92vw]"
          aria-label="方案示例全屏预览"
          data-testid="scheme-asset-lightbox"
        >
          <DialogTitle className="sr-only">方案示例全屏预览</DialogTitle>
          {lightboxUrl ? (
            <FadeImage
              src={lightboxUrl}
              alt="方案示例"
              className="max-h-[88dvh] max-w-full object-contain"
            />
          ) : (
            <Skeleton className="h-[60dvh] w-[60vw]" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
