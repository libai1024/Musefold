import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountScreen } from '../AccountScreen';

const account = {
  name: '未像用户',
  username: 'musefold',
  avatarLabel: '未',
  quotaLabel: '120 积分',
  quotaHint: '约可生成 3 张',
  generationStatusLabel: '可用',
  generationAvailable: true,
  dataSourceLabel: 'Musefold Cloud',
};

describe('AccountScreen', () => {
  it('renders the shared summary and semantic redeem controls', () => {
    const html = renderToStaticMarkup(
      <AccountScreen
        account={account}
        onRedeem={async () => ({ tone: 'success', message: '兑换成功' })}
        onRefresh={async () => undefined}
        onLogout={async () => undefined}
        extensions={<section data-testid="desktop-account-extension">桌面扩展</section>}
        testId="account-screen"
      />,
    );

    expect(html).toContain('data-testid="account-screen"');
    expect(html).toContain('data-testid="account-summary-panel"');
    expect(html).toContain('<form class="mf-account-redeem-form" autoComplete="off"');
    expect(html).toContain('<label for="account-redeem-code">兑换码</label>');
    expect(html).toContain('name="redeemCode"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('刷新账户');
    expect(html).toContain('兑换码不会保存到设备或账户资料');
    expect(html).toContain('data-testid="desktop-account-extension"');
  });

  it('exposes shared busy states without storing an account copy', () => {
    const html = renderToStaticMarkup(
      <AccountScreen
        account={account}
        onRedeem={async () => ({ tone: 'success', message: '兑换成功' })}
        onRefresh={async () => undefined}
        redeemBusy
        refreshBusy
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('刷新中');
    expect(html).toContain('兑换中');
    expect(html).toContain('disabled=""');
  });
});
