import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { up } from '@musefold/core/db/migrations/0014_doubao_web_daily_usage';
import {
  DoubaoDailyLimitError,
  getDoubaoWebUsage,
  localDateKey,
  reserveDoubaoWebGeneration,
} from '../usage-limit';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  up(db);
});

describe('Doubao web daily usage', () => {
  it('uses the local calendar date', () => {
    expect(localDateKey(new Date(2026, 7, 16, 23, 59))).toBe('2026-08-16');
  });

  it('allows ten reservations and rejects the eleventh', () => {
    const now = new Date(2026, 7, 16, 10, 0);
    for (let index = 0; index < 10; index += 1) reserveDoubaoWebGeneration(db, now);

    expect(getDoubaoWebUsage(db, now)).toMatchObject({ used: 10, remaining: 0, limit: 10 });
    expect(() => reserveDoubaoWebGeneration(db, now)).toThrow(DoubaoDailyLimitError);
    expect(getDoubaoWebUsage(db, now).used).toBe(10);
  });

  it('resets on the next local day', () => {
    const dayOne = new Date(2026, 7, 16, 23, 59);
    const dayTwo = new Date(2026, 7, 17, 0, 1);
    reserveDoubaoWebGeneration(db, dayOne);

    expect(getDoubaoWebUsage(db, dayTwo)).toMatchObject({ used: 0, remaining: 10 });
    expect(reserveDoubaoWebGeneration(db, dayTwo)).toMatchObject({ used: 1, remaining: 9 });
  });

  it('keeps daily reservations separate for each Doubao account name', () => {
    const now = new Date(2026, 7, 16, 10, 0);
    for (let index = 0; index < 10; index += 1) reserveDoubaoWebGeneration(db, now, '李小白');

    expect(getDoubaoWebUsage(db, now, '李小白')).toMatchObject({ used: 10, remaining: 0 });
    expect(getDoubaoWebUsage(db, now, '王小明')).toMatchObject({ used: 0, remaining: 10 });
    expect(reserveDoubaoWebGeneration(db, now, '王小明')).toMatchObject({ used: 1, remaining: 9 });
  });

  it('migrates the pre-account global row once to the first observed account', () => {
    const now = new Date(2026, 7, 16, 10, 0);
    reserveDoubaoWebGeneration(db, now);
    expect(getDoubaoWebUsage(db, now, '李小白')).toMatchObject({ used: 1, remaining: 9 });
    expect(getDoubaoWebUsage(db, now, '王小明')).toMatchObject({ used: 0, remaining: 10 });
  });
});
