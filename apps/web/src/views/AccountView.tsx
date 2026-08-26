import { formatAccountPoints } from '@musefold/domain';
import { AccountScreen } from '@musefold/product-ui';
import type { AccountSummary } from '@musefold/contracts';
import type { WebGateway } from '../runtime';

export function AccountView({
  gateway,
  account,
  onLoggedOut,
  embedded = false,
  showHeading = true,
}: {
  gateway: WebGateway;
  account: AccountSummary;
  onLoggedOut: () => void;
  embedded?: boolean;
  showHeading?: boolean;
}) {
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
        dataSourceLabel: gateway.mode === 'fixture' ? '开发预览' : 'Musefold Cloud',
      }}
      onLogout={async () => {
        await gateway.logout();
        onLoggedOut();
      }}
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
