import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, X } from '../../components/ui/icons';
import { toImageSrc } from '../../lib/media';
import type { DesignSchemeAssetSummary } from '@musefold/desktop-contracts/design-scheme';
import { ASSET_ORIGIN_LABEL } from './scheme-runtime-labels';

/** 折叠相册：封面在前，点击后层切换查看，前层点开全屏（UI 规范 §5.1）。 */
export function RuntimeAlbum({
  assets,
  coverAssetId,
  onSetCover,
  coverBusy,
}: {
  assets: DesignSchemeAssetSummary[];
  coverAssetId: string | null;
  onSetCover: (assetId: string) => void;
  coverBusy: boolean;
}) {
  const [activeId, setActiveId] = useState(coverAssetId ?? assets[0]?.id ?? '');
  const [lightbox, setLightbox] = useState<DesignSchemeAssetSummary | null>(null);
  useEffect(() => setActiveId(coverAssetId ?? assets[0]?.id ?? ''), [coverAssetId, assets]);

  if (assets.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-border-default bg-inset/35 px-6 text-center">
        <Images className="h-6 w-6 text-quaternary" />
        <p className="mt-3 text-[12px] font-medium text-primary">还没有本机试运行结果</p>
        <p className="mt-1 text-[10.5px] text-tertiary">完成一次试运行后，这里会展示生成的示例。</p>
      </div>
    );
  }

  const activeIndex = Math.max(0, assets.findIndex((asset) => asset.id === activeId));
  const active = assets[activeIndex] ?? assets[0];
  const behind = Array.from(
    { length: Math.min(3, assets.length - 1) },
    (_, offset) => assets[(activeIndex + offset + 1) % assets.length],
  );
  const previous = () => setActiveId(assets[(activeIndex - 1 + assets.length) % assets.length].id);
  const next = () => setActiveId(assets[(activeIndex + 1) % assets.length].id);

  return (
    <>
      <div className="mx-auto w-full max-w-[660px]" data-testid="runtime-scheme-album">
        <div className="relative mr-6 mb-6 min-h-[300px] max-[720px]:mr-3 max-[720px]:mb-3">
          {[...behind].reverse().map((asset, reverseIndex) => {
            const depth = behind.length - reverseIndex;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => setActiveId(asset.id)}
                className="absolute inset-0 overflow-hidden rounded-md border border-border-default bg-elevated transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                style={{ transform: `translate(${depth * 7}px, ${depth * 7}px)`, zIndex: 5 - depth }}
                aria-label="查看这张示例"
              >
                <img src={toImageSrc(asset.path)} alt="" className="h-full w-full object-contain opacity-70" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setLightbox(active)}
            className="relative z-10 flex h-[min(48dvh,440px)] min-h-[300px] w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md border border-border-default bg-inset/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            aria-label="全屏查看当前示例"
          >
            <img src={toImageSrc(active.path)} alt="方案示例" className="h-full w-full object-contain" />
          </button>
        </div>
        <div className="flex min-h-8 items-center gap-2 text-[10.5px] text-tertiary">
          <span>{ASSET_ORIGIN_LABEL[active.origin]}</span>
          <span>·</span>
          <span className="tabular-nums">{activeIndex + 1} / {assets.length}</span>
          {active.id === coverAssetId && <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px]">封面</span>}
          <div className="ml-auto flex items-center gap-1">
            {active.id !== coverAssetId && (
              <button
                type="button"
                disabled={coverBusy}
                onClick={() => onSetCover(active.id)}
                className="mr-2 min-h-8 rounded-md px-2 text-[10.5px] font-medium text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-set-cover"
              >
                设为封面
              </button>
            )}
            <button type="button" onClick={previous} className="icon-action" title="上一张" aria-label="上一张"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={next} className="icon-action" title="下一张" aria-label="下一张"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-6 animate-overlay-in"
          role="dialog"
          aria-modal="true"
          aria-label="方案示例全屏预览"
          onClick={() => setLightbox(null)}
        >
          <img src={toImageSrc(lightbox.path)} alt="方案示例" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20"
            aria-label="关闭全屏预览"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
