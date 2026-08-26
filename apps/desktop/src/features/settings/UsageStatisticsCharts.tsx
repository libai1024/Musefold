import { useMemo } from 'react';
import type {
  HistoryStatsBucket,
  HistoryStatsChannel,
  HistoryStatsModel,
} from '@musefold/desktop-contracts/history-documents';
import {
  buildUsageHeatmap,
  formatUsageCount,
  formatUsagePercent,
  formatUsagePoints,
  successRate,
} from './usage-statistics';

const CHART_COLORS = [
  'var(--mf-usage-chart-1)',
  'var(--mf-usage-chart-2)',
  'var(--mf-usage-chart-3)',
  'var(--mf-usage-chart-4)',
  'var(--mf-usage-chart-5)',
  'var(--mf-usage-chart-6)',
] as const;

export function UsageActivityHeatmap({
  buckets,
  now,
  loading,
}: {
  buckets: readonly HistoryStatsBucket[];
  now: number;
  loading: boolean;
}) {
  const cells = useMemo(() => buildUsageHeatmap(buckets, now), [buckets, now]);
  const monthLabels = useMemo(() => {
    const labels: string[] = [];
    const date = new Date(now);
    for (let offset = 11; offset >= 0; offset -= 1) {
      labels.push(
        new Date(date.getFullYear(), date.getMonth() - offset, 1).toLocaleDateString('zh-CN', {
          month: 'short',
        }),
      );
    }
    return labels;
  }, [now]);

  return (
    <section className="mf-usage-panel" data-testid="settings-usage-activity">
      <header className="mf-usage-panel__header">
        <div>
          <h2>生成活动</h2>
          <p>过去 53 周的全渠道成功生成次数</p>
        </div>
        <span className="mf-usage-panel__mode">每日</span>
      </header>
      <div className="mf-usage-heatmap-scroll" aria-busy={loading}>
        <div className="mf-usage-heatmap-months" aria-hidden="true">
          {monthLabels.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className="mf-usage-heatmap" role="img" aria-label="过去 53 周生成活动热力图">
          {cells.map((cell) => (
            <span
              key={cell.key}
              className="mf-usage-heatmap__cell"
              data-level={cell.level}
              title={`${cell.dateLabel}：${cell.count} 次成功生成`}
            />
          ))}
        </div>
      </div>
      <div className="mf-usage-heatmap-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} data-level={level} />
        ))}
        <span>多</span>
      </div>
    </section>
  );
}

