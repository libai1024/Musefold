'use client';

import { Button } from '@musefold/ui/components/button';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useState } from 'react';
import type { AutomationConfirmationItem } from './use-automation-confirmations';
import { useAutomationConfirmations } from './use-automation-confirmations';

/**
 * 外部工具花钱确认卡(V25-UI-SPEC §2.4 壳级反馈设施 / 01-shell §4)。
 *
 * 主进程闸门在「预算不够或成本未知」时广播确认请求,HTTP 请求就地挂起等结果 ——
 * 所以这张卡是**非阻塞浮层**而不是 Dialog:它不能夺焦、不能拦住用户正在做的事,
 * 但必须一眼看清「谁要花多少钱」。桌面固定右下,移动端顶部(<sm 铺满宽度)。
 *
 * 挂载点与 `Toaster` 同级(desktop-shell);Web 宿主 `hasLocalAutomation=false`,
 * 渲染 null,不需要宿主判断。
 */
export function AutomationConfirmCard() {
  const { queue, available, resolve, dismiss } = useAutomationConfirmations();
  const active = queue[0];

  if (!available || !active) return null;

  return (
    <div
      className={cn(
        'fixed z-50 flex flex-col gap-2 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg',
        'inset-x-3 top-3 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:w-80',
      )}
      // 非阻塞但需要被读屏及时播报:alertdialog + assertive(它有时限)。
      role="alertdialog"
      aria-live="assertive"
      aria-label="外部工具请求生成"
      data-testid="automation-confirm-card"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-medium text-foreground text-sm">外部工具请求生成</p>
        <Countdown
          key={active.summary.confirmationId}
          item={active}
          onExpire={() => dismiss(active.summary.confirmationId)}
        />
      </div>

      <p className="text-muted-foreground text-xs" data-testid="automation-confirm-meta">
        {active.summary.providerName} · {active.summary.model} · {active.summary.n} 张 ·{' '}
        <span className="tabular-nums">
          {active.summary.estimatedPoints != null
            ? `预估 ${active.summary.estimatedPoints} 积分`
            : '成本未知'}
        </span>
      </p>

      {active.summary.promptPreview && (
        <p className="line-clamp-3 rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {active.summary.promptPreview}
        </p>
      )}

      {queue.length > 1 && (
        <p
          className="text-muted-foreground text-xs tabular-nums"
          data-testid="automation-confirm-queue"
        >
          还有 {queue.length - 1} 个等待确认
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          data-testid="automation-confirm-deny"
          onClick={() => resolve(active.summary.confirmationId, false)}
        >
          拒绝
        </Button>
        <Button
          size="sm"
          className="h-8"
          data-testid="automation-confirm-approve"
          onClick={() => resolve(active.summary.confirmationId, true)}
        >
          允许生成
        </Button>
      </div>
    </div>
  );
}

/**
 * 倒计时:每秒刷一次剩余秒数,到 0 通知父组件撤卡(= 视为拒绝)。
 * 用 `deadlineAt` 而不是自减计数器 —— 系统休眠 / 标签页节流后回来,
 * 剩余时间必须仍然是真实剩余时间。
 */
function Countdown({ item, onExpire }: { item: AutomationConfirmationItem; onExpire(): void }) {
  const [remainingMs, setRemainingMs] = useState(() => item.deadlineAt - Date.now());

  useEffect(() => {
    setRemainingMs(item.deadlineAt - Date.now());
    const timer = setInterval(() => {
      const next = item.deadlineAt - Date.now();
      setRemainingMs(next);
      if (next <= 0) onExpire();
    }, 1_000);
    return () => clearInterval(timer);
  }, [item.deadlineAt, onExpire]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return (
    <span
      className={cn(
        'shrink-0 text-xs tabular-nums',
        seconds <= 10 ? 'text-destructive' : 'text-muted-foreground',
      )}
      data-testid="automation-confirm-countdown"
    >
      {seconds}s
    </span>
  );
}
