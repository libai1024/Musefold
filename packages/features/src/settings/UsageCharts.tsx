'use client';

import type {
  UsageDayBucket,
  UsageModelBucket,
  UsageProviderBucket,
  UsageSummary,
} from '@musefold/contracts';
import { skipMotion } from '@musefold/ui/lib/motion';
import { type ReactNode, useEffect, useState } from 'react';
import { formatUsageCost, formatUsageCount, formatUsageRate } from './usage-format';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

const RANGE_LABEL = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
} as const;

const TREND_WIDTH = 320;
const TREND_HEIGHT = 112;
const TREND_PAD = { top: 8, right: 4, bottom: 20, left: 4 };

function shortDate(date: string): string {
  return date.slice(5);
}

function ChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join('|')}>
            {row.map((cell, index) => (
              <td key={`${index}:${cell}`} className="tabular-nums">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartPanel({
  title,
  description,
  testId,
  ariaLabel,
  visual,
  table,
}: {
  title: string;
  description: string;
  testId: string;
  ariaLabel: string;
  visual: ReactNode;
  table: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/60 px-3 py-3" data-testid={testId}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <div role="img" aria-label={ariaLabel} className="mt-3">
        {visual}
      </div>
      {table}
    </section>
  );
}

function TrendSvg({
  days,
  drawn,
  animate,
  color,
  readValue,
}: {
  days: readonly UsageDayBucket[];
  drawn: boolean;
  animate: boolean;
  color: string;
  readValue(day: UsageDayBucket): number | null;
}) {
  const innerW = TREND_WIDTH - TREND_PAD.left - TREND_PAD.right;
  const innerH = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom;
  const numeric = days.map((day) => readValue(day));
  const max = Math.max(1, ...numeric.filter((value): value is number => value != null));
  const gap = days.length > 40 ? 1 : days.length > 14 ? 1.5 : 2.5;
  const barW = Math.max(1, (innerW - gap * Math.max(0, days.length - 1)) / days.length);
  const baseline = TREND_PAD.top + innerH;
  const points = days.map((day, index) => {
    const value = numeric[index];
    const x = TREND_PAD.left + index * (barW + gap) + barW / 2;
    const y = value == null ? null : TREND_PAD.top + innerH - (value / max) * innerH;
    return { day, x, y, value };
  });
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter(
    (index, at, all) => all.indexOf(index) === at && days[index],
  );
  const transition = animate
    ? 'transition-[y,height,stroke-dashoffset] duration-(--dur-slow) ease-out'
    : undefined;

  return (
    <svg viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} className="h-28 w-full" aria-hidden="true">
      <line
        x1={TREND_PAD.left}
        x2={TREND_WIDTH - TREND_PAD.right}
        y1={baseline}
        y2={baseline}
        stroke="var(--border)"
      />
      {points.map((point) => {
        if (point.value == null) return null;
        const barH = drawn ? (point.value / max) * innerH : 0;
        return (
          <rect
            key={point.day.date}
            x={point.x - barW / 2}
            y={baseline - barH}
            width={barW}
            height={barH}
            rx={Math.min(1.5, barW / 2)}
            fill={color}
            className={transition}
          />
        );
      })}
      {ticks.map((index) => {
        const point = points[index];
        const day = days[index];
        if (!point || !day) return null;
        return (
          <text
            key={day.date}
            x={point.x}
            y={TREND_HEIGHT - 4}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px] tabular-nums"
          >
            {shortDate(day.date)}
          </text>
        );
      })}
    </svg>
  );
}

function SuccessSvg({
  days,
  drawn,
  animate,
}: {
  days: readonly UsageDayBucket[];
  drawn: boolean;
  animate: boolean;
}) {
  const innerW = TREND_WIDTH - TREND_PAD.left - TREND_PAD.right;
  const innerH = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom;
  const baseline = TREND_PAD.top + innerH;
  const step = days.length > 1 ? innerW / (days.length - 1) : 0;
  const points = days.map((day, index) => ({
    day,
    x: TREND_PAD.left + index * step,
    y: day.successRate == null ? null : TREND_PAD.top + innerH - day.successRate * innerH,
  }));
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (point.y == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x: point.x, y: drawn ? point.y : baseline });
  }
  if (current.length > 0) segments.push(current);
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter(
    (index, at, all) => all.indexOf(index) === at && days[index],
  );
  const transition = animate
    ? 'transition-[stroke-dashoffset] duration-(--dur-slow) ease-out'
    : undefined;

  return (
    <svg viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} className="h-28 w-full" aria-hidden="true">
      {[0, 0.5, 1].map((ratio) => {
        const y = TREND_PAD.top + innerH * (1 - ratio);
        return (
          <line
            key={ratio}
            x1={TREND_PAD.left}
            x2={TREND_WIDTH - TREND_PAD.right}
            y1={y}
            y2={y}
            stroke="var(--border)"
          />
        );
      })}
      {segments.map((segment, index) =>
        segment.length === 1 ? (
          <circle
            key={`dot-${index}`}
            cx={segment[0]?.x}
            cy={segment[0]?.y}
            r={2.25}
            fill="var(--chart-1)"
          />
        ) : (
          <polyline
            key={`line-${index}`}
            points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={drawn ? 0 : 1}
            className={transition}
          />
        ),
      )}
      {ticks.map((index) => {
        const point = points[index];
        const day = days[index];
        if (!point || !day) return null;
        return (
          <text
            key={day.date}
            x={point.x}
            y={TREND_HEIGHT - 4}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px] tabular-nums"
          >
            {shortDate(day.date)}
          </text>
        );
      })}
    </svg>
  );
}

