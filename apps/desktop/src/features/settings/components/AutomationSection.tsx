// 设置 · 自动化（V04-SET-01）：本地控制面、接入向导与审计一览的编排壳。
// v2 拆分：LocalControlCard / IntegrationGuide(+SkillManagementBlock) / AutomationAuditList；
// 本文件只负责四路取数(refresh)、loading/ready/error 三态与互斥 busy 面。
// 安全边界：token 只用于本机 Agent/CLI 接入；关闭后端口不再监听、发现文件删除。
import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationBudget,
  AutomationSpendAudit,
  AutomationStatus,
  IntegrationInfo,
} from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { Button } from '../../../components/ui/button';
import { LocalControlCard } from './LocalControlCard';
import { IntegrationGuide } from './IntegrationGuide';
import { AutomationAuditList } from './AutomationAuditList';
import { useCopyWithFeedback } from './automation-clipboard';

export function AutomationSection() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [audit, setAudit] = useState<AutomationSpendAudit[]>([]);
  const [budget, setBudget] = useState<AutomationBudget | null>(null);
  const [integration, setIntegration] = useState<IntegrationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { copiedKey, copy } = useCopyWithFeedback();

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextStatus, nextAudit, nextBudget, nextIntegration] = await Promise.all([
        api.automation.status(),
        api.automation.auditList(20),
        api.automation.budget.get(),
        api.automation.integrationInfo(),
      ]);
      setStatus(nextStatus);
      setAudit(nextAudit);
      setBudget(nextBudget);
      setIntegration(nextIntegration);
      setLoadError(null);
    } catch (cause) {
      setLoadError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : '自动化状态读取失败，请重试',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 单一 busy 面横跨三张卡(已知粗粒度欠账,保持现状);budget 保存原先可与其他动作并发,拆分后统一入列。
  const runExclusive = useCallback(
    async (task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await task();
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // 三态:首次读取中 / 可恢复错误(有旧数据时保留内容,仅顶部告警)/ ready。
  if (loading && status === null) {
    return (
      <div
        className="mt-3 rounded-md border border-subtle bg-inset px-4 py-6 text-center text-[12px] text-tertiary"
        role="status"
        data-testid="automation-loading"
      >
        正在读取自动化状态…
      </div>
    );
  }

  return (
    <>
      {loadError && (
        <div
          className="mt-2 rounded-md border border-danger/35 bg-danger/5 px-4 py-3"
          role="alert"
          data-testid="automation-load-error"
        >
          <p className="text-[12px] font-medium text-danger">自动化状态读取失败</p>
          <p className="mt-1 text-[11px] leading-relaxed text-secondary">
            {loadError}
            {status === null ? '' : '；下方内容可能不是最新。'}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            data-testid="automation-load-retry"
            onClick={() => void refresh()}
          >
            重试
          </Button>
        </div>
      )}
      {status === null ? null : (
        <>
          <LocalControlCard
            status={status}
            budget={budget}
            busy={busy}
            copiedKey={copiedKey}
            copy={copy}
            onStatusChange={setStatus}
            onBudgetChange={setBudget}
            runExclusive={runExclusive}
          />
          <IntegrationGuide
            integration={integration}
            busy={busy}
            copiedKey={copiedKey}
            copy={copy}
            runExclusive={runExclusive}
            onIntegrationChange={setIntegration}
          />
          <AutomationAuditList audit={audit} onRefresh={() => void refresh()} />
        </>
      )}
    </>
  );
}
