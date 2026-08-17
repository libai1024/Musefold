// 自动化（控制面）设置：开关持久化在主 electron-store 的 automation 命名空间。
// 决策 D7/评审 2026-08-13：automation.enabled 默认开；预算默认 0（一切花钱须确认，P2 接入）。

import Store from 'electron-store';
import { STORE_NAME } from '@shared/constants';

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
    },
  },
});

export function getAutomationEnabled(): boolean {
  return store.get('automation.enabled', true) as boolean;
}

export function setAutomationEnabled(enabled: boolean): void {
  store.set('automation.enabled', enabled);
}

export function getAutomationBudget(): AutomationBudgetShape {
  const budget = store.get('automation.budget') as (AutomationBudgetShape & {
    monthlyLimitCents?: number;
    usedCents?: number;
  }) | undefined;
  const normalized: AutomationBudgetShape = {
    monthlyLimitPoints: budget?.monthlyLimitPoints ?? ((budget?.monthlyLimitCents ?? 0) / 10),
    usedPoints: budget?.usedPoints ?? ((budget?.usedCents ?? 0) / 10),
    month: budget?.month ?? currentMonth(),
  };
  const legacy = budget && (budget.monthlyLimitPoints == null || budget.usedPoints == null);
  if (normalized.month !== currentMonth()) {
    normalized.month = currentMonth();
    normalized.usedPoints = 0;
    store.set('automation.budget', normalized);
  } else if (legacy) {
    store.set('automation.budget', normalized);
  }
  return normalized;
}

export function setAutomationBudgetLimit(monthlyLimitPoints: number): AutomationBudgetShape {
  const budget = getAutomationBudget();
  const next = { ...budget, monthlyLimitPoints: Math.max(0, monthlyLimitPoints) };
  store.set('automation.budget', next);
  return next;
}

export function remainingAutomationBudgetPoints(): number {
  const budget = getAutomationBudget();
  return Math.max(0, budget.monthlyLimitPoints - budget.usedPoints);
}

export function settleAutomationBudget(actualPoints: number): void {
  if (actualPoints <= 0) return;
  const budget = getAutomationBudget();
  store.set('automation.budget', { ...budget, usedPoints: budget.usedPoints + actualPoints });
}
