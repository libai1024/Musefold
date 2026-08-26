import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserRound } from '@musefold/ui/icons';
import {
  SettingsWorkspace,
  filterSettingsNavigationGroups,
  type SettingsNavigationGroup,
} from '../SettingsWorkspace';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSwitch,
  SettingsCheckbox,
} from '../SettingsComponents';

const groups: SettingsNavigationGroup[] = [
  {
    id: 'account',
    label: '账户与连接',
    icon: <UserRound />,
    items: [
      { id: 'profile', label: 'Musefold 账号', icon: <UserRound />, keywords: ['额度', '登录'] },
      { id: 'connections', label: '已连接应用', icon: <UserRound />, keywords: ['MCP', '授权'] },
    ],
  },
];

describe('SettingsWorkspace', () => {
  it('filters navigation by labels and setting keywords', () => {
    expect(filterSettingsNavigationGroups(groups, '额度')[0]?.items.map((item) => item.id)).toEqual(
      ['profile'],
    );
    expect(filterSettingsNavigationGroups(groups, 'mcp')[0]?.items.map((item) => item.id)).toEqual([
      'connections',
    ]);
    expect(filterSettingsNavigationGroups(groups, '不存在')).toEqual([]);
  });

  it('offers an explicit way to clear a non-empty settings search', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        groups={groups}
        activeSection="profile"
        onSectionChange={() => undefined}
        searchValue="额度"
        onSearchChange={() => undefined}
      >
        <div />
      </SettingsWorkspace>,
    );

    expect(html).toContain('aria-label="清空设置搜索"');
    expect(html).toContain('value="额度"');
  });

  it('renders a controlled, platform-neutral settings workspace', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        groups={groups}
        activeSection="connections"
        onSectionChange={() => undefined}
        searchValue=""
        onSearchChange={() => undefined}
        headerAction={<button type="button">返回工作区</button>}
      >
        <div>真实宿主内容</div>
      </SettingsWorkspace>,
    );

    expect(html).toContain('data-ui-register="operate"');
    expect(html).toContain('aria-label="设置分区"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="settings-compact-header"');
    expect(html).toContain('data-testid="settings-compact-search"');
    expect(html).toContain('data-testid="settings-navigation-page"');
    expect(html).toContain('data-testid="settings-phone-header"');
    expect(html).toContain('返回设置');
    expect(html).toContain('class="mf-settings-pane"');
    expect(html).not.toContain('<main');
    expect(html).toContain('真实宿主内容');
    expect(html).not.toContain('localStorage');
  });

  it('keeps group headings textual while retaining navigation item icons', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        groups={[
          {
            id: 'appearance',
            label: '外观',
            icon: <span data-testid="settings-group-icon">group icon</span>,
            items: [
              {
                id: 'theme',
                label: '主题',
                icon: <span data-testid="settings-item-icon">item icon</span>,
              },
            ],
          },
        ]}
        activeSection="theme"
        onSectionChange={() => undefined}
        searchValue=""
        onSearchChange={() => undefined}
      >
        <div />
      </SettingsWorkspace>,
    );

    expect(html).not.toContain('settings-group-icon');
    expect(html).toContain('settings-item-icon');
  });

  it('renders the shared v1.4.1 settings component contract', () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="外观" description="自定义界面外观">
        <SettingsCard title="界面设置" description="设置主题和界面密度">
          <SettingsRow label="界面密度" hint="紧凑模式显示更多内容">
            <SettingsSegmentedControl
              value="compact"
              options={[
                { value: 'comfortable', label: '舒适' },
                { value: 'compact', label: '紧凑' },
              ]}
              onChange={() => undefined}
              ariaLabel="界面密度"
            />
          </SettingsRow>
          <SettingsRow label="减少动效">
            <SettingsSwitch checked onCheckedChange={() => undefined} label="减少动效" />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>,
    );

    expect(html).toContain('class="mf-settings-section"');
    expect(html).toContain('class="mf-settings-card"');
    expect(html).toContain('class="mf-settings-row"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('mf-settings-switch');
    expect(html).toContain('mf-ui-switch');
    expect(html).toContain('role="switch"');
  });

  it('keeps checkbox semantics native while sharing the settings surface', () => {
    const html = renderToStaticMarkup(
      <SettingsCheckbox
        checked={false}
        onCheckedChange={() => undefined}
        label="包含生成历史"
        description="历史含提示词快照与成本。"
        testId="settings-checkbox"
      />,
    );

    expect(html).toContain('class="mf-settings-checkbox"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('data-testid="settings-checkbox"');
    expect(html).toContain('历史含提示词快照与成本。');
  });
});
