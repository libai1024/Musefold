import { useEffect, useMemo, useState } from 'react';
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
    account.loggedIn && account.quota ? `${formatPoints(account.quota.value)} 积分` : '—';

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
          value={`${formatUsageCount(allTime?.totalCount ?? 0)} 次`}
          detail={`${formatUsageCount(allTime?.attemptCount ?? 0)} 次尝试`}
        />
        <UsageSummaryMetric
          label="生成成功率"
          value={formatUsagePercent(
            successRate(allTime?.totalCount ?? 0, allTime?.attemptCount ?? 0),
          )}
          detail={`${formatUsageCount(allTime?.failedCount ?? 0)} 次失败`}
        />
        <UsageSummaryMetric
          label="活跃天数"
          value={`${formatUsageCount(allTime?.activeDays ?? 0)} 天`}
          detail="至少成功生成一次"
        />
        <UsageSummaryMetric
          label="账号积分消耗"
          value={`${formatUsagePoints(allTime?.accountPoints ?? 0)} 积分`}
          detail="不含豆包与自建 Provider"
          emphasized
          testId="settings-usage-account-points"
        />
        <UsageSummaryMetric
          label="当前积分"
          value={accountBalance}
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
          {USAGE_RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={range === option.id}
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
  emphasized = false,
  testId,
}: {
  label: string;
  value: string;
  detail: string;
  emphasized?: boolean;
  testId?: string;
}) {
  return (
    <div className="mf-usage-summary__metric" data-emphasized={emphasized || undefined}>
      <strong data-testid={testId}>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}
