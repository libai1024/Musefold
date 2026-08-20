import { describe, expect, it } from 'vitest';
import {
  buildHistoryClearSql,
  buildHistoryClearSelectSql,
  buildHistoryListSql,
  buildHistoryStatsSql,
  buildRelatedHistorySql,
} from '../history';

describe('buildHistoryListSql', () => {
  it('no filters → bare select + order', () => {
    const { sql, values } = buildHistoryListSql({});
    expect(sql).toBe('SELECT * FROM history ORDER BY created_at DESC');
    expect(values).toEqual([]);
  });

  it('AND-combines status + provider + from/to + limit', () => {
    const { sql, values } = buildHistoryListSql({
      status: 'failed',
      providerId: 'prov-1',
      from: 100,
      to: 200,
      limit: 50,
      offset: 10,
    });
    expect(sql).toContain(
      'WHERE status = ? AND provider_id = ? AND created_at >= ? AND created_at <= ?',
    );
    expect(sql).toContain('ORDER BY created_at DESC LIMIT ? OFFSET ?');
    expect(values).toEqual(['failed', 'prov-1', 100, 200, 50, 10]);
  });

  it('single status still works (compat)', () => {
    const { sql, values } = buildHistoryListSql({ status: 'cancelled', limit: 20 });
    expect(sql).toBe(
      'SELECT * FROM history WHERE status = ? ORDER BY created_at DESC LIMIT ?',
    );
    expect(values).toEqual(['cancelled', 20]);
  });
});

describe('buildRelatedHistorySql', () => {
  it('matches direct prompt sources and reference relations', () => {
    const built = buildRelatedHistorySql({ promptId: 'prompt-1', limit: 20, offset: 5 });
    expect(built.listSql).toContain('h.prompt_id = ? OR EXISTS');
    expect(built.listSql).toContain('r.history_id = h.id AND r.prompt_id = ?');
    expect(built.listSql).toContain('ORDER BY h.created_at DESC LIMIT ? OFFSET ?');
    expect(built.listSql).toContain("p.source_url = 'history://' || h.id");
    expect(built.whereValues).toEqual(['prompt-1', 'prompt-1', 'prompt-1']);
    expect(built.listValues).toEqual(['prompt-1', 'prompt-1', 'prompt-1', 20, 5]);
    expect(built.countSql).toContain('COUNT(*) AS total');
  });

  it('adds status filtering and clamps pagination', () => {
    const built = buildRelatedHistorySql({
      promptId: 'prompt-2',
      status: 'failed',
      limit: 500,
      offset: -4,
    });
    expect(built.listSql).toContain('AND h.status = ?');
    expect(built.whereValues).toEqual(['prompt-2', 'prompt-2', 'prompt-2', 'failed']);
    expect(built.listValues).toEqual(['prompt-2', 'prompt-2', 'prompt-2', 'failed', 200, 0]);
  });
});

describe('buildHistoryClearSql', () => {
  it('keeps legacy clear(before) compatibility', () => {
    const { sql, values } = buildHistoryClearSql(123);
    expect(sql).toBe('DELETE FROM history WHERE created_at < ?');
    expect(values).toEqual([123]);
  });

  it('combines before and status filters', () => {
    const { sql, values } = buildHistoryClearSql({
      before: 456,
      statuses: ['failed', 'cancelled'],
    });
    expect(sql).toBe('DELETE FROM history WHERE created_at < ? AND status IN (?, ?)');
    expect(values).toEqual([456, 'failed', 'cancelled']);
  });

  it('dedupes invalid status values and clears all when no filters are present', () => {
    const filtered = buildHistoryClearSql({
      statuses: ['failed', 'failed', 'oops' as 'failed'],
      deleteFiles: true,
    });
    expect(filtered.sql).toBe('DELETE FROM history WHERE status IN (?)');
    expect(filtered.values).toEqual(['failed']);

    expect(buildHistoryClearSql({ statuses: [] })).toEqual({
      sql: 'DELETE FROM history',
      values: [],
    });
  });

  it('builds the matching select statement used before cleanup side effects', () => {
    expect(buildHistoryClearSelectSql({ before: 123, statuses: ['success'] })).toEqual({
      sql: 'SELECT id, image_path FROM history WHERE created_at < ? AND status IN (?)',
      values: [123, 'success'],
    });
  });
});

describe('buildHistoryStatsSql', () => {
  it('filters success rows and combines provider/time filters', () => {
    const built = buildHistoryStatsSql({
      groupBy: 'month',
      providerId: 'prov-1',
      from: 100,
      to: 200,
    });

    expect(built.values).toEqual(['prov-1', 100, 200]);
    expect(built.totalSql).toContain(
      "WHERE h.status = 'success' AND h.provider_id = ? AND h.created_at >= ? AND h.created_at <= ?",
    );
    expect(built.bucketsSql).toContain("strftime('%Y-%m'");
    expect(built.byProviderSql).toContain('LEFT JOIN providers p ON p.id = h.provider_id');
  });

  it('supports day/week/month buckets via allowlisted expressions', () => {
    expect(buildHistoryStatsSql({ groupBy: 'day' }).bucketsSql).toContain("strftime('%Y-%m-%d'");
    expect(buildHistoryStatsSql({ groupBy: 'week' }).bucketsSql).toContain("strftime('%Y-W%W'");
    expect(buildHistoryStatsSql({ groupBy: 'month' }).bucketsSql).toContain("strftime('%Y-%m'");
  });

  it('falls back to day for invalid groupBy values', () => {
    const built = buildHistoryStatsSql({ groupBy: 'month; DROP TABLE history' as 'day' });
    expect(built.groupBy).toBe('day');
    expect(built.bucketsSql).toContain("strftime('%Y-%m-%d'");
    expect(built.bucketsSql).not.toContain('DROP TABLE');
  });
});
