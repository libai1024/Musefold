'use client';

import { AUTOMATION_MAX_MONTHLY_BUDGET_POINTS } from '@musefold/contracts';
import { useCapabilities } from '@musefold/platform';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Input } from '@musefold/ui/components/input';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Switch } from '@musefold/ui/components/switch';
import { Coins, KeyRound, RotateCw, Terminal } from '@musefold/ui/icons';
import { useEffect, useState } from 'react';
import { AutomationAuditCard } from './AutomationAuditCard';
import { ConnectedAppsCard } from './ConnectedAppsCard';
import {
  AutomationCopyButton,
  automationErrorMessage,
  copyAutomationText,
  parseAutomationBudgetDraft,
} from './automation-ui';
import {
  useAutomationStatus,
  useCopyAutomationToken,
  useRotateAutomationToken,
  useSetAutomationBudget,
  useSetAutomationEnabled,
} from './hooks';
import { IntegrationGuideCard } from './IntegrationGuideCard';

/**
 * 设置「开放能力」分区(07-settings-04):桌面本地三卡 + 双端 Cloud MCP 已连接应用。
 * 分区由 `hasLocalAutomation || hasCloudMcpControls` 门控;Web 只渲染已连接应用。
 *
 * 安全纪律:令牌只以掩码展示,「复制」经主进程写系统剪贴板 —— 渲染层从头到尾
 * 不持有明文 bearer,DOM、视觉快照、日志里都不会出现完整令牌。
 */
export function OpenCapabilitiesCard() {
  const capabilities = useCapabilities();
  return (
    <div className="flex flex-col gap-6" data-testid="settings-open-anchor">
      {capabilities.hasLocalAutomation ? (
        <>
          <LocalControlCard />
          <AutomationAuditCard />
          <IntegrationGuideCard />
        </>
      ) : null}
      {capabilities.hasCloudMcpControls ? <ConnectedAppsCard /> : null}
    </div>
  );
}

/**
 * 本地控制面卡(07-04 §2.1):开关 / 地址 / 令牌 / 月度预算四行。
 * 状态矩阵:loading 骨架 → 读取失败 + 「重试」→ ready;三个写动作各有 pending 文案,
 * 期间整卡 `aria-busy` 且控件互斥(一次往返只做一件事,避免开关与轮换打架)。
 */
