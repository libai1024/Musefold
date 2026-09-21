'use client';

import {
  AUTOMATION_CONFIRMATION_TIMEOUT_MS,
  type AutomationConfirmationSummary,
} from '@musefold/contracts';
import { useCapabilities, useGateway } from '@musefold/platform';
import { useCallback, useEffect, useState } from 'react';

/** 队列项 = 主进程摘要 + 收卡时刻推导出的截止时刻(主进程广播不带截止时刻)。 */
export interface AutomationConfirmationItem {
  summary: AutomationConfirmationSummary;
  /** epoch ms;到点即视为拒绝并撤卡,与主进程 409 CONFIRMATION_TIMEOUT 同一口径。 */
  deadlineAt: number;
}

/**
 * 花钱动作确认队列(壳级确认卡的唯一状态源)。
 *
 * 语义要点(与主进程闸门对齐):
 * - `required` 入队,同 id 幂等(重复广播不会出现两张卡);
 * - `resolved` 出队 —— 确认可能被别的通道解决(HTTP 回执、终端确认、超时),
 *   卡片必须跟着撤,不能停在已经失效的请求上;
 * - 本地倒计时到点即出队:主进程那边此时已按超时拒绝,继续显示只会误导用户;
 * - 用户点「允许 / 拒绝」先乐观出队再回执 —— 花钱确认的手感必须是立即的,
 *   回执失败也不把卡片放回来(主进程已按超时处理,放回来等于给一张假卡)。
 *
 * 宿主不提供 `gateway.automation`(Web)时返回空队列且不订阅。
 */
export function useAutomationConfirmations() {
  const gateway = useGateway();
  const capabilities = useCapabilities();
  const automation = capabilities.hasLocalAutomation ? gateway.automation : undefined;
  const [queue, setQueue] = useState<AutomationConfirmationItem[]>([]);
  const [channelReady, setChannelReady] = useState(true);

  useEffect(() => {
    if (!automation) return;
    try {
      return automation.subscribeConfirmations((event) => {
        if (event.type === 'required') {
          setQueue((current) =>
            current.some((item) => item.summary.confirmationId === event.summary.confirmationId)
              ? current
              : [
                  ...current,
                  {
                    summary: event.summary,
                    deadlineAt: Date.now() + AUTOMATION_CONFIRMATION_TIMEOUT_MS,
                  },
                ],
          );
          return;
        }
        setQueue((current) =>
          current.filter((item) => item.summary.confirmationId !== event.resolved.confirmationId),
        );
      });
    } catch {
      // 宿主声称有开放能力却没有事件通道(preload 与渲染层版本错配)时降级而不是炸壳:
      // 收不到确认请求 = 闸门那边会按超时**拒绝**,默认仍是不花钱,可以安全降级。
      setChannelReady(false);
      return;
    }
  }, [automation]);

  const dismiss = useCallback((confirmationId: string) => {
    setQueue((current) => current.filter((item) => item.summary.confirmationId !== confirmationId));
  }, []);

  const resolve = useCallback(
    (confirmationId: string, approved: boolean) => {
      dismiss(confirmationId);
      if (!automation) return;
      void automation.resolveConfirmation({ confirmationId, approved }).catch(() => {
        // 回执失败(确认已超时/已被别的通道解决)对用户没有可执行动作,静默即可。
      });
    },
    [automation, dismiss],
  );

  return {
    /** 当前排队的确认(先到先显示);Web 宿主恒为空。 */
    queue,
    /** 是否有可用的确认通道(false 时卡片渲染 null)。 */
    available: Boolean(automation) && channelReady,
    resolve,
    /** 超时撤卡:只出队,不发回执(主进程已按超时拒绝)。 */
    dismiss,
  };
}
