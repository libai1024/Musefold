'use client';

import type { DesignSchemeSummary } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { SchemeAssetImage } from './SchemeAssetImage';
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Clock3,
  GitBranch,
  PanelRightClose,
  Play,
} from '@musefold/ui/icons';
import { FIDELITY_LABEL, formatSchemeDateTime, lifecycleFor } from './scheme-labels';
import type { ResolveSchemeAssetUrl } from './types';

/**
 * 右栏 Inspector(承旧 SchemeInspector):生命周期状态卡 + 摘要/输入/来源 + 主/次动作。
 * lg+ 内嵌 aside;窄屏由 SchemesScreen 装入 Sheet(承 05 HistoryInspector 模式)。
 */
export function SchemeInspector({
  scheme,
  resolveAssetUrl,
  runDisabledReason,
  onClose,
  onOpenDetail,
  onRun,
}: {
  scheme: DesignSchemeSummary;
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  runDisabledReason: string | null;
  onClose(): void;
  onOpenDetail(): void;
  onRun(): void;
}) {
  const lifecycle = lifecycleFor(scheme);
  const LifecycleIcon = lifecycle.tone === 'ready' ? CheckCircle2 : Clock3;
  const actionLabel =
    scheme.status === 'formal'
      ? '使用方案'
      : scheme.hasSuccessfulTrial
        ? '继续试运行'
        : '开始试运行';
  const coverUrl = scheme.coverAssetId ? (resolveAssetUrl?.(scheme.coverAssetId) ?? null) : null;

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="方案详情"
      data-testid="scheme-inspector"
      data-scheme-id={scheme.id}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-border border-b px-3.5">
        <span className="font-semibold text-[12px] text-foreground">方案详情</span>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="关闭方案详情"
          title="关闭方案详情"
          data-testid="scheme-inspector-close"
          onClick={onClose}
        >
          <PanelRightClose className="size-3.5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-8">
        <div className="aspect-[16/9] w-full overflow-hidden rounded-lg border border-border bg-muted/50">
          {coverUrl ? (
            <SchemeAssetImage
              src={coverUrl}
              alt={`${scheme.name}方案示例`}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-primary/10 text-primary">
              <Blocks className="size-8" aria-hidden />
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground">
              {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
              {lifecycle.label}
            </span>
          </div>
          <h2 className="mt-2 font-semibold text-[15px] text-foreground leading-6">
            {scheme.name}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground leading-5">{scheme.summary}</p>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-border border-b pb-5">
          <Button
            className="min-h-9 gap-1.5"
            data-testid="scheme-inspector-run"
            disabled={runDisabledReason != null}
            title={runDisabledReason ?? undefined}
            onClick={onRun}
          >
            <Play className="size-3.5" aria-hidden />
            {actionLabel}
          </Button>
          <Button
            variant="outline"
            className="min-h-9 gap-1.5"
            data-testid="scheme-inspector-open-detail"
            onClick={onOpenDetail}
          >
            完整详情
            <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </div>

        <section className="border-border border-b py-5">
          <h3 className="font-semibold text-xs text-foreground">当前状态</h3>
          <div className="mt-3 flex items-start gap-2.5">
            <LifecycleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium text-[12px] text-foreground">{lifecycle.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-5">
                {lifecycle.detail}
              </p>
            </div>
          </div>
        </section>

        <section className="border-border border-b py-5">
          <h3 className="font-semibold text-xs text-foreground">需要提供</h3>
          {scheme.inputLabels.length > 0 ? (
            <ul className="mt-2.5 divide-y divide-border">
              {scheme.inputLabels.map((label, index) => (
                <li
                  key={`${label}-${index}`}
                  className="flex min-h-9 items-center justify-between gap-3 py-2 text-[11px]"
                >
                  <span className="min-w-0 text-foreground">{label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    输入 {index + 1}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground leading-5">
              无需额外输入，可直接运行。
            </p>
          )}
        </section>

        <section className="py-5">
          <h3 className="font-semibold text-xs text-foreground">来源与版本</h3>
          <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">来源</dt>
            <dd className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <GitBranch className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{scheme.sourceLabel}</span>
            </dd>
            <dt className="text-muted-foreground">最近更新</dt>
            <dd className="text-muted-foreground">{formatSchemeDateTime(scheme.updatedAt)}</dd>
            <dt className="text-muted-foreground">运行记录</dt>
            <dd className="text-muted-foreground">
              {scheme.lastRunAt
                ? `最近运行于 ${formatSchemeDateTime(scheme.lastRunAt)}`
                : '尚未运行'}
            </dd>
          </dl>
        </section>
      </div>
    </section>
  );
}
