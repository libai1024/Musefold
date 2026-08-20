import type Database from 'better-sqlite3';
import { DOUBAO_WEB_DAILY_IMAGE_LIMIT } from '@musefold/domain/constants';
import type { DoubaoWebUsageStatus } from '@musefold/desktop-contracts/providers';
import { getDb } from '@musefold/core/db/index';

const USAGE_SCOPE = 'doubao-web-image';
const LEGACY_USAGE_SCOPE = USAGE_SCOPE;

function scopedUsageScope(accountName?: string | null): string {
  const normalized = accountName?.trim().normalize('NFKC');
  return normalized ? `${USAGE_SCOPE}:${normalized}` : LEGACY_USAGE_SCOPE;
}

function migrateLegacyUsage(
  db: Database.Database,
  date: string,
  scope: string,
  now: Date,
): void {
  if (scope === LEGACY_USAGE_SCOPE) return;
  const legacy = db.prepare(
    'SELECT request_count, updated_at FROM doubao_web_daily_usage WHERE usage_scope = ? AND usage_date = ?',
  ).get(LEGACY_USAGE_SCOPE, date) as { request_count: number; updated_at: number } | undefined;
  if (!legacy) return;
  const existing = db.prepare(
    'SELECT 1 FROM doubao_web_daily_usage WHERE usage_scope = ? AND usage_date = ?',
  ).get(scope, date);
  if (!existing) {
    db.prepare(`
      INSERT INTO doubao_web_daily_usage (usage_scope, usage_date, request_count, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(scope, date, legacy.request_count, legacy.updated_at || now.getTime());
  }
  db.prepare(
    'DELETE FROM doubao_web_daily_usage WHERE usage_scope = ? AND usage_date = ?',
  ).run(LEGACY_USAGE_SCOPE, date);
}

export class DoubaoDailyLimitError extends Error {
  readonly code = 'DOUBAO_DAILY_LIMIT';

  constructor(readonly status: DoubaoWebUsageStatus) {
    super(`豆包网页生图今日已达 ${status.limit} 次上限，请明天再试或在高级设置中切换其他服务`);
    this.name = 'DoubaoDailyLimitError';
  }
}

export function localDateKey(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function getDoubaoWebUsage(
  db: Database.Database = getDb(),
  now = new Date(),
  accountName?: string | null,
): DoubaoWebUsageStatus {
  const date = localDateKey(now);
  const scope = scopedUsageScope(accountName);
  migrateLegacyUsage(db, date, scope, now);
  const row = db.prepare(
    'SELECT request_count FROM doubao_web_daily_usage WHERE usage_scope = ? AND usage_date = ?',
  ).get(scope, date) as { request_count: number } | undefined;
  const used = Math.max(0, row?.request_count ?? 0);
  return {
    date,
    limit: DOUBAO_WEB_DAILY_IMAGE_LIMIT,
    used,
    remaining: Math.max(0, DOUBAO_WEB_DAILY_IMAGE_LIMIT - used),
  };
}

/** 在网页提交前原子占用一次。失败请求也计数，避免异常页面被反复触发。 */
export function reserveDoubaoWebGeneration(
  db: Database.Database = getDb(),
  now = new Date(),
  accountName?: string | null,
): DoubaoWebUsageStatus {
  const date = localDateKey(now);
  const scope = scopedUsageScope(accountName);
  return db.transaction(() => {
    migrateLegacyUsage(db, date, scope, now);
    const result = db.prepare(`
      INSERT INTO doubao_web_daily_usage (usage_scope, usage_date, request_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(usage_scope, usage_date) DO UPDATE SET
        request_count = request_count + 1,
        updated_at = excluded.updated_at
      WHERE request_count < ?
    `).run(scope, date, now.getTime(), DOUBAO_WEB_DAILY_IMAGE_LIMIT);

    if (result.changes === 0) throw new DoubaoDailyLimitError(getDoubaoWebUsage(db, now, accountName));
    db.prepare('DELETE FROM doubao_web_daily_usage WHERE usage_date < ?').run(date);
    return getDoubaoWebUsage(db, now, accountName);
  })();
}
