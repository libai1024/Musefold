// src/features/library/components/PromptWorksPanel.tsx
// 提示词相关作品 —— 详情页的一个分区（v0.3.2 重塑后不再是检视器 tab）。
// 只显示真实由这条提示词进入制作或引用它产生的记录；相同文字不自动归属。

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Ban, ImageOff, Images, Loader2, Power, RefreshCw } from '../../../components/ui/icons';
import type { HistoryRecord, Prompt } from '@musefold/desktop-contracts/models';
import api from '../../../lib/ipc';
import { toImageSrc } from '../../../lib/media';
import { formatTime } from '../../../lib/format';
import { ImageLightbox } from '../../../components/ui/image-lightbox';
import { cn } from '../../../lib/utils';
import { loadRelatedHistory } from '../related-history';
import { promptRelationLabel } from '../prompt-relation-label';

export function PromptWorksPanel({ prompt }: { prompt: Prompt }) {
  const [includeAll, setIncludeAll] = useState(false);
  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [coverage, setCoverage] = useState<'full' | 'direct-only'>('full');
  const [runtimeDbVersion, setRuntimeDbVersion] = useState<number | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBroken(new Set());
    setCoverage('full');
    setRuntimeDbVersion(null);
    void loadRelatedHistory({
        promptId: prompt.id,
        status: includeAll ? undefined : 'success',
        limit: 120,
      })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setCoverage(result.coverage);
        setRuntimeDbVersion(result.runtimeDbVersion);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '作品加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeAll, prompt.id, reloadKey]);

  const successful = useMemo(
    () => items.filter((item) => item.status === 'success' && item.imagePath),
    [items],
  );
  const nonSuccessful = useMemo(
    () => items.filter((item) => item.status !== 'success'),
    [items],
  );
  const lightboxIndex = successful.findIndex((item) => item.id === lightboxId);
  const lightbox = lightboxIndex >= 0 ? successful[lightboxIndex] : null;
  const restartForIndex = async () => {
    setRestarting(true);
    setError(null);
    try {
      await api.system.relaunch();
    } catch {
      setRestarting(false);
      setError('无法自动重启，请完全退出 Musefold 后重新打开。');
    }
  };

  return (
    <section className="border-t border-border-subtle pt-5" data-testid="prompt-works-panel">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-primary">相关作品</h2>
        <span className="text-[10px] tabular-nums text-tertiary">
          {loading ? '统计中' : error ? '' : total}
        </span>
        <button
          type="button"
          onClick={() => setIncludeAll((value) => !value)}
          className={cn(
            'ml-auto min-h-7 rounded-md px-2 text-[10.5px] transition-colors',
            includeAll ? 'bg-active text-primary' : 'text-tertiary hover:bg-hover hover:text-primary',
          )}
          aria-pressed={includeAll}
          data-testid="prompt-works-all-toggle"
        >
          {includeAll ? '仅看成功作品' : '查看全部记录'}
        </button>
      </div>

      {coverage === 'direct-only' && !loading && (
        <div className="mt-3 rounded-md border border-warning/25 bg-warning/5 px-2.5 py-2 text-[10px] leading-relaxed text-secondary" data-testid="prompt-works-restart-notice">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-primary">引用作品索引尚未加载</p>
              <p className="mt-0.5 text-tertiary">
                当前运行主进程{runtimeDbVersion != null ? `仍为 DB v${runtimeDbVersion}` : '版本较旧'}，暂时只显示直接从这条提示词进入制作的记录。重启后会启用整条与选段引用关联。
              </p>
              <button
                type="button"
                onClick={() => void restartForIndex()}
                disabled={restarting}
                className="mt-1.5 inline-flex items-center gap-1 font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                data-testid="prompt-works-restart"
              >
                {restarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                {restarting ? '正在重启' : '重启应用并建立索引'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[10.5px] text-tertiary" data-testid="prompt-works-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载作品
          </div>
        ) : error ? (
          <div className="rounded-md border border-danger/25 bg-danger/5 p-3 text-[10.5px] text-danger" data-testid="prompt-works-error">
            <p>{error}</p>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-2 inline-flex items-center gap-1 text-secondary hover:text-primary">
              <RefreshCw className="h-3 w-3" /> 重试
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="prompt-works-empty">
            <Images className="h-5 w-5 text-quaternary" />
            <p className="mt-3 text-[12px] text-secondary">还没有基于这条提示词生成的作品</p>
            <p className="mt-1 max-w-[46ch] text-[10.5px] leading-relaxed text-tertiary">
              只有从这条提示词进入制作，或在制作中引用它的记录会显示在这里。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {successful.length > 0 && (
              <div className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-3 min-[860px]:grid-cols-4" data-testid="prompt-works-grid">
                {successful.map((item) => {
                  const isBroken = broken.has(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => !isBroken && setLightboxId(item.id)}
                      className="group relative aspect-square overflow-hidden rounded-md border border-border-subtle bg-inset text-left hover:border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                      data-testid="prompt-work-image"
                    >
                      <span className="absolute left-1.5 top-1.5 z-10 rounded-sm border border-white/15 bg-black/65 px-1.5 py-0.5 text-[8px] font-medium text-white/90">
                        {promptRelationLabel(item)}
                      </span>
                      {isBroken ? (
                        <span className="flex h-full flex-col items-center justify-center gap-1 text-[9.5px] text-tertiary">
                          <ImageOff className="h-4 w-4" /> 图片无法加载
                        </span>
                      ) : (
                        <img
                          src={toImageSrc(item.imagePath!)}
                          alt={prompt.title}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          loading="lazy"
                          onError={() => setBroken((current) => new Set(current).add(item.id))}
                        />
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 text-[8.5px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                        {formatTime(item.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {includeAll && nonSuccessful.length > 0 && (
              <div className="space-y-1.5" data-testid="prompt-works-status-list">
                {nonSuccessful.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 rounded-md border border-border-subtle bg-elevated px-2.5 py-2">
                    {item.status === 'cancelled' ? (
                      <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10.5px] font-medium text-secondary">
                        {item.status === 'cancelled' ? '已取消' : '生成失败'}
                      </span>
                      <span className="mt-0.5 block text-[9px] font-medium text-accent/85">
                        {promptRelationLabel(item)}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[9.5px] leading-relaxed text-tertiary">
                        {item.errorMessage || item.errorCode || '没有更多错误信息'}
                      </span>
                    </span>
                    <span className="shrink-0 text-[8.5px] text-quaternary">{formatTime(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ImageLightbox
        path={lightbox?.imagePath ?? null}
        prompt={lightbox?.promptText}
        onClose={() => setLightboxId(null)}
        hasPrevious={lightboxIndex > 0}
        hasNext={lightboxIndex >= 0 && lightboxIndex < successful.length - 1}
        onPrevious={() => lightboxIndex > 0 && setLightboxId(successful[lightboxIndex - 1].id)}
        onNext={() => lightboxIndex >= 0 && lightboxIndex < successful.length - 1 && setLightboxId(successful[lightboxIndex + 1].id)}
      />
    </section>
  );
}
