'use client';

import type {
  AutomationSpendAction,
  AutomationSpendApproval,
  AutomationSpendStatus,
} from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Separator } from '@musefold/ui/components/separator';
import { ChevronDown, RefreshCw } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import {
  automationErrorMessage,
  formatAutomationLogTime,
  formatAutomationPoints,
} from './automation-ui';
import { useAutomationRequestLog, useAutomationSpendAudit } from './hooks';

/** 花钱动作翻译表(承 v2.1 `automation-format`):机器名 → 人读的中文。 */
const ACTION_LABEL: Record<AutomationSpendAction, string> = {
  generate_image: '生成图像',
  run_scheme: '运行方案',
  run_github_skill: '运行 Skill',
};

const STATUS_LABEL: Record<AutomationSpendStatus, string> = {
  success: '成功',
  failed: '失败',
  cancelled: '取消',
  denied: '已拒绝',
  timeout: '超时',
};

/** 放行来源:让用户看清「这笔钱是谁点头的」。 */
const APPROVAL_LABEL: Record<AutomationSpendApproval, string> = {
  budget: '预算内',
  confirmation: '确认卡',
  consent: '终端确认',
  'idempotent-replay': '幂等重放',
  denied: '—',
  timeout: '—',
};

/**
 * 最近调用卡(07-04 §2.3):端点级请求日志 + 花钱审计,**默认收起**。
 * 只读面 —— 不提供删除(审计完整性);收起时不发请求,展开才拉数据。
 */
export function AutomationAuditCard() {
  const [expanded, setExpanded] = useState(false);
  const requestLog = useAutomationRequestLog(expanded);
  const spendAudit = useAutomationSpendAudit(expanded);

  const entries = requestLog.data ?? [];
  const audits = spendAudit.data ?? [];
  const refreshing = requestLog.isFetching || spendAudit.isFetching;

  return (
    <Card data-testid="settings-automation-audit-card">
      <CardHeader>
        <CardTitle>最近调用</CardTitle>
        <CardDescription>
          外部工具的请求与花钱记录,只保留最近若干条;这是只读的审计面
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs"
            aria-expanded={expanded}
            data-testid="settings-automation-audit-toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : '查看调用记录'}
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-(--dur-fast)',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </Button>
          {expanded && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
              disabled={refreshing}
              data-testid="settings-automation-audit-refresh"
              onClick={() => {
                void requestLog.refetch();
                void spendAudit.refetch();
              }}
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
              刷新
            </Button>
          )}
        </div>

        {expanded && (
          <div className="flex flex-col gap-4" data-testid="settings-automation-audit-body">
            <section className="flex flex-col gap-1">
              <h4 className="font-medium text-foreground text-xs">请求日志</h4>
              {requestLog.isPending && <p className="text-muted-foreground text-xs">读取中…</p>}
              {requestLog.isError && (
                <p
                  className="text-destructive text-xs"
                  data-testid="settings-automation-request-log-error"
                >
                  请求日志读取失败:{automationErrorMessage(requestLog.error, '未知原因')}
                </p>
              )}
              {requestLog.isSuccess && entries.length === 0 && (
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="settings-automation-request-log-empty"
                >
                  暂无调用
                </p>
              )}
              {entries.length > 0 && (
                <ul
                  className="flex flex-col gap-0.5"
                  aria-label="请求日志"
                  data-testid="settings-automation-request-log"
                >
                  {entries.map((entry) => (
                    <li
                      key={`${entry.at}-${entry.method}-${entry.path}-${entry.durationMs}`}
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/60"
                    >
                      <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                        {formatAutomationLogTime(entry.at)}
                      </span>
                      <span className="w-12 shrink-0 font-mono text-muted-foreground">
                        {entry.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                        {entry.path}
                      </span>
                      <span
                        className={cn(
                          'w-8 shrink-0 text-right tabular-nums',
                          entry.status >= 400 ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {entry.status}
                      </span>
                      <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
                        {entry.durationMs} ms
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section className="flex flex-col gap-1">
              <h4 className="font-medium text-foreground text-xs">花钱记录</h4>
              {spendAudit.isPending && <p className="text-muted-foreground text-xs">读取中…</p>}
              {spendAudit.isError && (
                <p
                  className="text-destructive text-xs"
                  data-testid="settings-automation-spend-audit-error"
                >
                  花钱记录读取失败:{automationErrorMessage(spendAudit.error, '未知原因')}
                </p>
              )}
              {spendAudit.isSuccess && audits.length === 0 && (
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="settings-automation-spend-audit-empty"
                >
                  暂无调用
                </p>
              )}
              {audits.length > 0 && (
                <ul
                  className="flex flex-col gap-0.5"
                  aria-label="花钱记录"
                  data-testid="settings-automation-spend-audit"
                >
                  {audits.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/60"
                      data-testid={`settings-automation-spend-row-${entry.id}`}
                    >
                      <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                        {formatAutomationLogTime(entry.at)}
                      </span>
                      <span className="w-20 shrink-0 text-foreground">
                        {ACTION_LABEL[entry.action]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {entry.promptPreview ?? '—'}
                      </span>
                      <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
                        {formatAutomationPoints(entry.estimatedPoints)} /{' '}
                        {formatAutomationPoints(entry.actualPoints)}
                      </span>
                      <span
                        className={cn(
                          'w-14 shrink-0 text-right',
                          entry.status === 'success' ? 'text-muted-foreground' : 'text-destructive',
                        )}
                      >
                        {STATUS_LABEL[entry.status]}
                      </span>
                      <span className="w-16 shrink-0 text-right text-muted-foreground">
                        {APPROVAL_LABEL[entry.approvedVia]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground text-xs">
                预估 / 实际积分并列,未结算显示「-」;审计只读,不提供删除。
              </p>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
