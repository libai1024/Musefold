import { LogOut } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import { AccountSummaryPanel, type AccountSummaryViewModel } from "./AccountSummaryPanel";

export interface AccountScreenProps {
  account: AccountSummaryViewModel;
  description?: string;
  onLogout: () => Promise<void>;
  showHeading?: boolean;
  className?: string;
  testId?: string;
}

/** Cloud account page. Host adapters provide the session and logout action. */
export function AccountScreen({
  account,
  description = "个人账户与生图额度",
  onLogout,
  showHeading = true,
  className,
  testId,
}: AccountScreenProps) {
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
      <AccountSummaryPanel
        testId="account-summary-panel"
        account={account}
        footer={(
          <Button
            variant="secondary"
            className="mf-account-button mf-account-button-secondary mf-account-logout"
            onClick={() => void onLogout()}
            icon={<LogOut aria-hidden="true" />}
          >
            退出登录
          </Button>
        )}
      />
    </section>
  );
}
