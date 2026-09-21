'use client';

import { AUTOMATION_MAX_MONTHLY_BUDGET_POINTS } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { toast } from '@musefold/ui/components/sonner';
import { Check, Copy } from '@musefold/ui/icons';
import { useEffect, useState } from 'react';

/**
 * 「开放能力」三张卡共用的纯工具与小原语。
 * 单独成文件是为了让三张卡都只单向依赖它(no-circular 是机器强制规则)。
 */

/** 错误文案:主进程 BridgeError 的 message 已是 path-free,直接回显;兜底给动作级文案。 */
export function automationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 预算草稿解析(承 v2.1 的防呆规则,每条都对应一次真实误操作):
 * - 空串 / 非数字 → null = 不落盘(`Number('') === 0` 会把预算悄悄改成「逐次确认」);
 * - 负数 → clamp 到 0(0 本身是合法值:一切花钱动作都弹确认卡);
 * - 小数 → 向下取整(契约只收整数积分);
 * - 超上限 → clamp 到上限(误输入 10 位数不该直接被契约打回)。
 */
export function parseAutomationBudgetDraft(draft: string): number | null {
  if (draft.trim() === '') return null;
  const value = Number(draft);
  if (!Number.isFinite(value)) return null;
  const points = Math.floor(Math.max(0, value));
  return Math.min(points, AUTOMATION_MAX_MONTHLY_BUDGET_POINTS);
}

const LOG_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 审计行时间带日期分量(MM/DD HH:mm):昨天的调用不该看着像刚刚发生。 */
export function formatAutomationLogTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : LOG_TIME_FORMAT.format(date);
}

/** 积分列:未结算 / 成本未知显示「-」(承 v2.1 `actualPoints ?? '-'`)。 */
export function formatAutomationPoints(points: number | null): string {
  return points == null ? '-' : String(points);
}

/**
 * 走浏览器剪贴板的复制(地址、接入片段等**非密钥**文本)。
 * 令牌不走这里 —— 它由主进程 `automation.copyToken` 写系统剪贴板,渲染层无明文。
 */
export function copyAutomationText(text: string, successMessage: string): Promise<void> {
  return navigator.clipboard.writeText(text).then(
    () => {
      toast.success(successMessage);
    },
    () => {
      toast.error('复制失败,请手动选中复制');
      throw new Error('clipboard write failed');
    },
  );
}

/** 复制按钮:钮内 Copy→Check 1.2s + toast 双反馈(与 07-06 存储位置行同一形态)。 */
export function AutomationCopyButton({
  label,
  testId,
  disabled,
  onCopy,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  onCopy(): Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
      disabled={disabled}
      title={label}
      data-testid={testId}
      onClick={() => {
        void onCopy().then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {label}
    </Button>
  );
}