function LocalControlCard() {
  const status = useAutomationStatus();
  const setEnabled = useSetAutomationEnabled();
  const rotateToken = useRotateAutomationToken();
  const copyToken = useCopyAutomationToken();
  const setBudget = useSetAutomationBudget();
  const [budgetDraft, setBudgetDraft] = useState('');
  const [rotateOpen, setRotateOpen] = useState(false);

  const data = status.data;
  const busy =
    setEnabled.isPending || rotateToken.isPending || setBudget.isPending || copyToken.isPending;

  // 预算草稿跟随最近一次读取/保存结果(草稿不覆盖服务端真值)。
  useEffect(() => {
    if (data) setBudgetDraft(String(data.monthlyBudgetPoints));
  }, [data]);

  const draftPoints = parseAutomationBudgetDraft(budgetDraft);
  const budgetDirty = draftPoints !== null && draftPoints !== data?.monthlyBudgetPoints;

  function toggle(next: boolean) {
    setEnabled.mutate(next, {
      onSuccess: (result) =>
        toast.success(
          result.running
            ? `本地控制面已启动 · ${result.host}:${result.port}`
            : '本地控制面已停止,发现文件已删除',
        ),
      onError: (error) =>
        toast.error(automationErrorMessage(error, '切换本地控制面失败,请稍后重试')),
    });
  }

  function rotate() {
    rotateToken.mutate(undefined, {
      onSuccess: () => {
        setRotateOpen(false);
        toast.success('令牌已轮换 · 旧令牌立即失效,请在 Agent 侧更新');
      },
      onError: (error) => toast.error(automationErrorMessage(error, '轮换令牌失败,请稍后重试')),
    });
  }

  function saveBudget() {
    if (draftPoints === null) return;
    setBudget.mutate(draftPoints, {
      onSuccess: (result) =>
        toast.success(
          result.monthlyBudgetPoints === 0
            ? '已设为 0 积分 · 每次花钱动作都会弹确认'
            : `月度预算已保存:${result.monthlyBudgetPoints} 积分`,
        ),
      onError: (error) => toast.error(automationErrorMessage(error, '保存预算失败,请稍后重试')),
    });
  }

  function copyTokenViaMainProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      copyToken.mutate(undefined, {
        onSuccess: () => {
          toast.success('令牌已复制到剪贴板');
          resolve();
        },
        onError: (error) => {
          toast.error(automationErrorMessage(error, '复制令牌失败,请稍后重试'));
          reject(error instanceof Error ? error : new Error('copy token failed'));
        },
      });
    });
  }

  if (status.isPending) {
    return (
      <Card data-testid="settings-automation-card" aria-busy>
        <CardHeader>
          <CardTitle>本地控制面</CardTitle>
          <CardDescription>本机 Agent 与脚本经回环端口调用 Musefold</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0" data-testid="settings-automation-loading">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-9 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (status.isError || !data) {
    return (
      <Card data-testid="settings-automation-card">
        <CardHeader>
          <CardTitle>本地控制面</CardTitle>
          <CardDescription>本机 Agent 与脚本经回环端口调用 Musefold</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 pt-0">
          <p
            className="min-w-0 flex-1 text-destructive text-xs"
            data-testid="settings-automation-error"
          >
            控制面状态读取失败:{automationErrorMessage(status.error, '未知原因')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            data-testid="settings-automation-retry"
            onClick={() => void status.refetch()}
          >
            重试
          </Button>
        </CardContent>
      </Card>
    );
  }

  const address = data.port ? `http://${data.host}:${data.port}` : null;

  return (
    <Card data-testid="settings-automation-card" aria-busy={busy}>
      <CardHeader>
        <CardTitle>本地控制面</CardTitle>
        <CardDescription>
          本机 Agent 与脚本经回环端口调用 Musefold;令牌只用于本机接入,不会上传
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {/* 开关行:关闭可逆(端口停听 + 发现文件删除),不用危险色。 */}
        <div className="flex items-center gap-3" data-testid="settings-automation-toggle-row">
          <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm">开放本机调用</p>
            <p className="text-muted-foreground text-xs" data-testid="settings-automation-hint">
              {data.running
                ? '本机 Agent 与脚本可经 HTTP 端口调用 Musefold'
                : '端口未在监听,外部工具暂时无法调用'}
            </p>
          </div>
          <Switch
            checked={data.enabled}
            disabled={busy}
            aria-label={data.enabled ? '关闭本机调用' : '开放本机调用'}
            data-testid="settings-automation-toggle"
            onCheckedChange={toggle}
          />
        </div>

        {address && (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            data-testid="settings-automation-address-row"
          >
            <span className="shrink-0 text-foreground text-sm">地址</span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs tabular-nums"
              data-testid="settings-automation-address"
            >
              {address}
            </span>
            <AutomationCopyButton
              label="复制"
              testId="settings-automation-address-copy"
              onCopy={() => copyAutomationText(address, '地址已复制')}
            />
          </div>
        )}

        <Separator />

        {/* 令牌行:掩码只读展示 + 主进程复制 + 轮换二次确认;没有「显示明文」入口。 */}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="settings-automation-token-row"
        >
          <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 text-foreground text-sm">访问令牌</span>
          <code
            className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-muted-foreground text-xs"
            data-testid="settings-automation-token"
          >
            {data.tokenMasked ?? '—'}
          </code>
          <AutomationCopyButton
            label="复制"
            testId="settings-automation-token-copy"
            disabled={!data.tokenMasked || busy}
            onCopy={copyTokenViaMainProcess}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
            disabled={!data.running || busy}
            title={data.running ? '轮换令牌' : '控制面未在运行,无法轮换令牌'}
            data-testid="settings-automation-token-rotate"
            onClick={() => setRotateOpen(true)}
          >
            <RotateCw className="size-3.5" aria-hidden />
            轮换
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          令牌等同「操作 Musefold 的钥匙」,有泄露疑虑时立即轮换。界面上只显示掩码,复制由应用完成。
        </p>

        <Separator />

        {/* 预算行:数字输入 + 保存;草稿防呆见 parseAutomationBudgetDraft。 */}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="settings-automation-budget-row"
        >
          <Coins className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 text-foreground text-sm">月度预算</span>
          <Input
            type="number"
            min={0}
            step={1}
            max={AUTOMATION_MAX_MONTHLY_BUDGET_POINTS}
            value={budgetDraft}
            placeholder="0"
            aria-label="每月自动化积分预算"
            className="h-8 w-24 text-right font-mono text-sm tabular-nums"
            disabled={busy}
            data-testid="settings-automation-budget-input"
            onChange={(event) => setBudgetDraft(event.target.value)}
          />
          <span className="shrink-0 text-muted-foreground text-xs">积分 / 月</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={busy || !budgetDirty}
            title={
              budgetDraft.trim() === '' ? '清空输入不会保存;0 积分表示每次动作都要确认' : '保存预算'
            }
            data-testid="settings-automation-budget-save"
            onClick={saveBudget}
          >
            {setBudget.isPending ? '保存中…' : '保存'}
          </Button>
          <p
            className="w-full text-muted-foreground text-xs tabular-nums"
            data-testid="settings-automation-budget-readout"
          >
            本月已用 {data.spentThisMonthPoints} / {data.monthlyBudgetPoints} 积分(
            {data.budgetMonth}
            );预算内的花钱动作自动放行,超出或成本未知时逐次确认
          </p>
        </div>
      </CardContent>

      <AlertDialog
        open={rotateOpen}
        onOpenChange={(open) => {
          if (!open && !rotateToken.isPending) setRotateOpen(false);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>轮换访问令牌?</AlertDialogTitle>
            <AlertDialogDescription>
              轮换后旧令牌立即失效,已接入的 Agent 需要重新填写新令牌。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotateToken.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={rotateToken.isPending}
              data-testid="settings-automation-token-rotate-confirm"
              onClick={(event) => {
                // 失败要留在对话框里就地报错,不能被默认关闭吃掉。
                event.preventDefault();
                rotate();
              }}
            >
              {rotateToken.isPending ? '轮换中…' : '轮换令牌'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
