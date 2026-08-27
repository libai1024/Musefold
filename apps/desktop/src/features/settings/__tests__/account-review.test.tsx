// 设置 → 账号评审改进（docs/research/settings-review/01-account.md）的就地门禁。
// 行为类断言用 renderToStaticMarkup；纯文案/结构约定沿用本目录既有的源码契约风格。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountStatus } from '@musefold/desktop-contracts/account';
import { AccountSignedOutForm } from '../components/AccountSignedOutForm';
import type { AuthMode } from '../components/account-section-helpers';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(dir, '../components', name), 'utf8');

const signedOutForm = read('AccountSignedOutForm.tsx');
const signedInPanel = read('AccountSignedInPanel.tsx');
const cloudSyncPanel = read('AccountCloudSyncPanel.tsx');
const doubao = read('DoubaoSection.tsx');
const section = read('AccountSection.tsx');
const sectionHost = read('AccountSettingsSection.tsx');
const settingsCss = readFileSync('apps/desktop/src/styles/settings.css', 'utf8');
const summaryPanel = readFileSync(
  'packages/product-ui/src/account/AccountSummaryPanel.tsx',
  'utf8',
);

const CURLY_QUOTES = /[\u201C\u201D\u2018\u2019]/;

describe('settings account review fixes', () => {
  it('labels the busy auth button with the action actually in flight', () => {
    const renderBusy = (mode: AuthMode) =>
      renderToStaticMarkup(
        <AccountSignedOutForm
          mode={mode}
          setMode={() => {}}
          username="e2euser"
          setUsername={() => {}}
          password="Password123"
          setPassword={() => {}}
          confirmPassword="Password123"
          setConfirmPassword={() => {}}
          error={null}
          isAuthBusy
          action={mode === 'login' ? 'login' : 'register'}
          status={signedOutStatus}
          serverEditing={false}
          setServerEditing={() => {}}
          serverUrl="https://example.com"
          setServerUrlInput={() => {}}
          clearError={() => {}}
          submitAuth={async () => {}}
          setServerUrl={async () => {}}
        />,
      );

    expect(renderBusy('login')).toContain('登录中…');
    const registerHtml = renderBusy('register');
    expect(registerHtml).toContain('注册中…');
    for (const html of [renderBusy('login'), registerHtml]) {
      expect(html).not.toContain('正在配置模型');
    }
  });

  it('does not promise admin-driven or nonexistent password recovery', () => {
    expect(signedOutForm).not.toContain('联系管理员');
    expect(signedOutForm).not.toContain('忘记密码');
  });

  it('names the account row by its field and shows the username as the value', () => {
    expect(signedInPanel).toContain('label="当前账号"');
    expect(signedInPanel).not.toContain('hint="当前账号"');
  });

  it('unifies the account section width and card geometry', () => {
    expect(sectionHost).toContain('className="settings-account-section"');
    // 登录表单卡不再单独限宽 520，与分区 680 内容栏对齐
    expect(signedOutForm).not.toContain('max-w-[520px]');
    expect(settingsCss).toContain('.mf-settings-section.settings-account-section');
    expect(settingsCss).toMatch(
      /\.settings-account-section \.mf-account-surface \{[\s\S]*?box-shadow: var\(--shadow-sm\);/,
    );
  });

  it('keeps switch names stable instead of flipping with state', () => {
    expect(cloudSyncPanel).toContain('label="提示词云同步"');
    expect(cloudSyncPanel).not.toContain('关闭提示词云同步');
    expect(cloudSyncPanel).not.toContain('启用提示词云同步');
    expect(doubao).toContain('label="豆包前台"');
    expect(doubao).not.toContain('隐藏豆包前台');
    expect(doubao).not.toContain('显示豆包前台');
  });

  it('uses semantic state icons for the doubao login status', () => {
    expect(doubao).toContain('CheckCircle2');
    expect(doubao).toContain("loginState === 'verification-required' ? (");
    // QrCode 仍用于未登录/待扫码态与扫码入口，但不再作为已登录状态指示
    expect(doubao).not.toMatch(/<QrCode[^>]*\/>\s*\{loginState === 'logged-in'/);
  });

  it('collapses the doubao footnote to one line with an explicit expander', () => {
    expect(doubao).toContain("'查看限制说明'");
    expect(doubao).toContain("'收起限制说明'");
    expect(doubao).toContain('aria-expanded={limitsExpanded}');
    // 展开区保留接入模式承诺句（model-hub 契约同款断言）
    expect(doubao).toContain('登录与验证不会改变当前接入模式');
  });

  it('renders both account-page warnings through the same bordered presentation', () => {
    expect(cloudSyncPanel).toContain('<InlineMessage tone="warning"');
    expect(doubao).toContain('<InlineMessage tone="warning"');
    expect(doubao).not.toContain('bg-warning/5');
  });

  it('merges the managed model facts into the account overview', () => {
    expect(signedInPanel).not.toContain('账号内置模型');
    expect(signedInPanel).not.toContain('account-managed-models');
    expect(signedInPanel).toContain('extraFacts: managedModelFacts');
    expect(signedInPanel).toContain("label: '生图模型'");
    expect(signedInPanel).toContain("label: 'Agent 模型'");
    expect(summaryPanel).toContain('extraFacts');
  });

  it('surfaces a visible error when register passwords mismatch', () => {
    expect(section).toContain('两次输入的密码不一致，请检查后重试');
    expect(section).toContain('error={formError ? { message: formError } : error}');
    expect(section).not.toMatch(/password !== confirmPassword\) return;/);
  });

  it('uses corner quotes consistently across the account page', () => {
    for (const source of [signedOutForm, signedInPanel, cloudSyncPanel, doubao, section]) {
      expect(source, 'curly quotes must not appear on the account page').not.toMatch(
        CURLY_QUOTES,
      );
    }
  });
});

const signedOutStatus: AccountStatus = {
  loggedIn: false,
  userId: null,
  username: null,
  serverUrl: 'https://example.com',
  isDefaultServer: true,
  quota: null,
  estImagesRemaining: null,
  deviceTokenSuffix: null,
  health: 'ok',
  notices: [],
};