export function UsageTrendChart({
  buckets,
  channels,
  rangeLabel,
  loading,
}: {
  buckets: readonly HistoryStatsBucket[];
  channels: readonly HistoryStatsChannel[];
  rangeLabel: string;
  loading: boolean;
}) {
  const visibleChannels = channels.filter((channel) => channel.successCount > 0).slice(0, 6);
  const maxValue = Math.max(
    1,
    ...buckets.flatMap((bucket) => bucket.channels.map((channel) => channel.count)),
  );
  const labelIndexes = tickIndexes(buckets.length, 6);
  const geometry = { left: 24, right: 16, top: 14, bottom: 34, width: 760, height: 220 };

  return (
    <section className="mf-usage-panel" data-testid="settings-usage-trend">
      <header className="mf-usage-panel__header mf-usage-panel__header--stacked">
        <div>
          <h2>生成趋势</h2>
          <p>{rangeLabel}，按渠道统计成功生成次数</p>
        </div>
        <div className="mf-usage-chart-legend" aria-label="渠道图例">
          {visibleChannels.map((channel, index) => (
            <span key={channel.channelId}>
              <i style={{ background: CHART_COLORS[index] }} />
              {channel.name}
            </span>
          ))}
        </div>
      </header>
      {buckets.length === 0 && !loading ? (
        <UsageEmpty label="该时间范围内暂无成功生成" />
      ) : (
        <div className="mf-usage-trend-chart" aria-busy={loading}>
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            role="img"
            aria-label="各生成渠道趋势折线图"
          >
            {[0, 1, 2, 3].map((line) => {
              const y =
                geometry.top + ((geometry.height - geometry.top - geometry.bottom) / 3) * line;
              return (
                <line
                  key={line}
                  x1={geometry.left}
                  y1={y}
                  x2={geometry.width - geometry.right}
                  y2={y}
                  className="mf-usage-chart-grid"
                />
              );
            })}
            {visibleChannels.map((channel, index) => {
              const points = buckets.map((bucket, bucketIndex) => {
                const value =
                  bucket.channels.find((item) => item.channelId === channel.channelId)?.count ?? 0;
                return chartPoint(bucketIndex, buckets.length, value, maxValue, geometry);
              });
              return (
                <polyline
                  key={channel.channelId}
                  points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke={CHART_COLORS[index]}
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
            {labelIndexes.map((index) => {
              const point = chartPoint(index, buckets.length, 0, maxValue, geometry);
              return (
                <text
                  key={buckets[index]?.key}
                  x={point.x}
                  y={geometry.height - 10}
                  textAnchor="middle"
                  className="mf-usage-chart-label"
                >
                  {shortBucketLabel(buckets[index]?.key ?? '')}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

export function UsageModelDistribution({
  models,
  loading,
}: {
  models: readonly HistoryStatsModel[];
  loading: boolean;
}) {
  const visible = compactModels(models);
  const total = visible.reduce((sum, model) => sum + model.count, 0);
  let offset = 0;

  return (
    <section className="mf-usage-panel" data-testid="settings-usage-models">
      <header className="mf-usage-panel__header">
        <div>
          <h2>模型用量</h2>
          <p>全渠道成功生成的模型分布</p>
        </div>
      </header>
      {total === 0 && !loading ? (
        <UsageEmpty label="暂无模型用量数据" />
      ) : (
        <div className="mf-usage-distribution" aria-busy={loading}>
          <div className="mf-usage-donut" role="img" aria-label={`共 ${total} 次成功生成`}>
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle cx="66" cy="66" r="50" className="mf-usage-donut__track" />
              {visible.map((model, index) => {
                const fraction = total > 0 ? model.count / total : 0;
                const segment = (
                  <circle
                    key={model.model}
                    cx="66"
                    cy="66"
                    r="50"
                    className="mf-usage-donut__segment"
                    stroke={CHART_COLORS[index]}
                    strokeDasharray={`${fraction * 314.159} ${314.159 - fraction * 314.159}`}
                    strokeDashoffset={-offset * 314.159}
                  />
                );
                offset += fraction;
                return segment;
              })}
            </svg>
            <div>
              <strong>{formatUsageCount(total)}</strong>
              <span>次生成</span>
            </div>
          </div>
          <div className="mf-usage-distribution-list">
            {visible.map((model, index) => (
              <div key={model.model} className="mf-usage-distribution-row">
                <i style={{ background: CHART_COLORS[index] }} />
                <span className="mf-usage-distribution-row__name">{model.model}</span>
                <span>{formatUsageCount(model.count)} 次</span>
                <strong>{formatUsagePercent(total > 0 ? (model.count / total) * 100 : 0)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function UsageChannelBreakdown({
  channels,
  loading,
}: {
  channels: readonly HistoryStatsChannel[];
  loading: boolean;
}) {
  return (
    <section className="mf-usage-panel" data-testid="settings-usage-channels">
      <header className="mf-usage-panel__header">
        <div>
          <h2>渠道统计</h2>
          <p>账号、豆包体验与各中转 Provider 独立计算</p>
        </div>
      </header>
      {channels.length === 0 && !loading ? (
        <UsageEmpty label="暂无渠道用量数据" />
      ) : (
        <div className="mf-usage-channel-list" aria-busy={loading}>
          {channels.map((channel, index) => (
            <div
              className="mf-usage-channel-row"
              key={channel.channelId}
              data-testid="settings-usage-channel"
              data-channel-id={channel.channelId}
            >
              <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
              <div className="mf-usage-channel-row__identity">
                <strong>{channel.name}</strong>
                <span>{channelKindLabel(channel.kind)}</span>
              </div>
              <UsageChannelMetric
                label="成功"
                value={`${formatUsageCount(channel.successCount)} 次`}
              />
              <UsageChannelMetric
                label="成功率"
                value={formatUsagePercent(successRate(channel.successCount, channel.attemptCount))}
              />
              <UsageChannelMetric
                label="失败 / 取消"
                value={`${formatUsageCount(channel.failedCount)} / ${formatUsageCount(channel.cancelledCount)}`}
              />
              <UsageChannelMetric
                label="积分消耗"
                value={
                  channel.accountPoints == null
                    ? '不计积分'
                    : `${formatUsagePoints(channel.accountPoints)} 积分`
                }
                emphasized={channel.kind === 'account'}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UsageChannelMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="mf-usage-channel-metric" data-emphasized={emphasized || undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UsageEmpty({ label }: { label: string }) {
  return <div className="mf-usage-empty">{label}</div>;
}

function channelKindLabel(kind: HistoryStatsChannel['kind']): string {
  if (kind === 'account') return '账号渠道';
  if (kind === 'doubao') return '体验渠道';
  return '自建 Provider';
}

function compactModels(models: readonly HistoryStatsModel[]): HistoryStatsModel[] {
  if (models.length <= 6) return [...models];
  return [
    ...models.slice(0, 5),
    {
      model: '其他',
      count: models.slice(5).reduce((sum, model) => sum + model.count, 0),
    },
  ];
}

function chartPoint(
  index: number,
  count: number,
  value: number,
  maxValue: number,
  geometry: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  },
): { x: number; y: number } {
  const chartWidth = geometry.width - geometry.left - geometry.right;
  const chartHeight = geometry.height - geometry.top - geometry.bottom;
  return {
    x:
      count <= 1
        ? geometry.left + chartWidth / 2
        : geometry.left + (index / (count - 1)) * chartWidth,
    y: geometry.top + chartHeight - (value / maxValue) * chartHeight,
  };
}

function tickIndexes(count: number, desired: number): number[] {
  if (count <= 0) return [];
  if (count <= desired) return Array.from({ length: count }, (_, index) => index);
  return Array.from(
    new Set(
      Array.from({ length: desired }, (_, index) =>
        Math.round((index / (desired - 1)) * (count - 1)),
      ),
    ),
  );
}

function shortBucketLabel(key: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key))
    return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
  if (/^\d{4}-\d{2}$/.test(key)) return `${key.slice(0, 4)}/${Number(key.slice(5, 7))}`;
  return key.replace(/^\d{4}-/, '');
}
