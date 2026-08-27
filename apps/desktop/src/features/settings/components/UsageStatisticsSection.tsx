import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPoints } from '@musefold/domain';
import { musefoldQueryKeys } from '@musefold/product-ui';
import type { HistoryStatsQuery } from '@musefold/desktop-contracts/history-documents';
import { Loader2, RefreshCw } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import { SectionShell } from './SectionShell';
import { useAccountStore } from '../../../runtime/account-access';
import { desktopGateway } from '../../../runtime';
import {
  buildActivityQuery,
  buildUsageStatsQuery,
  formatUsageCount,
  formatUsagePercent,
  formatUsagePoints,
  successRate,
  USAGE_RANGE_OPTIONS,
  type UsageRange,
} from '../usage-statistics';
import {
  UsageActivityHeatmap,
  UsageChannelBreakdown,
  UsageModelDistribution,
  UsageTrendChart,
} from '../UsageStatisticsCharts';

export function UsageStatisticsSection() {
  const [range, setRange] = useState<UsageRange>('30d');
  const [now] = useState(() => Date.now());
  const rangeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const account = useAccountStore((state) => state.status);
  const refreshQuota = useAccountStore((state) => state.refreshQuota);
  const detailQueryInput = useMemo(() => buildUsageStatsQuery(range, now), [now, range]);
  const activityQueryInput = useMemo(() => buildActivityQuery(now), [now]);
  const allTimeQuery = useUsageStatsQuery({ groupBy: 'month' });
  const activityQuery = useUsageStatsQuery(activityQueryInput);
  const detailQuery = useUsageStatsQuery(detailQueryInput);
  const allTime = allTimeQuery.data;
  const detail = detailQuery.data;
  const refreshing = allTimeQuery.isFetching || activityQuery.isFetching || detailQuery.isFetching;
  const error = [allTimeQuery.error, activityQuery.error, detailQuery.error].find(
    (value): value is Error => value instanceof Error,
  );
  const selectedRangeLabel = USAGE_RANGE_OPTIONS.find((option) => option.id === range)?.label ?? '';

  useEffect(() => {
    if (account.loggedIn) void refreshQuota().catch(() => {});
  }, [account.loggedIn, refreshQuota]);

  const refresh = async () => {
    await Promise.all([
      allTimeQuery.refetch(),
      activityQuery.refetch(),
      detailQuery.refetch(),
      account.loggedIn ? refreshQuota().catch(() => null) : Promise.resolve(null),
    ]);
  };

  const accountBalance =
    account.loggedIn && account.quota
      ? { value: formatPoints(account.quota.value), unit: '积分' as const }
      : { value: '—', unit: undefined };

  // 汇总卡：数据未到达时显示「—」而不是误导性的 0；成功率在无任何尝试时同样未知。
  const allTimeLoaded = allTime !== undefined;

  const focusRangeOption = (index: number) => {
    const next = (index + USAGE_RANGE_OPTIONS.length) % USAGE_RANGE_OPTIONS.length;
    rangeRefs.current[next]?.focus();
  };

  // WAI-ARIA radio group：仅选中项可 Tab，方向键/Home/End 漫游并切换。
  const handleRangeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const move = (target: number) => {
      event.preventDefault();
      const next = (target + USAGE_RANGE_OPTIONS.length) % USAGE_RANGE_OPTIONS.length;
      focusRangeOption(next);
      setRange(USAGE_RANGE_OPTIONS[next].id);
    };
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(USAGE_RANGE_OPTIONS.length - 1);
  };

  return (
    <SectionShell
      title="使用统计"
      description="汇总各生成渠道的用量与稳定性；积分消耗只采用账号渠道的实际记录。"
      className="mf-usage-section"
      action={
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={refreshing}
          title="刷新使用统计"
          aria-label="刷新使用统计"
          data-testid="settings-usage-refresh"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      }
    >
      {error ? (
        <div className="mf-usage-error" role="alert" data-testid="settings-usage-error">
          {error.message || '使用统计加载失败'}
        </div>
      ) : null}

      <section
        className="mf-usage-summary"
        aria-label="累计使用摘要"
        data-testid="settings-usage-summary"
      >
        <UsageSummaryMetric
          label="累计生成"
          value={allTimeLoaded ? formatUsageCount(allTime.totalCount) : '—'}
          unit={allTimeLoaded ? '次' : undefined}
          detail={
            allTimeLoaded ? `${formatUsageCount(allTime.attemptCount)} 次尝试` : '统计加载中'
          }
          pending={!allTimeLoaded}
        />
        <UsageSummaryMetric
          label="生成成功率"
          value={
            allTimeLoaded && allTime.attemptCount > 0
              ? formatUsagePercent(successRate(allTime.totalCount, allTime.attemptCount))
              : '—'
          }
          detail={allTimeLoaded ? `${formatUsageCount(allTime.failedCount)} 次失败` : '统计加载中'}
          pending={!allTimeLoaded}
        />
        <UsageSummaryMetric
          label="活跃天数"
          value={allTimeLoaded ? formatUsageCount(allTime.activeDays) : '—'}
          unit={allTimeLoaded ? '天' : undefined}
          detail="至少成功生成一次"
          pending={!allTimeLoaded}
        />
        <UsageSummaryMetric
          label="账号积分消耗"
          value={allTimeLoaded ? formatUsagePoints(allTime.accountPoints) : '—'}
          unit={allTimeLoaded ? '积分' : undefined}
          detail="不含豆包与自建 Provider"
          emphasized
          pending={!allTimeLoaded}
          testId="settings-usage-account-points"
        />
        <UsageSummaryMetric
          label="当前积分"
          value={accountBalance.value}
          unit={accountBalance.unit}
          detail={account.loggedIn ? '账号余额' : '账号未登录'}
        />
      </section>

      <UsageActivityHeatmap
        buckets={activityQuery.data?.buckets ?? []}
        now={now}
        loading={activityQuery.isFetching}
      />

      <div className="mf-usage-range-row">
        <h2>时间范围</h2>
        <div className="mf-usage-segmented" role="radiogroup" aria-label="统计时间范围">
          {USAGE_RANGE_OPTIONS.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={range === option.id}
              tabIndex={range === option.id ? 0 : -1}
              ref={(element) => {
                rangeRefs.current[index] = element;
              }}
              onKeyDown={(event) => handleRangeKeyDown(event, index)}
              onClick={() => setRange(option.id)}
              data-testid={`settings-usage-range-${option.id}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <UsageTrendChart
        buckets={detail?.buckets ?? []}
        channels={detail?.byChannel ?? []}
        rangeLabel={selectedRangeLabel}
        loading={detailQuery.isFetching}
      />

      <UsageModelDistribution models={detail?.byModel ?? []} loading={detailQuery.isFetching} />

      <UsageChannelBreakdown channels={detail?.byChannel ?? []} loading={detailQuery.isFetching} />

      <p className="mf-usage-accounting-note" data-testid="settings-usage-accounting-note">
        积分消耗仅统计 Musefold 账号渠道的成功生成。豆包体验与自建 Provider
        只展示用量和成功率，不进行积分换算。
      </p>
    </SectionShell>
  );
}

function useUsageStatsQuery(query: HistoryStatsQuery) {
  return useQuery({
    queryKey: musefoldQueryKeys.history.stats(query),
    queryFn: () => desktopGateway.historyStats(query),
    staleTime: 0,
  });
}

function UsageSummaryMetric({
  label,
  value,
  detail,
  unit,
  emphasized = false,
  pending = false,
  testId,
}: {
  label: string;
  value: string;
  detail: string;
  unit?: string;
  emphasized?: boolean;
  pending?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="mf-usage-summary__metric"
      data-emphasized={emphasized || undefined}
      data-pending={pending || undefined}
    >
      <strong data-testid={testId}>
        {value}
        {unit ? (
          <>
            {' '}
            <span className="mf-usage-summary__unit">{unit}</span>
          </>
        ) : null}
      </strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}
