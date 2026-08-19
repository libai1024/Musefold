import type { ReactNode } from "react";

export interface AccountSummaryViewModel {
  name: string;
  username: string;
  avatarLabel: string;
  quotaLabel: string;
  quotaHint?: string | null;
  generationStatusLabel: string;
  generationAvailable: boolean;
  dataSourceLabel: string;
}

export interface AccountSummaryPanelProps {
  account: AccountSummaryViewModel;
  headerAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}

/** Shared identity, quota and availability summary for Desktop and Web. */
export function AccountSummaryPanel({
  account,
  headerAction,
  footer,
  className,
  testId,
}: AccountSummaryPanelProps) {
  return (
    <section
      className={`mf-account-summary-panel${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      <div className="mf-account-summary-identity">
        <span className="mf-account-summary-avatar" aria-hidden="true">
          {account.avatarLabel}
        </span>
        <div>
          <h2>{account.name}</h2>
          <p>@{account.username}</p>
        </div>
        {headerAction ? (
          <div className="mf-account-summary-header-action">{headerAction}</div>
        ) : null}
      </div>
      <dl className="mf-account-summary-facts">
        <div>
          <dt>可用额度</dt>
          <dd>{account.quotaLabel}</dd>
          {account.quotaHint ? <small>{account.quotaHint}</small> : null}
        </div>
        <div>
          <dt>生图状态</dt>
          <dd>
            <span
              className="mf-account-summary-status-dot"
              data-available={account.generationAvailable}
              aria-hidden="true"
            />
            {account.generationStatusLabel}
          </dd>
        </div>
        <div>
          <dt>数据源</dt>
          <dd>{account.dataSourceLabel}</dd>
        </div>
      </dl>
      {footer ? <div className="mf-account-summary-footer">{footer}</div> : null}
    </section>
  );
}
