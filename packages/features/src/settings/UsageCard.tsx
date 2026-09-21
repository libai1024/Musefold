'use client';

import type { UsageRange, UsageSummary } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@musefold/ui/components/toggle-group';
import { ChevronDown, RefreshCw } from '@musefold/ui/icons';
import { useState } from 'react';
import { useUsageSummary } from './hooks';
import { SEGMENT_GROUP_CLASS, SEGMENT_ITEM_CLASS } from './segment-classes';
import { formatUsageCost, formatUsageCount, formatUsageRate } from './usage-format';
import { UsageCharts } from './UsageCharts';

export { formatUsageCost, formatUsageCount, formatUsageRate } from './usage-format';

const RANGE_OPTIONS: readonly { value: UsageRange; label: string }[] = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
];

function isUsageEmpty(summary: UsageSummary): boolean {
  return summary.generationCount === 0 && summary.imageCount === 0;
}

function usageErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '使用统计加载失败';
}

/**
 * 「使用统计」分区卡(ui-parity 07-05):四指标 + 范围切换 + 刷新 + 渠道明细 + 图表。
 * 图表与四指标共用 usage.summary;切范围走 keepPreviousData,不闪骨架。
 */
export function UsageCard() {
  const [range, setRange] = useState<UsageRange>('30d');
  const [providersOpen, setProvidersOpen] = useState(false);
  const query = useUsageSummary(range);
  const summary = query.data;
  const showSkeleton = query.isPending && !summary;
  const showError = query.isError && !summary;

  return (
    <Card data-testid="settings-usage-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>使用统计</CardTitle>
          <CardDescription>
            汇总各生成渠道的用量与稳定性;积分消耗只采用有实际扣费记录的渠道。
          </CardDescription>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          title="刷新使用统计"
          aria-label="刷新使用统计"
          data-testid="settings-usage-refresh"
        >
          <RefreshCw className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">统计时间范围</p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={range}
            onValueChange={(value) => {
              if (value === '7d' || value === '30d' || value === '90d') setRange(value);
            }}
            aria-label="统计时间范围"
            className={SEGMENT_GROUP_CLASS}
            data-testid="settings-usage-range"
          >
            {RANGE_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
                data-testid={`settings-usage-range-${option.value}`}
                className={SEGMENT_ITEM_CLASS}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {showSkeleton ? (
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            data-testid="settings-usage-loading"
          >
            {['generation', 'rate', 'images', 'cost'].map((id) => (
              <Skeleton key={id} className="h-[4.75rem] w-full" />
            ))}
          </div>
        ) : showError ? (
          <div
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-3 py-2"
            role="alert"
            data-testid="settings-usage-error"
          >
            <p className="text-destructive text-sm">{usageErrorMessage(query.error)}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
              data-testid="settings-usage-retry"
            >
              重试
            </Button>
          </div>
        ) : summary && isUsageEmpty(summary) ? (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm" data-testid="settings-usage-empty">
              这段时间还没有生成记录
            </p>
            <UsageCharts summary={summary} />
          </div>
        ) : summary ? (
          <UsageReadyBody summary={summary} open={providersOpen} onOpenChange={setProvidersOpen} />
        ) : null}

        <p className="text-muted-foreground text-xs" data-testid="settings-usage-accounting-note">
          积分消耗仅统计有实际扣费记录的成功生成。体验通道与自建 Provider
          只展示用量和成功率,不进行积分换算。
        </p>
      </CardContent>
    </Card>
  );
}

function UsageReadyBody({
  summary,
  open,
  onOpenChange,
}: {
  summary: UsageSummary;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label="使用摘要"
        data-testid="settings-usage-summary"
      >
        <UsageMetric
          label="生成次数"
          value={formatUsageCount(summary.generationCount)}
          testId="settings-usage-generation-count"
        />
        <UsageMetric
          label="成功率"
          value={formatUsageRate(summary.successRate)}
          testId="settings-usage-success-rate"
        />
        <UsageMetric
          label="成图数"
          value={formatUsageCount(summary.imageCount)}
          testId="settings-usage-image-count"
        />
        <UsageMetric
          label="消耗积分"
          value={formatUsageCost(summary.costPoints)}
          testId="settings-usage-cost"
        />
      </section>

      {summary.byProvider.length > 0 ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            data-testid="settings-usage-by-provider-toggle"
          >
            按渠道明细
            <ChevronDown className={open ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
          </Button>
          {open ? (
            <table className="mt-2 w-full text-sm" data-testid="settings-usage-by-provider">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="pb-1.5 font-medium">渠道</th>
                  <th className="pb-1.5 font-medium">生成</th>
                  <th className="pb-1.5 font-medium">积分</th>
                </tr>
              </thead>
              <tbody>
                {summary.byProvider.map((row) => (
                  <tr key={`${row.providerId ?? 'none'}:${row.label}`}>
                    <td className="py-1">{row.label}</td>
                    <td className="py-1 tabular-nums">{formatUsageCount(row.generationCount)}</td>
                    <td className="py-1 tabular-nums">{formatUsageCost(row.costPoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      <UsageCharts summary={summary} />
    </div>
  );
}

function UsageMetric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-border/60 px-3 py-2">
      <strong
        className="block text-[20px] font-semibold leading-7 tabular-nums"
        data-testid={testId}
      >
        {value}
      </strong>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
