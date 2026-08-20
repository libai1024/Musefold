// 外部 Agent 生成确认卡（策略闸门分支 c，V04-API-03）。
// 右下角非阻塞卡片：展示 Provider/模型/张数/预估成本，允许/拒绝即回执；
// 若同一确认被 HTTP 回执或超时解决，卡片随 resolved 事件自动关闭。
import { useEffect, useState } from 'react';
import type { AutomationConfirmationSummary } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { displayModelName } from '../../lib/model-catalog';

export function AutomationConfirmCard() {
  const [queue, setQueue] = useState<AutomationConfirmationSummary[]>([]);

  useEffect(() => {
    const offRequired = api.automation.onConfirmationRequired((summary) => {
      setQueue((current) =>
        current.some((item) => item.confirmationId === summary.confirmationId) ? current : [...current, summary],
      );
    });
    const offResolved = api.automation.onConfirmationResolved(({ confirmationId }) => {
      setQueue((current) => current.filter((item) => item.confirmationId !== confirmationId));
    });
    return () => {
      offRequired();
      offResolved();
    };
  }, []);

  const answer = async (confirmationId: string, approved: boolean) => {
    setQueue((current) => current.filter((item) => item.confirmationId !== confirmationId));
    await api.automation.confirm(confirmationId, approved);
  };

  if (queue.length === 0) return null;
  const active = queue[0];
  const cost =
    active.estimatedPoints != null ? `预估 ${active.estimatedPoints} 积分` : '成本未知';

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] rounded-xl border border-border-default bg-popover p-4 shadow-pop animate-scale-fade-in"
      data-testid="automation-confirm-card"
      role="alertdialog"
      aria-label="外部生成请求确认"
    >
      <p className="text-[12.5px] font-semibold text-primary">外部 Agent 请求生成图片</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-tertiary">
        {active.providerName} · {displayModelName(active.model)} · {active.n} 张 · {cost}
      </p>
      <p className="mt-2 line-clamp-3 rounded bg-inset px-2 py-1.5 font-mono text-[11px] text-secondary">
        {active.promptPreview}
      </p>
      {queue.length > 1 && (
        <p className="mt-1.5 text-[10.5px] text-quaternary">还有 {queue.length - 1} 个等待确认</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          data-testid="automation-confirm-deny"
          onClick={() => void answer(active.confirmationId, false)}
          className="no-drag rounded-md border border-border-default px-3 py-1.5 text-[12px] text-secondary transition-colors hover:bg-hover hover:text-primary"
        >
          拒绝
        </button>
        <button
          type="button"
          data-testid="automation-confirm-approve"
          onClick={() => void answer(active.confirmationId, true)}
          className="no-drag rounded-md bg-[var(--accent-solid)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          允许生成
        </button>
      </div>
    </div>
  );
}
