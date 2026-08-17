import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../0014_doubao_web_daily_usage';

describe('0014_doubao_web_daily_usage', () => {
  it('creates the durable daily usage table', () => {
    const db = new Database(':memory:');
    up(db);

    const columns = db.pragma('table_info(doubao_web_daily_usage)') as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'usage_scope',
      'usage_date',
      'request_count',
      'updated_at',
    ]);
    db.close();
  });
});
