import type { CSSProperties } from 'react';
import type { SharePayload } from '@shared/share';
import { cn } from '../../lib/utils';

interface Props {
  payload: SharePayload;
  compact?: boolean;
  className?: string;
}

export function ShareCard({ payload, compact = false, className }: Props) {
  const chips = buildChips(payload);
  const hasPreview = Boolean(payload.previewDataUrl);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-border-subtle bg-elevated',
        compact ? 'p-3' : 'p-4',
        className,
      )}
      data-testid="share-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-quaternary">
            分享预览
          </div>
          <h3
            className={cn(
              'mt-1 font-semibold text-primary',
              compact ? 'text-[13px] leading-snug' : 'text-[15px] leading-snug',
            )}
            data-testid="share-card-title"
          >
            {payload.title}
          </h3>
        </div>
        {payload.target && (
          <span className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-secondary">
            {payload.target}
          </span>
        )}
      </div>

      <div
        className={cn(
          'mt-3 overflow-hidden rounded-md border border-border-subtle bg-inset/50',
          hasPreview ? 'aspect-[4/3]' : 'flex min-h-36 items-center justify-center',
        )}
        data-testid="share-card-visual"
      >
        {hasPreview ? (
          <img
            alt=""
            src={payload.previewDataUrl}
            className="h-full w-full object-cover"
            data-testid="share-card-preview"
          />
        ) : (
          <div className="px-3 text-center text-[11px] text-tertiary">无预览图，已转为文字卡片</div>
        )}
      </div>

      <p
        className={cn(
          'mt-3 whitespace-pre-wrap break-words text-secondary text-[12px] leading-relaxed',
        )}
        style={clampStyle(compact ? 5 : 6)}
        data-testid="share-card-content"
      >
        {payload.content}
      </p>

      {payload.contentNegative && (
        <p
          className={cn(
            'mt-2 border-l-2 border-danger/60 pl-2 whitespace-pre-wrap break-words text-tertiary text-[11px] leading-relaxed',
          )}
          style={clampStyle(compact ? 2 : 3)}
          data-testid="share-card-negative"
        >
          负面：{payload.contentNegative}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="share-card-chips">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full bg-inset px-2 py-0.5 text-[10px] text-secondary">
            {chip}
          </span>
        ))}
      </div>
    </section>
  );
}

function buildChips(payload: SharePayload): string[] {
  const chips: string[] = [];
  if (payload.target) chips.push(`Target ${payload.target}`);
  const params = payload.params;
  if (!params) return chips.length > 0 ? chips : ['Prompt'];
  if (typeof params.ratioId === 'string') chips.push(`Ratio ${params.ratioId}`);
  else if (typeof params.aspectRatio === 'string') chips.push(`Ratio ${params.aspectRatio}`);
  if (typeof params.size === 'string') chips.push(`Size ${params.size}`);
  if (typeof params.quality === 'string') chips.push(`Quality ${params.quality}`);
  if (typeof params.n === 'number') chips.push(`Count ${params.n}`);
  if (typeof params.steps === 'number') chips.push(`Steps ${params.steps}`);
  if (typeof params.cfg === 'number') chips.push(`CFG ${params.cfg}`);
  if (typeof params.sampler === 'string') chips.push(params.sampler);
  return chips.length > 0 ? chips.slice(0, 8) : ['Prompt'];
}

function clampStyle(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };
}
