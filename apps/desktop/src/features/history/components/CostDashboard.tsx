import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Info, Loader2, Settings2 } from '../../../components/ui/icons';
import type {
  HistoryStatsBucket,
  HistoryStatsGroupBy,
  HistoryStatsProvider,
  HistoryStatsQuery,
} from '@musefold/desktop-contracts/history-documents';
import { useAppStore } from '../../../stores/app';
import { useSettingsStore } from '../../settings/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { formatPoints } from '@musefold/domain';
import { formatCost } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { useHistoryStore } from '../store';
import { useAccountStore } from '../../account/store';

type CostRange = 'month' | 'last30' | 'all';

const RANGE_OPTIONS: { id: CostRange; label: string }[] = [
  { id: 'month', label: '本月' },
  { id: 'last30', label: '近 30 天' },
  { id: 'all', label: '全部' },
];

const GROUP_OPTIONS: { id: HistoryStatsGroupBy; label: string }[] = [
  { id: 'day', label: '按天' },
  { id: 'week', label: '按周' },
  { id: 'month', label: '按月' },
];

export function CostDashboard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stats = useHistoryStore((s) => s.stats);
  const loading = useHistoryStore((s) => s.statsLoading);
  const error = useHistoryStore((s) => s.statsError);
  const loadStats = useHistoryStore((s) => s.loadStats);
  const setView = useAppStore((s) => s.setView);
  const setSettingsSection = useSettingsStore((s) => s.setSection);
  const account = useAccountStore((s) => s.status);
  const refreshQuota = useAccountStore((s) => s.refreshQuota);

  const [range, setRange] = useState<CostRange>('month');
  const [groupBy, setGroupBy] = useState<HistoryStatsGroupBy>('day');

  const query = useMemo(() => buildStatsQuery(range, groupBy), [range, groupBy]);

  useEffect(() => {
    if (!open) return;
    void loadStats(query);
    if (account.loggedIn) void refreshQuota().catch(() => {});
  }, [account.loggedIn, loadStats, open, query, refreshQuota]);

  const totalCount = stats?.totalCount ?? 0;
  const totals = stats?.totals ?? (stats ? [{
    unit: 'point' as const,
    cost: stats.totalCost,
    count: stats.totalCount,
    avgCost: stats.avgCost,
  }] : []);
  const total = totals.find((item) => item.unit === 'point');
  const hasData = totalCount > 0;
  const unpriced = hasData && totals.every((total) => total.cost === 0);

  const configurePricing = () => {
    onOpenChange(false);
    setSettingsSection('providers');
    setView('settings');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto p-0">
        <div className="border-b border-border-subtle px-5 py-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inset text-primary">
                <BarChart3 className="h-4 w-4" />
              </span>
              成本看板
            </DialogTitle>
            <DialogDescription>
              仅统计生成成功的历史；账号消费按服务器计费单价记录，手动服务商沿用本地估算。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-5 pb-5" data-testid="history-cost-dashboard">
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <Segmented
              label="时间范围"
              options={RANGE_OPTIONS}
              value={range}
              onChange={(value) => setRange(value as CostRange)}
              testIdPrefix="history-cost-range"
            />
            <Segmented
              label="分组"
              options={GROUP_OPTIONS}
              value={groupBy}
              onChange={(value) => setGroupBy(value as HistoryStatsGroupBy)}
              testIdPrefix="history-cost-group"
            />
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-tertiary"
              onClick={() => void loadStats(query)}
              data-testid="history-cost-refresh"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
              刷新
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger" data-testid="history-cost-error">
              {error}
            </div>
          )}

          <div
            className={cn(
              'grid divide-y divide-border-subtle border-y border-border-subtle sm:divide-x sm:divide-y-0',
              account.loggedIn ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
            )}
          >
            {account.loggedIn && (
              <SummaryCard
                label="账号余额"
                value={account.quota ? `${formatPoints(account.quota.value)} 积分` : '—'}
                detail={account.estImagesRemaining != null ? `约可生成 ${account.estImagesRemaining.toLocaleString('zh-CN')} 张` : undefined}
                testId="history-cost-balance"
              />
            )}
            <SummaryCard
              label="累计花费"
              value={formatCost(total?.cost ?? 0)}
              testId="history-cost-total"
            />
            <SummaryCard label="生图次数" value={`${totalCount} 张`} testId="history-cost-count" />
            <SummaryCard
              label="平均单张"
              value={formatCost(total?.avgCost ?? 0)}
              testId="history-cost-average"
            />
          </div>

          {!loading && !hasData ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-inset/40 px-4 text-center" data-testid="history-cost-empty">
              <BarChart3 className="mb-3 h-7 w-7 text-quaternary" />
              <p className="text-[13px] font-medium text-primary">还没有可统计的成功记录</p>
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-tertiary">
                成功生成后，这里会按时间和 Provider 汇总本地估算成本。
              </p>
            </div>
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold text-primary">{groupLabel(groupBy)}分布</h3>
                  <span className="text-[10px] text-tertiary">{rangeLabel(range)}</span>
                </div>
                <BucketChart buckets={stats?.buckets ?? []} loading={loading} />
              </section>

              <section className="space-y-2">
                <h3 className="text-[12px] font-semibold text-primary">按 Provider</h3>
                <ProviderBreakdown providers={stats?.byProvider ?? []} loading={loading} />
              </section>
            </>
          )}

          {unpriced && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] leading-relaxed text-warning" data-testid="history-cost-unpriced">
              这些成功记录的成本为 0 或未配置单价；看板会按 0 聚合。
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border-subtle pt-3 text-[11.5px] leading-relaxed text-tertiary sm:flex-row sm:items-center" data-testid="history-cost-disclaimer">
            <Info className="h-3.5 w-3.5 shrink-0 text-info" />
            <span className="min-w-0 flex-1">
              所有成本均以积分统计；账号消费来自服务器计费，手动服务商来自本地单价估算。
            </span>
            <Button size="xs" variant="outline" onClick={configurePricing} data-testid="history-cost-configure">
              <Settings2 className="h-3 w-3" />
              配置单价
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId: string;
}) {
  return (
    <div className="bg-transparent px-3 py-3">
      <p className="text-[10.5px] text-tertiary">{label}</p>
      <p className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-primary" data-testid={testId}>
        {value}
      </p>
      {detail && <p className="mt-0.5 text-[10px] text-quaternary">{detail}</p>}
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10.5px] text-tertiary">{label}</span>
      <div className="flex rounded-lg border border-border-subtle bg-inset/65 p-0.5">
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              data-testid={`${testIdPrefix}-${option.id}`}
              data-active={active ? 'true' : 'false'}
              onClick={() => onChange(option.id)}
              className={cn(
                'no-drag rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                active ? 'bg-elevated text-primary shadow-sm' : 'text-tertiary hover:text-secondary',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BucketChart({ buckets, loading }: { buckets: HistoryStatsBucket[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border-subtle bg-inset/35 text-[12px] text-tertiary" data-testid="history-cost-chart-loading">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在统计…
      </div>
    );
  }
  if (buckets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border-default bg-inset/35 text-[12px] text-tertiary" data-testid="history-cost-chart-empty">
        当前范围没有成本分布
      </div>
    );
  }

  const maxCost = Math.max(...buckets.map((bucket) => bucket.cost), 0);
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-3 py-3" data-testid="history-cost-chart">
      <div className="flex h-36 items-end gap-1.5 overflow-x-auto pb-1">
        {buckets.map((bucket) => {
          const ratio = maxCost > 0 ? bucket.cost / maxCost : bucket.count / maxCount;
          const height = Math.max(8, Math.round(ratio * 100));
          return (
            <div key={bucket.key} className="flex min-w-[32px] flex-1 flex-col items-center gap-1">
              <div
                className={cn(
                  'w-full min-w-[20px] rounded-t-sm border border-primary/40 transition-colors',
                  'bg-primary/85 hover:bg-primary',
                )}
                style={{ height: `${height}%` }}
                title={`${bucket.key} · ${formatCost(bucket.cost)} · ${bucket.count} 张`}
                data-testid="history-cost-bucket"
                data-key={bucket.key}
                data-cost={bucket.cost}
                data-count={bucket.count}
              />
              <span className="max-w-[44px] truncate font-mono text-[9px] text-quaternary" title={bucket.key}>
                {shortBucketKey(bucket.key)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProviderBreakdown({ providers, loading }: { providers: HistoryStatsProvider[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border-subtle bg-inset/35 px-3 py-4 text-[12px] text-tertiary">
        正在读取 Provider 明细…
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-default bg-inset/35 px-3 py-4 text-[12px] text-tertiary" data-testid="history-cost-provider-empty">
        暂无 Provider 明细
      </div>
    );
  }

  const maxCost = Math.max(...providers.map((provider) => provider.cost), 0);
  const maxCount = Math.max(...providers.map((provider) => provider.count), 1);

  return (
    <div className="space-y-1.5">
      {providers.map((provider) => {
        const ratio = maxCost > 0 ? provider.cost / maxCost : provider.count / maxCount;
        return (
          <div
            key={provider.providerId}
            className="rounded-lg border border-border-subtle bg-elevated px-3 py-2"
            data-testid="history-cost-provider"
            data-provider-id={provider.providerId}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-primary">{provider.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-primary">{formatCost(provider.cost)}</span>
              <span className="font-mono text-[10px] tabular-nums text-tertiary">{provider.count} 张</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, Math.round(ratio * 100))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildStatsQuery(range: CostRange, groupBy: HistoryStatsGroupBy): HistoryStatsQuery {
  const bounds = rangeBounds(range);
  return { ...bounds, groupBy };
}

function rangeBounds(range: CostRange): Pick<HistoryStatsQuery, 'from' | 'to'> {
  const now = new Date();
  if (range === 'all') return {};
  if (range === 'last30') {
    return { from: now.getTime() - 30 * 24 * 60 * 60 * 1000, to: now.getTime() };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime() - 1;
  return { from: start.getTime(), to: Math.min(end, now.getTime()) };
}

function rangeLabel(range: CostRange): string {
  return RANGE_OPTIONS.find((option) => option.id === range)?.label ?? '本月';
}

function groupLabel(groupBy: HistoryStatsGroupBy): string {
  if (groupBy === 'month') return '按月';
  if (groupBy === 'week') return '按周';
  return '按天';
}

function shortBucketKey(key: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(5);
  if (/^\d{4}-W\d{2}$/.test(key)) return key.replace(/^\d{4}-/, '');
  return key;
}
