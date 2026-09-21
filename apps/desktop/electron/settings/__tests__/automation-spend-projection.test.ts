import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import type { ManagedExecutionAnchor } from '@musefold/desktop-contracts/managed-execution';

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  budget: {} as unknown,
  failWrite: false,
  managed: vi.fn(),
}));
vi.mock('../../system/managed-execution', () => ({
  withManagedExecution: (work: unknown) => state.managed(work),
}));
vi.mock('@musefold/core/db/index', () => ({ getDb: () => state.db }));
vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return key === 'automation.budget' ? state.budget : fallback;
    }
    set(key: string, value: unknown) {
      if (state.failWrite) throw new Error('fixture projection unavailable');
      if (key === 'automation.budget') state.budget = value;
    }
  },
}));
import {
  getAutomationBudget,
  getAutomationSpendRepository,
  remainingAutomationBudgetPoints,
  setAutomationBudgetLimit,
  settleAutomationBudget,
} from '../automation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T00:00:00Z'));
  state.db = new Database(':memory:');
  takeoverDesktopDatabase(state.db);
  let stored: ManagedExecutionAnchor | null = null;
  const guard = new ManagedExecutionGuard(new ManagedExecutionRepository(state.db), {
    scope: `projection-${Math.random()}`,
    read: async () => stored,
    write: async (value) => {
      stored = structuredClone(value);
    },
  });
  state.managed.mockReset().mockImplementation((work) => work({ guard, assertCurrent: () => {} }));
  state.failWrite = false;
  state.budget = { monthlyLimitCents: 100, usedCents: 15, month: '2026-09' };
});
afterEach(() => {
  state.db?.close();
  vi.useRealTimers();
});

describe('electron-store budget compatibility projection', () => {
  it('imports existing policy once, preserves point conversion, and ignores stale store edits after cutover', () => {
    expect(getAutomationBudget()).toEqual({
      monthlyLimitPoints: 10,
      usedPoints: 1.5,
      month: '2026-09',
    });
    state.budget = { monthlyLimitPoints: 999, usedPoints: 999, month: '2026-09' };
    expect(getAutomationBudget()).toEqual({
      monthlyLimitPoints: 10,
      usedPoints: 1.5,
      month: '2026-09',
    });
    expect(getAutomationSpendRepository().isInitialized()).toBe(true);
  });

  it('keeps SQLite authoritative after projection failure and rebuilds the view without double posting', async () => {
    getAutomationBudget();
    state.failWrite = true;
    await settleAutomationBudget(2.5);
    await setAutomationBudgetLimit(20);
    state.budget = { month: 'broken', usedPoints: Number.NaN };
    expect(getAutomationBudget()).toEqual({
      monthlyLimitPoints: 20,
      usedPoints: 4,
      month: '2026-09',
    });
    expect(remainingAutomationBudgetPoints()).toBe(16);
    state.failWrite = false;
    getAutomationBudget();
    expect(state.budget).toEqual({ monthlyLimitPoints: 20, usedPoints: 4, month: '2026-09' });
  });

  it('retains UTC-month behavior and preserves the previous period instead of erasing historical usage', () => {
    getAutomationBudget();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    expect(getAutomationBudget()).toEqual({
      monthlyLimitPoints: 10,
      usedPoints: 0,
      month: '2026-10',
    });
    expect(
      getAutomationSpendRepository().budget(Date.parse('2026-09-30T23:59:59Z')).usedPoints,
    ).toBe(1.5);
  });
});
