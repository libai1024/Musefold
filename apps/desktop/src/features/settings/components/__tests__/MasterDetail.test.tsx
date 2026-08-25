import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MasterDetail, MasterDetailItem, InlineConfirm, PanelActions } from '../MasterDetail';

describe('MasterDetail(RELAY-SETTINGS-UI 第二步)', () => {
  it('renders rail items with status dot, default badge and selected state', () => {
    const html = renderToStaticMarkup(
      <MasterDetail
        rail={
          <>
            <MasterDetailItem
              icon={<span>ic</span>}
              title="TvT"
              statusDot={{ tone: 'success', label: '测试通过' }}
              active
              selected
              onClick={() => undefined}
              testId="settings-provider-row-p1"
            />
            <MasterDetailItem
              icon={<span>ic</span>}
              title="TvT 备用"
              statusDot={{ tone: 'warning', label: '缺少密钥' }}
              active={false}
              selected={false}
              onClick={() => undefined}
              testId="settings-provider-row-p2"
            />
          </>
        }
      >
        <div>detail</div>
      </MasterDetail>,
    );

    // 分栏容器 + 左栏行
    expect(html).toContain('settings-md');
    expect(html).toContain('settings-md-rail');
    expect(html).toContain('settings-md-detail');
    // 选中态:data-active + aria-current
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-current="true"');
    // 状态点:tone 挂在 data-tone,a11y 走 sr-only + title,testid 派生 {row}-status
    expect(html).toContain('data-testid="settings-provider-row-p1-status"');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('sr-only');
    // 默认徽标使用中性状态类,而非反相黑块
    expect(html).toContain('settings-md-default-badge');
  });

  it('groups danger and primary actions for narrow layout wrapping', () => {
    const html = renderToStaticMarkup(
      <PanelActions
        dirty
        danger={<span>danger</span>}
        onDiscard={() => undefined}
        discardLabel="放弃"
        onTest={() => undefined}
        testLabel="测试连接"
        onSave={() => undefined}
        saveLabel="保存"
      />,
    );

    expect(html).toContain('settings-md-danger-slot');
    expect(html).toContain('settings-md-action-group');
    expect(html).toContain('settings-panel-dirty');
  });

  it('keeps InlineConfirm as the shared second-confirm for destructive actions', () => {
    const html = renderToStaticMarkup(
      <InlineConfirm
        label="确认删除?"
        confirmLabel="删除"
        danger
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('确认删除?');
    expect(html).toContain('删除');
    expect(html).toContain('取消');
  });
});
