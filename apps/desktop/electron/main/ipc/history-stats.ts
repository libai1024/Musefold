import { ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type {
  HistoryStats,
  HistoryStatsGroupBy,
  HistoryStatsQuery,
} from '@musefold/desktop-contracts/models';
import { getDb } from '@musefold/core/db/index';

interface StatsWhere {
  where: string;
  values: unknown[];
}

function normalizeStatsGroupBy(groupBy?: string): HistoryStatsGroupBy {
  return groupBy === 'week' || groupBy === 'month' || groupBy === 'day' ? groupBy : 'day';
}

function historyStatsBucketExpression(groupBy: HistoryStatsGroupBy): string {
  const ts = "datetime(h.created_at / 1000, 'unixepoch', 'localtime')";
  if (groupBy === 'month') return `strftime('%Y-%m', ${ts})`;
  if (groupBy === 'week') return `strftime('%Y-W%W', ${ts})`;
  return `strftime('%Y-%m-%d', ${ts})`;
}

function historyStatsChannelKindExpression(): string {
  const snapshot = `CASE
    WHEN json_valid(h.params) THEN json_extract(h.params, '$.usageChannel')
    ELSE NULL
  END`;
  return `CASE
    WHEN ${snapshot} IN ('account', 'doubao', 'provider') THEN ${snapshot}
    WHEN p.managed_by = 'account' THEN 'account'
    WHEN p.type = 'doubao-web' THEN 'doubao'
    ELSE 'provider'
  END`;
}

function historyStatsUsageCte(bucketExpr: string, where: string): string {
  const channelKind = historyStatsChannelKindExpression();
  const snapshotName = `CASE
    WHEN json_valid(h.params) THEN json_extract(h.params, '$.providerNameSnapshot')
    ELSE NULL
  END`;
  return `WITH usage AS (
    SELECT h.*,
           ${bucketExpr} AS bucketKey,
           strftime('%Y-%m-%d', datetime(h.created_at / 1000, 'unixepoch', 'localtime')) AS activeDay,
           ${channelKind} AS channelKind,
           CASE ${channelKind}
             WHEN 'account' THEN 'account'
             WHEN 'doubao' THEN 'doubao'
             ELSE 'provider:' || h.provider_id
           END AS channelId,
           CASE ${channelKind}
             WHEN 'account' THEN 'Musefold 账号'
             WHEN 'doubao' THEN '豆包体验'
             ELSE COALESCE(${snapshotName}, p.name, h.provider_id)
           END AS channelName
    FROM history h
    LEFT JOIN providers p ON p.id = h.provider_id
    ${where}
  )`;
}

export function buildHistoryStatsWhere(q: Partial<HistoryStatsQuery> = {}): StatsWhere {
  const where: string[] = [];
  const values: unknown[] = [];

  if (q.providerId) {
    where.push('h.provider_id = ?');
    values.push(q.providerId);
  }
  if (q.from != null) {
    where.push('h.created_at >= ?');
    values.push(q.from);
  }
  if (q.to != null) {
    where.push('h.created_at <= ?');
    values.push(q.to);
  }

  return { where: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', values };
}

export function buildHistoryStatsSql(q: Partial<HistoryStatsQuery> = {}) {
  const groupBy = normalizeStatsGroupBy(q.groupBy);
  const bucketExpr = historyStatsBucketExpression(groupBy);
  const { where, values } = buildHistoryStatsWhere(q);
  const usageCte = historyStatsUsageCte(bucketExpr, where);
  return {
    totalSql: `
      ${usageCte}
      SELECT COUNT(*) AS attemptCount,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS totalCount,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledCount,
             COUNT(DISTINCT CASE WHEN status = 'success' THEN activeDay END) AS activeDays,
             SUM(CASE
               WHEN status = 'success' AND channelKind = 'account' THEN COALESCE(cost, 0)
               ELSE 0
             END) AS accountPoints,
             SUM(CASE WHEN status = 'success' AND channelKind = 'account' THEN 1 ELSE 0 END) AS accountSuccessCount
      FROM usage
    `,
    bucketsSql: `
      ${usageCte}
      SELECT bucketKey AS key,
             'point' AS unit,
             SUM(CASE
               WHEN status = 'success' AND channelKind = 'account' THEN COALESCE(cost, 0)
               ELSE 0
             END) AS cost,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS count,
             COUNT(*) AS attemptCount,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledCount
      FROM usage
      GROUP BY bucketKey
      ORDER BY bucketKey ASC
    `,
    channelBucketsSql: `
      ${usageCte}
      SELECT bucketKey AS key,
             channelId,
             channelKind AS kind,
             MAX(channelName) AS name,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS count
      FROM usage
      GROUP BY bucketKey, channelId, channelKind
      HAVING count > 0
      ORDER BY bucketKey ASC, count DESC, channelId ASC
    `,
    byProviderSql: `
      ${usageCte}
      SELECT provider_id AS providerId,
             MAX(channelName) AS name,
             'point' AS unit,
             SUM(CASE WHEN channelKind = 'account' THEN COALESCE(cost, 0) ELSE 0 END) AS cost,
             COUNT(*) AS count
      FROM usage
      WHERE status = 'success'
      GROUP BY provider_id
      ORDER BY cost DESC, count DESC, provider_id ASC
    `,
    byChannelSql: `
      ${usageCte}
      SELECT channelId,
             channelKind AS kind,
             MAX(channelName) AS name,
             CASE WHEN channelKind = 'provider' THEN provider_id ELSE NULL END AS providerId,
             COUNT(*) AS attemptCount,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCount,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledCount,
             CASE WHEN channelKind = 'account' THEN SUM(CASE
               WHEN status = 'success' THEN COALESCE(cost, 0)
               ELSE 0
             END) ELSE NULL END AS accountPoints
      FROM usage
      GROUP BY channelId, channelKind, providerId
      ORDER BY successCount DESC, attemptCount DESC, channelId ASC
    `,
    byModelSql: `
      ${usageCte}
      SELECT COALESCE(NULLIF(model, ''), '未标注模型') AS model,
             COUNT(*) AS count
      FROM usage
      WHERE status = 'success'
      GROUP BY model
      ORDER BY count DESC, model ASC
    `,
    values,
    groupBy,
  };
}

export function registerHistoryStatsHandler(): void {
  ipcMain.handle(IPC.HISTORY_STATS, (_e, q: HistoryStatsQuery): HistoryStats => {
    const db = getDb();
    const sql = buildHistoryStatsSql(q ?? {});
    const totalRow = db.prepare(sql.totalSql).get(...sql.values) as Record<string, unknown> | undefined;
    const totalCount = Number(totalRow?.totalCount ?? 0);
    const attemptCount = Number(totalRow?.attemptCount ?? 0);
    const failedCount = Number(totalRow?.failedCount ?? 0);
    const cancelledCount = Number(totalRow?.cancelledCount ?? 0);
    const activeDays = Number(totalRow?.activeDays ?? 0);
    const accountPoints = Number(totalRow?.accountPoints ?? 0);
    const accountSuccessCount = Number(totalRow?.accountSuccessCount ?? 0);
    const accountAverage = accountSuccessCount > 0 ? accountPoints / accountSuccessCount : 0;
    const totals = accountSuccessCount > 0 ? [{
      unit: 'point' as const,
      cost: accountPoints,
      count: accountSuccessCount,
      avgCost: accountAverage,
    }] : [];
    const channelsByBucket = new Map<string, HistoryStats['buckets'][number]['channels']>();
    for (const row of db.prepare(sql.channelBucketsSql).all(...sql.values)) {
      const r = row as Record<string, unknown>;
      const key = String(r.key ?? '');
      const channels = channelsByBucket.get(key) ?? [];
      channels.push({
        channelId: String(r.channelId ?? ''),
        kind: String(r.kind ?? 'provider') as 'account' | 'doubao' | 'provider',
        name: String(r.name ?? r.channelId ?? ''),
        count: Number(r.count ?? 0),
      });
      channelsByBucket.set(key, channels);
    }
    const buckets = db.prepare(sql.bucketsSql).all(...sql.values).map((row) => {
      const r = row as Record<string, unknown>;
      const key = String(r.key ?? '');
      return {
        key,
        cost: Number(r.cost ?? 0),
        count: Number(r.count ?? 0),
        attemptCount: Number(r.attemptCount ?? 0),
        failedCount: Number(r.failedCount ?? 0),
        cancelledCount: Number(r.cancelledCount ?? 0),
        channels: channelsByBucket.get(key) ?? [],
        unit: 'point' as const,
      };
    });
    const byProvider = db.prepare(sql.byProviderSql).all(...sql.values).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        providerId: String(r.providerId ?? ''),
        name: String(r.name ?? r.providerId ?? ''),
        cost: Number(r.cost ?? 0),
        count: Number(r.count ?? 0),
        unit: 'point' as const,
      };
    });
    const byChannel = db.prepare(sql.byChannelSql).all(...sql.values).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        channelId: String(r.channelId ?? ''),
        kind: String(r.kind ?? 'provider') as 'account' | 'doubao' | 'provider',
        name: String(r.name ?? r.channelId ?? ''),
        providerId: r.providerId == null ? null : String(r.providerId),
        attemptCount: Number(r.attemptCount ?? 0),
        successCount: Number(r.successCount ?? 0),
        failedCount: Number(r.failedCount ?? 0),
        cancelledCount: Number(r.cancelledCount ?? 0),
        accountPoints: r.accountPoints == null ? null : Number(r.accountPoints),
      };
    });
    const byModel = db.prepare(sql.byModelSql).all(...sql.values).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        model: String(r.model ?? '未标注模型'),
        count: Number(r.count ?? 0),
      };
    });

    return {
      totals,
      totalCost: accountPoints,
      avgCost: accountAverage,
      totalCount,
      attemptCount,
      failedCount,
      cancelledCount,
      activeDays,
      accountPoints,
      buckets,
      byProvider,
      byChannel,
      byModel,
    };
  });
}
