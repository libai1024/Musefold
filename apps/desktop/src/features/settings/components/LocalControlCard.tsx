// 设置 · 开放能力 — 本地控制面卡(V04-SET-01,自 AutomationSection 拆出)。
// 开关 / token 展示与轮换 / 月度自动化积分预算。数据与 busy 由 AutomationSection 注入。
// 安全边界:token 只在本机 UI 展示(title 仅 revealed 态),不进日志/SQLite/导出。
import { useEffect, useState } from 'react';
import type { AutomationBudget, AutomationStatus } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { SettingsSwitch } from '@musefold/product-ui';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { SettingRow, SettingsCard } from './SectionShell';
import { maskToken, parseBudgetDraft } from './automation-format';
import type { CopyWithFeedback } from './automation-clipboard';

interface LocalControlCardProps {
  status: AutomationStatus | null;
  budget: AutomationBudget | null;
  busy: boolean;
  copiedKey: string | null;
  copy: CopyWithFeedback['copy'];
  onStatusChange: (status: AutomationStatus) => void;
  onBudgetChange: (budget: AutomationBudget) => void;
  /** 互斥执行:busy 期间拒绝新任务(与接入向导共用同一 busy 面)。 */
  runExclusive: (task: () => Promise<void>) => Promise<void>;
}

export function LocalControlCard({
  status,
  budget,
  busy,
  copiedKey,
  copy,
  onStatusChange,
  onBudgetChange,
  runExclusive,
}: LocalControlCardProps) {
  const [revealed, setRevealed] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  const copied = copiedKey === 'token';

  // 预算草稿跟随最近一次读取/保存结果(原 refresh 内联逻辑等价迁移)。
  useEffect(() => {
    if (budget) setBudgetDraft(String(budget.monthlyLimitPoints));
  }, [budget]);

  const toggle = () =>
    void runExclusive(async () => {
      if (!status) return;
      onStatusChange(await api.automation.setEnabled(!status.enabled));
    });

  const rotate = () =>
    void runExclusive(async () => {
      onStatusChange(await api.automation.rotateToken());
      // 轮换后自动显示:新 token 立即可见可复制,是合理动线。
      setRevealed(true);
    });

  const copyToken = () => {
    if (!status?.token) return;
    void copy('token', status.token);
  };

  // 空串/非法草稿不落盘(Number('') === 0 会把「逐次确认」预算误写死);负数 clamp 到 0。
  const draftPoints = parseBudgetDraft(budgetDraft);
  const saveBudget = () => {
    if (draftPoints === null) return;
    void runExclusive(async () => {
      onBudgetChange(await api.automation.budget.set(draftPoints));
    });
  };

  return (
    <SettingsCard title="本地控制面" description="配置监听状态、访问令牌与每月自动化积分预算">
      <SettingRow
        label="本地控制面"
        hint={
          status?.running
            ? `运行中 · 127.0.0.1:${status.port} · API v1`
            : '已停止（发现文件已删除）'
        }
        data-testid="automation-toggle-row"
      >
        <SettingsSwitch
          checked={status?.enabled ?? false}
          onCheckedChange={toggle}
          label={status?.enabled ? '关闭本地控制面' : '启用本地控制面'}
          disabled={!status || busy}
          testId="automation-toggle"
        />
      </SettingRow>

      <SettingRow
        className="settings-automation-token-row"
        label="访问 token"
        hint="等同「操作 Musefold 的钥匙」；泄露疑虑时立即轮换。"
        data-testid="automation-token-row"
      >
        <div className="settings-token-controls">
          <code
            className="max-w-[220px] truncate rounded bg-inset px-2 py-1 font-mono text-[11px] text-secondary"
            data-testid="automation-token-value"
            title={revealed ? (status?.token ?? '') : undefined}
          >
            {status?.token ? (revealed ? status.token : maskToken(status.token)) : '—'}
          </code>
          <Button
            size="sm"
            variant="outline"
            disabled={!status?.token}
            onClick={() => setRevealed((value) => !value)}
          >
            {revealed ? '隐藏' : '显示'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!status?.token}
            data-testid="automation-token-copy"
            onClick={copyToken}
          >
            {copied ? '已复制' : '复制'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!status?.running || busy}
            data-testid="automation-token-rotate"
            onClick={rotate}
          >
            轮换
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        label="自动化预算"
        hint={
          budget
            ? `本月已用 ${budget.usedPoints} 积分；预算内的生成自动放行，超出或未知成本逐次确认（默认 0 积分）`
            : '预算内的生成自动放行'
        }
        data-testid="automation-budget-row"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-quaternary">积分</span>
          <Input
            type="number"
            min="0"
            step="0.5"
            value={budgetDraft}
            onChange={(event) => setBudgetDraft(event.target.value)}
            data-testid="automation-budget-input"
            className="settings-budget-input no-drag w-20 px-2 text-right text-[12px] tabular-nums text-primary"
          />
          <span className="text-[11px] text-quaternary">/月</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || budget == null || draftPoints === null}
            title={
              budgetDraft.trim() === '' ? '清空输入不会保存；0 积分表示每次逐次确认' : undefined
            }
            data-testid="automation-budget-save"
            onClick={saveBudget}
          >
            保存
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}
