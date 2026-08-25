import { formatAccountPoints } from '@musefold/domain';
import { AccountScreen } from '@musefold/product-ui';
import type { AccountSession } from '@musefold/contracts';
import type { WebGateway } from '../runtime';

export function AccountView({
  gateway,
  session,
  onLoggedOut,
  embedded = false,
  showHeading = true,
}: {
  gateway: WebGateway;
  session: AccountSession;
  onLoggedOut: () => void;
  embedded?: boolean;
  showHeading?: boolean;
}) {
  const screen = (
    <AccountScreen
      testId="account-screen"
      account={{
        name: session.account.displayName ?? session.account.username,
        username: session.account.username,
        avatarLabel: (session.account.displayName ?? session.account.username).slice(0, 1),
        quotaLabel: `${formatAccountPoints(session.account.quota)} 积分`,
        generationStatusLabel: session.account.canGenerate ? '可用' : '额度不足',
        generationAvailable: session.account.canGenerate,
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
