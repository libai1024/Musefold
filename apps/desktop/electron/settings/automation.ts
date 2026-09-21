// 自动化（控制面）设置：开关持久化在主 electron-store 的 automation 命名空间。
// 决策 D7/评审 2026-08-13：automation.enabled 默认开；预算默认 0（一切花钱须确认，P2 接入）。

import Store from 'electron-store';
import { STORE_NAME } from '@musefold/core/constants';
import { getDb } from '@musefold/core/db/index';
import {
  AutomationSpendRepository,
  normalizeLegacyAutomationBudget,
} from '@musefold/core/db/repositories/automation-spend';
import { automationLegacyBudgetSchema } from '@musefold/desktop-contracts/automation-spend';
import { withManagedExecution } from '../system/managed-execution';

interface AutomationBudgetShape {
  /** 月度上限（积分）；0 = 一切花钱动作须确认（Q1 拍板默认） */
  monthlyLimitPoints: number;
  /** 本月已用（积分，按实际成本冲销） */
  usedPoints: number;
  /** 记账月份 YYYY-MM；跨月自动清零 */
  month: string;
}

interface AutomationSettingsShape {
  automation: {
    enabled: boolean;
    budget: AutomationBudgetShape;
    skillUpdates: {
      autoUpdate: boolean;
    };
  };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const store = new Store<AutomationSettingsShape>({
  name: STORE_NAME,
  defaults: {
    automation: {
      enabled: true,
      budget: { monthlyLimitPoints: 0, usedPoints: 0, month: currentMonth() },
      skillUpdates: { autoUpdate: false },
    },
  },
});

export function getAutomationEnabled(): boolean {
  return store.get('automation.enabled', true) as boolean;
}

export function setAutomationEnabled(enabled: boolean): void {
  store.set('automation.enabled', enabled);
}

export function getSkillAutoUpdateEnabled(): boolean {
  return store.get('automation.skillUpdates.autoUpdate', false) as boolean;
}

export function setSkillAutoUpdateEnabled(enabled: boolean): void {
  store.set('automation.skillUpdates.autoUpdate', enabled);
}

export function getAutomationBudget(): AutomationBudgetShape {
  const budget = getAutomationSpendRepository().budget(Date.now());
  const projection = {
    monthlyLimitPoints: budget.monthlyLimitPoints,
    usedPoints: budget.usedPoints,
    month: budget.month,
  };
  // Compatibility projection only: failure never makes the policy re-import stale usage.
  try {
    store.set('automation.budget', projection);
  } catch {
    /* SQLite remains authoritative. */
  }
  return projection;
}

/** SQLite is the authority after the first import; changing account/token does not re-import. */
export function getAutomationSpendRepository(): AutomationSpendRepository {
  const repository = new AutomationSpendRepository(getDb());
  if (!repository.isInitialized()) {
    repository.initializeBudget(
      normalizeLegacyAutomationBudget(store.get('automation.budget'), Date.now()),
      Date.now(),
    );
  }
  return repository;
}

export async function setAutomationBudgetLimit(
  monthlyLimitPoints: number,
): Promise<AutomationBudgetShape> {
  const points = automationLegacyBudgetSchema.shape.monthlyLimitPoints.parse(monthlyLimitPoints);
  const repository = getAutomationSpendRepository();
  const now = Date.now();
  await withManagedExecution(({ guard, assertCurrent }) =>
    guard.coordinateBudget({ action: 'set_limit', points }, () => {
      assertCurrent();
      if (repository.budget(now).monthlyLimitPoints === points) return { unchanged: undefined };
      return {
        change: () => {
          assertCurrent();
          repository.setBudgetLimit(points, now);
        },
      };
    }),
  );
  return getAutomationBudget();
}

export function remainingAutomationBudgetPoints(): number {
  return getAutomationSpendRepository().budget(Date.now()).remainingPoints;
}

export async function settleAutomationBudget(actualPoints: number): Promise<void> {
  const points = automationLegacyBudgetSchema.shape.usedPoints.parse(actualPoints);
  if (points === 0) return;
  // Transitional R/S callers only. Durable calls settle via their unique call records.
  const repository = getAutomationSpendRepository();
  const now = Date.now();
  await withManagedExecution(({ guard, assertCurrent }) =>
    guard.coordinateBudget({ action: 'legacy_usage', points, now }, () => {
      assertCurrent();
      repository.budget(now);
      return {
        change: () => {
          assertCurrent();
          repository.recordLegacyPolicyUsage(points, now);
        },
      };
    }),
  );
  getAutomationBudget();
}
