import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Input } from "@musefold/ui";
import { BadgeCheck, LogOut, RefreshCw } from "@musefold/ui/icons";
import { AccountSummaryPanel, type AccountSummaryViewModel } from "./AccountSummaryPanel";

export interface AccountActionFeedback {
  tone: "success" | "error";
  message: string;
}

export interface AccountScreenProps {
  account: AccountSummaryViewModel;
  description?: string;
  onRedeem: (code: string) => Promise<AccountActionFeedback>;
  onRefresh: () => Promise<AccountActionFeedback | void>;
  onLogout?: () => Promise<void>;
  redeemBusy?: boolean;
  refreshBusy?: boolean;
  overviewAccessory?: ReactNode;
  extensions?: ReactNode;
  logoutAction?: ReactNode;
  showHeading?: boolean;
  className?: string;
  testId?: string;
}

/** Shared account surface. Hosts own server state and adapt actions to safe feedback. */
export function AccountScreen({
  account,
  description = "个人账户与生图额度",
  onRedeem,
  onRefresh,
  onLogout,
  redeemBusy = false,
  refreshBusy = false,
  overviewAccessory,
  extensions,
  logoutAction,
  showHeading = true,
  className,
  testId,
}: AccountScreenProps) {
  const [redeemCode, setRedeemCode] = useState("");
  const [feedback, setFeedback] = useState<AccountActionFeedback | null>(null);
  const accountBusy = redeemBusy || refreshBusy;

  const submitRedeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = redeemCode.trim();
    if (!code || accountBusy) return;

    setFeedback(null);
    try {
      const nextFeedback = await onRedeem(code);
      setFeedback(nextFeedback);
      if (nextFeedback.tone === "success") setRedeemCode("");
    } catch {
      setFeedback({ tone: "error", message: "兑换失败，请稍后重试" });
    }
  };

  const refreshAccount = async () => {
    if (accountBusy) return;

    setFeedback(null);
    try {
      const nextFeedback = await onRefresh();
      setFeedback(nextFeedback ?? { tone: "success", message: "账户信息已刷新" });
    } catch {
      setFeedback({ tone: "error", message: "刷新失败，请稍后重试" });
    }
  };

  return (
    <section
      className={`mf-account-screen${className ? ` ${className}` : ""}`}
      data-testid={testId}
    >
      {showHeading ? (
        <header className="mf-account-screen-heading">
          <h1>账户</h1>
          <p>{description}</p>
        </header>
      ) : null}

      <section className="mf-account-surface" aria-labelledby="account-overview-title">
        <header className="mf-account-surface-heading">
          <div>
            <h2 id="account-overview-title">账户概览</h2>
            <p>身份、额度、生图可用性与数据来源</p>
          </div>
          {overviewAccessory ? (
            <div className="mf-account-overview-accessory">{overviewAccessory}</div>
          ) : null}
        </header>
        <AccountSummaryPanel
          testId="account-summary-panel"
          account={account}
          headerAction={(
            <Button
              variant="secondary"
              className="mf-account-button mf-account-button-secondary mf-account-refresh"
              onClick={() => void refreshAccount()}
              disabled={redeemBusy}
              busy={refreshBusy}
              busyLabel="刷新中"
              icon={<RefreshCw aria-hidden="true" />}
            >
              刷新账户
            </Button>
          )}
        />
      </section>

      <section className="mf-account-surface mf-account-redeem" aria-labelledby="account-redeem-title">
        <header className="mf-account-surface-heading">
          <div>
            <h2 id="account-redeem-title">额度与兑换</h2>
            <p>兑换成功后会立即刷新当前账户额度</p>
          </div>
        </header>
        <form className="mf-account-redeem-form" autoComplete="off" onSubmit={submitRedeem}>
          <label htmlFor="account-redeem-code">兑换码</label>
          <div className="mf-account-redeem-controls">
            <Input
              id="account-redeem-code"
              name="redeemCode"
              value={redeemCode}
              onChange={(event) => {
                setRedeemCode(event.target.value);
                setFeedback(null);
              }}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              placeholder="输入兑换码"
              mono
            />
            <Button
              type="submit"
              className="mf-account-button mf-account-redeem-submit"
              disabled={!redeemCode.trim() || refreshBusy}
              busy={redeemBusy}
              busyLabel="兑换中"
              icon={<BadgeCheck aria-hidden="true" />}
            >
              兑换
            </Button>
          </div>
          <p className="mf-account-redeem-hint">兑换码不会保存到设备或账户资料。</p>
          {feedback ? (
            <p
              className="mf-account-feedback"
              data-tone={feedback.tone}
              role={feedback.tone === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </section>

      {extensions ? <div className="mf-account-extensions">{extensions}</div> : null}

      {logoutAction ??
        (onLogout ? (
          <div className="mf-account-session-actions">
            <Button
              variant="secondary"
              className="mf-account-button mf-account-button-secondary mf-account-logout"
              onClick={() => void onLogout()}
              icon={<LogOut aria-hidden="true" />}
            >
              退出登录
            </Button>
          </div>
        ) : null)}
    </section>
  );
}
