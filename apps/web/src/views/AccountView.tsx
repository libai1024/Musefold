import { formatAccountPoints } from '@musefold/domain';
import { AccountScreen, type AccountActionFeedback } from '@musefold/product-ui';
import type { AccountSummary } from '@musefold/contracts';
import { WebGatewayError } from '../runtime';

export function accountActionErrorMessage(cause: unknown, action: 'redeem' | 'refresh'): string {
  if (!(cause instanceof WebGatewayError)) {
    return action === 'redeem' ? '兑换失败，请稍后重试' : '刷新失败，请稍后重试';
  }

  switch (cause.code) {
    case 'ACCOUNT_REDEEM_INVALID':
    case 'VALIDATION_FAILED':
      return action === 'redeem' ? '兑换码无效或已使用，请检查后重试' : '刷新失败，请稍后重试';
    case 'RATE_LIMITED':
      return '操作过于频繁，请稍后再试';
    case 'AUTH_REQUIRED':
    case 'AUTH_SESSION_EXPIRED':
      return '登录状态已失效，请重新登录';
    default:
      return action === 'redeem' ? '兑换服务暂时不可用，请稍后重试' : '刷新失败，请稍后重试';
  }
}

export function AccountView({
  account,
  dataSourceLabel,
  onRedeem,
  onRefresh,
  onLogout,
  redeemBusy = false,
  refreshBusy = false,
  embedded = false,
  showHeading = true,
}: {
  account: AccountSummary;
  dataSourceLabel: string;
  onRedeem: (code: string) => Promise<number>;
  onRefresh: () => Promise<unknown>;
  onLogout: () => Promise<void>;
  redeemBusy?: boolean;
  refreshBusy?: boolean;
  embedded?: boolean;
  showHeading?: boolean;
}) {
  const redeem = async (code: string): Promise<AccountActionFeedback> => {
    try {
      const creditedQuota = await onRedeem(code);
      return {
        tone: 'success',
        message: `兑换成功，${formatAccountPoints(creditedQuota)} 积分已到账`,
      };
    } catch (cause) {
      return { tone: 'error', message: accountActionErrorMessage(cause, 'redeem') };
    }
  };

  const refresh = async (): Promise<AccountActionFeedback> => {
    try {
      await onRefresh();
      return { tone: 'success', message: '账户信息已刷新' };
    } catch (cause) {
      return { tone: 'error', message: accountActionErrorMessage(cause, 'refresh') };
    }
  };

  const screen = (
    <AccountScreen
      testId="account-screen"
      account={{
        name: account.displayName ?? account.username,
        username: account.username,
        avatarLabel: (account.displayName ?? account.username).slice(0, 1),
        quotaLabel: `${formatAccountPoints(account.quota)} 积分`,
        generationStatusLabel: account.canGenerate ? '可用' : '额度不足',
        generationAvailable: account.canGenerate,
        dataSourceLabel,
      }}
      onRedeem={redeem}
      onRefresh={refresh}
      onLogout={onLogout}
      redeemBusy={redeemBusy}
      refreshBusy={refreshBusy}
      showHeading={showHeading}
    />
  );

  if (embedded) return screen;

  return (
    <div className="page min-h-0 min-w-0 flex-1 overflow-y-auto px-[24px] pt-[20px] pb-[48px]">
      {screen}
    </div>
  );
}