function DistributionList({
  items,
  colorOffset,
  drawn,
  animate,
}: {
  items: readonly { label: string; count: number }[];
  colorOffset: number;
  drawn: boolean;
  animate: boolean;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, index) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-foreground">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatUsageCount(item.count)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={
                animate
                  ? 'h-full rounded-full transition-[width] duration-(--dur-slow) ease-out'
                  : 'h-full rounded-full'
              }
              style={{
                width: drawn ? `${(item.count / max) * 100}%` : '0%',
                background: CHART_COLORS[(index + colorOffset) % CHART_COLORS.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 使用统计图表区(07-05 P3):最小 SVG + CSS,不引入 recharts。
 * skipMotion 命中直接终态;未命中入场 ≤ --dur-slow。切范围不重挂载,避免重播入场。
 */
export function UsageCharts({ summary }: { summary: UsageSummary }) {
  const reduce = skipMotion();
  const [drawn, setDrawn] = useState(reduce);
  useEffect(() => {
    if (drawn) return;
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [drawn]);

  const empty = summary.generationCount === 0;
  const rangeLabel = RANGE_LABEL[summary.range];
  const animate = !reduce;

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="settings-usage-charts"
      data-motion={reduce ? 'static' : 'enter'}
    >
      {empty ? (
        <p className="text-muted-foreground text-sm">该时段没有生成记录</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ChartPanel
              title="用量趋势"
              description={`${rangeLabel}按日生成次数`}
              testId="settings-usage-chart-trend"
              ariaLabel={`${rangeLabel}用量趋势,共 ${formatUsageCount(summary.generationCount)} 次生成`}
              visual={
                <TrendSvg
                  days={summary.byDay}
                  drawn={drawn}
                  animate={animate}
                  color="var(--chart-1)"
                  readValue={(day) => day.generationCount}
                />
              }
              table={
                <ChartTable
                  caption="用量趋势"
                  headers={['日期', '生成', '成功', '失败', '取消', '积分']}
                  rows={summary.byDay.map((day) => [
                    day.date,
                    formatUsageCount(day.generationCount),
                    formatUsageCount(day.succeededCount),
                    formatUsageCount(day.failedCount),
                    formatUsageCount(day.cancelledCount),
                    formatUsageCost(day.costPoints),
                  ])}
                />
              }
            />
          </div>
          <ChartPanel
            title="渠道分布"
            description="按生成次数"
            testId="settings-usage-chart-provider"
            ariaLabel={`渠道分布:${summary.byProvider.map((row) => `${row.label} ${formatUsageCount(row.generationCount)} 次`).join('、') || '无'}`}
            visual={
              <DistributionList
                items={summary.byProvider.map((row) => ({
                  label: row.label,
                  count: row.generationCount,
                }))}
                colorOffset={1}
                drawn={drawn}
                animate={animate}
              />
            }
            table={
              <ChartTable
                caption="渠道分布"
                headers={['渠道', '生成', '积分']}
                rows={summary.byProvider.map((row: UsageProviderBucket) => [
                  row.label,
                  formatUsageCount(row.generationCount),
                  formatUsageCost(row.costPoints),
                ])}
              />
            }
          />
          <ChartPanel
            title="模型分布"
            description="按生成次数"
            testId="settings-usage-chart-model"
            ariaLabel={`模型分布:${summary.byModel.map((row) => `${row.model} ${formatUsageCount(row.generationCount)} 次`).join('、') || '无'}`}
            visual={
              <DistributionList
                items={summary.byModel.map((row) => ({
                  label: row.model,
                  count: row.generationCount,
                }))}
                colorOffset={2}
                drawn={drawn}
                animate={animate}
              />
            }
            table={
              <ChartTable
                caption="模型分布"
                headers={['模型', '生成', '积分']}
                rows={summary.byModel.map((row: UsageModelBucket) => [
                  row.model,
                  formatUsageCount(row.generationCount),
                  formatUsageCost(row.costPoints),
                ])}
              />
            }
          />
          <div className="sm:col-span-2">
            <ChartPanel
              title="成功率趋势"
              description={`${rangeLabel}按日终态成功率,无终态日断线`}
              testId="settings-usage-chart-success"
              ariaLabel={`${rangeLabel}成功率趋势,整体 ${formatUsageRate(summary.successRate)}`}
              visual={<SuccessSvg days={summary.byDay} drawn={drawn} animate={animate} />}
              table={
                <ChartTable
                  caption="成功率趋势"
                  headers={['日期', '成功率']}
                  rows={summary.byDay.map((day) => [day.date, formatUsageRate(day.successRate)])}
                />
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
