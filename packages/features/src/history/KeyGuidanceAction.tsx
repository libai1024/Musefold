'use client';

import { openConnectionsSettings, useScreenIntent } from '../shell/screen-intent-store';
import { isSettingsGuidance, type HistoryErrorGuidance } from './error';
import { rememberQuotaRecovery } from './spend-recovery-store';

export function KeyGuidanceAction({
  guidance,
  onOpenSettings,
  testId,
  recoveryJobId,
}: {
  guidance: HistoryErrorGuidance;
  onOpenSettings?: () => void;
  testId: string;
  /** 额度失败的既有 job:点「去兑换」后,兑换成功走 generation.retry。 */
  recoveryJobId?: string;
}) {
  if (!guidance.action) return null;
  if (!isSettingsGuidance(guidance.actionKind)) {
    return (
      <p className="font-medium text-[11px] text-foreground" data-testid={testId}>
        建议:{guidance.action}
      </p>
    );
  }
  return (
    <button
      type="button"
      className="w-fit font-medium text-[11px] text-primary underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
      data-testid={testId}
      disabled={!onOpenSettings}
      onClick={() => {
        if (guidance.actionKind === 'top_up' || guidance.actionKind === 'sign_in') {
          if (guidance.actionKind === 'top_up' && recoveryJobId) {
            rememberQuotaRecovery({ kind: 'retry-job', jobId: recoveryJobId });
          }
          useScreenIntent.getState().setIntent({
            kind: 'settings-section',
            section: 'account',
          });
          onOpenSettings?.();
          return;
        }
        openConnectionsSettings(onOpenSettings);
      }}
    >
      {guidance.action}
    </button>
  );
}
