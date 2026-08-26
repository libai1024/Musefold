import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WebGatewayError } from '../../runtime';
import { AccountView, accountActionErrorMessage } from '../AccountView';

const account = {
  id: 'account-1',
  username: 'musefold',
  displayName: '未像用户',
  quota: 9_300_000,
  quotaUnit: '点',
  canGenerate: true,
};

describe('AccountView', () => {
  it('renders the current account from props and forwards account actions', () => {
    const html = renderToStaticMarkup(
      <AccountView
        account={account}
        dataSourceLabel="Musefold Cloud"
        onRedeem={async () => 500_000}
        onRefresh={async () => undefined}
        onLogout={async () => undefined}
        embedded
        showHeading={false}
      />,
    );

    expect(html).toContain('未像用户');
    expect(html).toContain('186 积分');
    expect(html).toContain('Musefold Cloud');
    expect(html).toContain('name="redeemCode"');
    expect(html).toContain('刷新账户');
  });

  it('maps upstream failures to fixed safe copy', () => {
    expect(
      accountActionErrorMessage(
        new WebGatewayError('ACCOUNT_REDEEM_INVALID', 'sensitive upstream detail'),
        'redeem',
      ),
    ).toBe('兑换码无效或已使用，请检查后重试');
    expect(
      accountActionErrorMessage(new Error('sensitive upstream detail'), 'refresh'),
    ).toBe('刷新失败，请稍后重试');
    expect(accountActionErrorMessage(new WebGatewayError('RATE_LIMITED', '10s'), 'redeem')).toBe(
      '操作过于频繁，请稍后再试',
    );
  });
});
