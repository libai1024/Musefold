import { formatAccountPoints } from '@musefold/domain';
import { AccountScreen } from '@musefold/product-ui';
import type { AccountSession } from '@musefold/contracts';
import type { WebGateway } from '../runtime';

export function AccountView({
  gateway,
  session,
  onLoggedOut,
}: {
  gateway: WebGateway;
  session: AccountSession;
  onLoggedOut: () => void;
}) {
  return (
    <div className="page">
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
      />
    </div>
  );
}
