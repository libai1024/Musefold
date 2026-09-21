'use client';

import type { DesignSchemeSummary, MarketCandidate } from '@musefold/contracts';
import { SchemeAssetImage } from './SchemeAssetImage';
import { Blocks, GitBranch, Star, Trash2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { FIDELITY_LABEL, marketUpdatedLabel, schemeActionLabel } from './scheme-labels';
import type { ResolveSchemeAssetUrl } from './types';

/** 56px 封面格(承旧):有封面图用宿主解析地址,无则 Blocks 占位。 */
function SchemeCoverThumb({
  scheme,
  resolveAssetUrl,
  size = 'row',
}: {
  scheme: DesignSchemeSummary;
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  size?: 'row' | 'header';
}) {
  const url = scheme.coverAssetId ? (resolveAssetUrl?.(scheme.coverAssetId) ?? null) : null;
  const box = size === 'row' ? 'size-14 rounded-md' : 'size-10 rounded-md';
  if (url) {
    return (
      <span
        className={cn(
          'flex items-center justify-center overflow-hidden border border-border bg-muted/50',
          box,
        )}
      >
        <SchemeAssetImage compact src={url} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex items-center justify-center bg-primary/10 text-primary',
        box,
        size === 'row' && 'border border-border',
      )}
      aria-hidden
    >
      <Blocks className={size === 'row' ? 'size-5' : 'size-5'} />
    </span>
  );
}

/** 行尾悬停删除入口(承旧 RowRemoveButton):危险操作 hover 渐显 + 确认弹窗;触屏常显(I2)。 */
function RowRemoveButton({
  label,
  onRemove,
  testId,
}: {
  label: string;
  onRemove(): void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 group-hover:opacity-100 md:opacity-0"
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  );
}

/**
 * 方案行(承旧 RuntimeSchemeRow):grid 56px 封面 | 内容 | 删除 | 主动作,行高 ≥76px;
 * 草稿未试运行成功时名称前有 accent 圆点(待办信号);选中 = 主色软底(Inspector 常驻,选中是强状态)。
 */
export function SchemeRow({
  scheme,
  selected,
  resolveAssetUrl,
  runDisabledReason,
  onOpen,
  onRun,
  onRemove,
}: {
  scheme: DesignSchemeSummary;
  selected: boolean;
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  /** 宿主未接入运行接缝时的禁用理由;null = 可用。 */
  runDisabledReason: string | null;
  onOpen(): void;
  onRun(): void;
  onRemove(): void;
}) {
  const actionLabel = schemeActionLabel(scheme);
  return (
    <article
      className={cn(
        'group grid min-h-[76px] grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border px-2 py-2 transition-colors',
        selected ? 'border-primary/20 bg-primary/5' : 'border-transparent hover:bg-muted',
      )}
      data-testid={`runtime-scheme-row-${scheme.id}`}
      data-runtime-scheme="true"
      data-status={scheme.status}
      data-selected={selected}
    >
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`查看${scheme.name}`}
      >
        <SchemeCoverThumb scheme={scheme} resolveAssetUrl={resolveAssetUrl} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 text-left focus-visible:outline-none"
        data-testid={`runtime-scheme-open-${scheme.id}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {scheme.status === 'draft' && !scheme.hasSuccessfulTrial ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : null}
          <span className="truncate font-semibold text-[13px] text-foreground">{scheme.name}</span>
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {scheme.summary}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground/80">
          <GitBranch className="size-3 shrink-0" aria-hidden />
          {scheme.sourceLabel}
          {scheme.status === 'draft' ? (
            <span>· {scheme.hasSuccessfulTrial ? '已有成功试运行' : '等待试运行'}</span>
          ) : null}
          {scheme.inputLabels.length > 0 ? (
            <span>· 输入:{scheme.inputLabels.join('、')}</span>
          ) : null}
        </span>
      </button>
      <RowRemoveButton
        label={scheme.status === 'draft' ? '删除草稿' : '移除方案'}
        onRemove={onRemove}
        testId={`runtime-scheme-remove-${scheme.id}`}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRun();
        }}
        disabled={runDisabledReason != null}
        title={runDisabledReason ?? undefined}
        className="min-h-8 shrink-0 rounded-md px-2.5 font-medium text-[11px] text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        data-testid={`runtime-scheme-action-${scheme.id}`}
      >
        {actionLabel}
      </button>
    </article>
  );
}

/** 市场候选行(承旧 MarketCandidateRow):许可证徽标、星数/更新时间/匹配理由、风险提示;已添加则跳检查。 */
export function MarketCandidateRow({
  candidate,
  installed,
  addDisabledReason,
  onAdd,
  onOpenInstalled,
}: {
  candidate: MarketCandidate;
  installed: DesignSchemeSummary | null;
  addDisabledReason: string | null;
  onAdd(): void;
  onOpenInstalled(): void;
}) {
  return (
    <article
      className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted"
      data-testid={`market-candidate-${candidate.candidateId}`}
    >
      <span
        className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground"
        aria-hidden
      >
        <GitBranch className="size-5" />
      </span>
      <div className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-[13px] text-foreground">
            {candidate.fullName}
          </span>
          {candidate.license ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {candidate.license}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {candidate.description ?? '仓库未提供描述'}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground/80">
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <Star className="size-3" aria-hidden />
            {candidate.stars}
          </span>
          <span className="shrink-0">{marketUpdatedLabel(candidate.updatedAt)}</span>
          <span className="truncate">· {candidate.matchReason}</span>
        </span>
        {candidate.riskSummary ? (
          <span
            className="mt-1 block truncate text-[11px] text-warning"
            data-testid={`market-risk-${candidate.candidateId}`}
          >
            {candidate.riskSummary}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={installed ? onOpenInstalled : onAdd}
        disabled={!installed && addDisabledReason != null}
        title={!installed ? (addDisabledReason ?? undefined) : undefined}
        className="min-h-8 shrink-0 rounded-md px-2.5 font-medium text-[11px] text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        data-testid={`market-add-${candidate.candidateId}`}
      >
        {installed ? '已添加' : '添加'}
      </button>
    </article>
  );
}
