// History 失败记录的展示与重试策略 —— 复用 shared/errors 的统一错误码映射。

import {
  errorGuidance,
  toErrorCode,
  type ErrorAction,
  type ErrorGuidance,
} from '@shared/errors';

export interface HistoryErrorPresentation extends ErrorGuidance {
  /** UNKNOWN 时保留原始错误信息，避免把诊断线索吞掉。 */
  displayTitle: string;
  /** 只有 guidance 明确提供 retry 动作时才允许手动重试。 */
  canRetry: boolean;
  /** 面板上显示的首个建议动作。 */
  primaryAction: ErrorAction | null;
}

export function historyErrorPresentation(
  code?: string | null,
  message?: string | null,
): HistoryErrorPresentation {
  const guidance = errorGuidance(code);
  const rawMessage = message?.trim();
  const isUnknown = toErrorCode(code) === 'UNKNOWN';
  const primaryAction = guidance.actions[0] ?? null;

  return {
    ...guidance,
    displayTitle: isUnknown && rawMessage ? rawMessage : guidance.title,
    canRetry: guidance.actions.some((action) => action.kind === 'retry'),
    primaryAction,
  };
}
