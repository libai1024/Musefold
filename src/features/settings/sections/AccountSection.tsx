// 设置 → 账号（v0.5，CODEX 极简风）
// 纯边线 + 留白 + 排版承重；无阴影/渐变/装饰插图；所有动作 pill 几何。

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ACCOUNT_DEFAULT_IMAGE_MODEL, ACCOUNT_DEFAULT_TEXT_MODEL, ACCOUNT_QUOTA_PER_USD } from '@shared/constants';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { formatPoints } from '../../../lib/format';
import { displayModelName } from '../../../lib/model-catalog';
import { cn } from '../../../lib/utils';
import { useAccountStore } from '../../account/store';
import { SectionShell, SettingRow } from '../components/SectionShell';
import { useSettingsStore } from '../store';

type AuthMode = 'login' | 'register';
const NOTICE_READ_KEY = 'musefold:account-notices-read';

function initialReadNotices(): string[] {
  try {
    const value = localStorage.getItem(NOTICE_READ_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function points(value: number): string {
  return `${formatPoints(Math.max(0, value))} 积分`;
}

function healthLabel(health: ReturnType<typeof useAccountStore.getState>['status']['health']): string {
  if (health === 'ok') return '在线';
  if (health === 'token-invalid') return '登录已失效';
  if (health === 'unreachable') return '暂时离线';
  return '待确认';
}

export function AccountSection() {
  const status = useAccountStore((s) => s.status);
  const action = useAccountStore((s) => s.action);
  const error = useAccountStore((s) => s.error);
  const lastUsername = useAccountStore((s) => s.lastUsername);
  const login = useAccountStore((s) => s.login);
  const register = useAccountStore((s) => s.register);
  const logout = useAccountStore((s) => s.logout);
  const redeem = useAccountStore((s) => s.redeem);
  const refreshQuota = useAccountStore((s) => s.refreshQuota);
  const setServerUrl = useAccountStore((s) => s.setServerUrl);
  const clearError = useAccountStore((s) => s.clearError);
  const accountSetupRequest = useSettingsStore((s) => s.accountSetupRequest);
  const consumeAccountSetup = useSettingsStore((s) => s.consumeAccountSetup);

  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const [serverEditing, setServerEditing] = useState(false);
  const [serverUrl, setServerUrlInput] = useState(status.serverUrl);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [readNoticeIds, setReadNoticeIds] = useState<string[]>(initialReadNotices);

  const isAuthBusy = action === 'login' || action === 'register';
  // $1 按 ¥1 计费（积分 = 人民币 × 10），换算系数与美元锚定一致。
  const quotaCny = status.quota ? status.quota.value / ACCOUNT_QUOTA_PER_USD : null;
  const notices = useMemo(
    () => status.notices.filter((notice) => !readNoticeIds.includes(notice.id)).slice(0, 5),
    [readNoticeIds, status.notices],
  );

  useEffect(() => {
    if (status.loggedIn) void refreshQuota().catch(() => {});
    // 只在进入已登录态时刷新；余额变化由 account:changed 事件回填，避免循环请求。
  }, [refreshQuota, status.loggedIn]);

  // 登出 / 登录失效后回到表单时预填上次的用户名，重新登录只需输密码。
  useEffect(() => {
    if (!status.loggedIn && lastUsername) setUsername((current) => current || lastUsername);
  }, [lastUsername, status.loggedIn]);

  useEffect(() => {
    if (!accountSetupRequest) return;
    if (status.loggedIn) {
      consumeAccountSetup(accountSetupRequest.requestId);
      return;
    }
    setMode(accountSetupRequest.mode);
    clearError();
    const requestId = accountSetupRequest.requestId;
    requestAnimationFrame(() => {
      document.getElementById('account-username')?.focus();
      consumeAccountSetup(requestId);
    });
  }, [accountSetupRequest, clearError, consumeAccountSetup, status.loggedIn]);
  const markNoticeRead = (id: string) => {
    setReadNoticeIds((current) => {
      const next = [...new Set([...current, id])].slice(-100);
      try {
        localStorage.setItem(NOTICE_READ_KEY, JSON.stringify(next));
      } catch {
        /* 已读记忆是增强项，不阻塞界面 */
      }
      return next;
    });
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    clearError();
    if (mode === 'register' && password !== confirmPassword) return;
    try {
      if (mode === 'register') await register({ username, password });
      else await login({ username, password });
      setPassword('');
      setConfirmPassword('');
    } catch {
      setPassword('');
      setConfirmPassword('');
    }
  };

  const submitRedeem = async (event: FormEvent) => {
    event.preventDefault();
    setRedeemSuccess(null);
    try {
      const result = await redeem(redeemCode);
      setRedeemSuccess(`+${points(result.quotaAdded)}已到账，调用额度将在一分钟内生效`);
      setRedeemCode('');
    } catch {
      // store.error 负责行内呈现
    }
  };

  if (!status.loggedIn) {
    return (
      <SectionShell
        title="账号"
        description="一次登录，Agent 与生图模型自动配置。无需复制或管理 API Key。"
      >
        <div className="max-w-[420px]" data-testid="settings-account-signed-out">
          <div className="flex border-b border-border-subtle" role="tablist" aria-label="账号操作">
            {(['login', 'register'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => {
                  setMode(item);
                  clearError();
                }}
                className={cn(
                  'no-drag relative px-0 pb-2 pr-6 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                  mode === item ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-primary' : 'text-tertiary hover:text-primary',
                )}
              >
                {item === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form className="space-y-4 pt-5" onSubmit={submitAuth}>
            <Field label="用户名" htmlFor="account-username">
              <Input
                id="account-username"
                autoComplete="username"
                value={username}
                maxLength={12}
                onChange={(event) => setUsername(event.target.value)}
                className="h-9 rounded-full px-4 shadow-none"
                placeholder="3–12 个字符"
                required
              />
            </Field>
            <Field label="密码" htmlFor="account-password">
              <Input
                id="account-password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                className="h-9 rounded-full px-4 shadow-none"
                placeholder="至少 8 个字符"
                required
              />
            </Field>
            {mode === 'register' && (
              <Field label="确认密码" htmlFor="account-confirm-password">
                <Input
                  id="account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={Boolean(confirmPassword && confirmPassword !== password)}
                  className="h-9 rounded-full px-4 shadow-none"
                  required
                />
                {confirmPassword && confirmPassword !== password && (
                  <p className="mt-1 text-[11px] text-danger">两次输入的密码不一致</p>
                )}
              </Field>
            )}
            {error && <InlineMessage tone="danger">{error.message}</InlineMessage>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full rounded-full shadow-none"
              disabled={isAuthBusy || (mode === 'register' && confirmPassword !== password)}
              data-testid={`account-${mode}-submit`}
            >
              {isAuthBusy ? '正在配置模型…' : mode === 'login' ? '登录' : '注册并登录'}
            </Button>
            {mode === 'login' && (
              <p className="text-[10.5px] text-quaternary">忘记密码？联系管理员重置。</p>
            )}
          </form>

          <div className="mt-8 border-t border-border-subtle pt-5">
            <button
              type="button"
              onClick={() => {
                setServerEditing((value) => {
                  const next = !value;
                  // 展开时同步当前地址：status 是异步加载的，挂载时捕获的初值可能已过期。
                  if (next) setServerUrlInput(status.serverUrl);
                  return next;
                });
              }}
              className="no-drag text-[11px] text-tertiary underline-offset-4 hover:text-primary hover:underline"
            >
              {serverEditing ? '收起服务器设置' : '使用其他账号服务器'}
            </button>
            {serverEditing && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    await setServerUrl(serverUrl);
                    setServerEditing(false);
                  } catch {
                    // store.error 负责呈现
                  }
                }}
              >
                <Input
                  value={serverUrl}
                  onChange={(event) => setServerUrlInput(event.target.value)}
                  className="h-8 rounded-full px-3 font-mono text-[11px] shadow-none"
                  aria-label="账号服务器地址"
                />
                <Button type="submit" variant="outline" size="sm" className="rounded-full shadow-none" disabled={action === 'server'}>
                  保存
                </Button>
              </form>
            )}
            <p className="mt-2 break-all font-mono text-[10px] text-quaternary">{status.serverUrl}</p>
          </div>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title="账号"
      description="Agent 与生图模型由账号统一管理。手动添加的 API 配置仍可随时切换。"
      action={
        <span className={cn(
          'inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium',
          status.health === 'ok'
            ? 'border-border-default text-secondary'
            : status.health === 'token-invalid'
              ? 'border-danger/40 text-danger'
              : 'border-warning/40 text-warning',
        )}>
          {healthLabel(status.health)}
        </span>
      }
    >
      <div data-testid="settings-account-signed-in">
        <div className="border-y border-border-subtle py-7">
          <p className="text-[12px] text-tertiary">账号余额</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="font-mono text-[32px] font-medium tracking-[-0.035em] text-primary">
              {status.quota ? points(status.quota.value) : '—'}
            </p>
            {status.estImagesRemaining != null && (
              <p className="text-[12px] text-tertiary">约可生成 {status.estImagesRemaining.toLocaleString('zh-CN')} 张</p>
            )}
          </div>
          {quotaCny != null && (
            <p className="mt-1 font-mono text-[10px] text-quaternary">约 ¥{quotaCny.toFixed(2)}</p>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="mt-3 rounded-full px-3 shadow-none"
            onClick={() => void refreshQuota()}
            disabled={action === 'refresh'}
          >
            {action === 'refresh' ? '刷新中…' : '刷新余额'}
          </Button>
        </div>

        {status.health === 'token-invalid' && (
          <div>
            <InlineMessage tone="danger">登录状态已失效。重新登录后，现有模型配置会自动恢复。</InlineMessage>
            <Button
              variant="outline"
              size="xs"
              className="mt-2 rounded-full px-3 shadow-none"
              onClick={() => void logout()}
            >
              重新登录
            </Button>
          </div>
        )}
        {status.health === 'unreachable' && (
          <InlineMessage tone="warning">暂时无法连接账号服务器。本地内容不受影响。</InlineMessage>
        )}

        <div className="border-b border-border-subtle py-6" data-testid="account-managed-models">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div>
              <p className="text-[12px] font-medium text-primary">账号内置模型</p>
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">由 Musefold 固定配置，无需选择或维护模型 ID。</p>
            </div>
            <div className="grid min-w-[220px] gap-1.5 text-[10.5px]">
              <p className="flex items-center justify-between gap-4"><span className="text-tertiary">生图</span><span className="font-medium text-secondary">{displayModelName(ACCOUNT_DEFAULT_IMAGE_MODEL)}</span></p>
              <p className="flex items-center justify-between gap-4"><span className="text-tertiary">Agent</span><span className="font-medium text-secondary">{displayModelName(ACCOUNT_DEFAULT_TEXT_MODEL)}</span></p>
            </div>
          </div>
        </div>

        <form className="border-b border-border-subtle py-6" onSubmit={submitRedeem}>
          <div className="flex items-end gap-2">
            <Field label="兑换码" htmlFor="account-redeem" className="min-w-0 flex-1">
              <Input
                id="account-redeem"
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                className="h-9 rounded-full px-4 font-mono shadow-none"
                placeholder="输入兑换码"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="rounded-full px-5 shadow-none"
              disabled={action === 'redeem' || !redeemCode.trim()}
            >
              {action === 'redeem' ? '兑换中…' : '兑换'}
            </Button>
          </div>
          {redeemSuccess && <InlineMessage tone="success">{redeemSuccess}</InlineMessage>}
          {error && <InlineMessage tone="danger">{error.message}</InlineMessage>}
          <p className="mt-2 text-[10.5px] text-quaternary">兑换码请向管理员获取，兑换后即时到账。</p>
        </form>

        {notices.length > 0 && (
          <section className="border-b border-border-subtle py-6" aria-labelledby="account-notices-title">
            <div className="flex items-center justify-between">
              <h3 id="account-notices-title" className="text-[12px] font-medium text-primary">服务公告</h3>
              <button
                type="button"
                className="no-drag text-[10px] text-tertiary underline-offset-4 hover:text-primary hover:underline"
                onClick={() => notices.forEach((notice) => markNoticeRead(notice.id))}
              >
                全部已读
              </button>
            </div>
            <div className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
              {notices.map((notice) => (
                <div key={notice.id} className="py-3 text-[11.5px] leading-relaxed text-secondary">
                  {notice.content}
                </div>
              ))}
            </div>
          </section>
        )}

        <div>
          <SettingRow label={status.username ?? '—'} hint="当前账号">
            <span className="font-mono text-[11px] text-tertiary">
              令牌 ····{status.deviceTokenSuffix ?? '—'}
            </span>
          </SettingRow>
          <SettingRow label="账号服务器" hint={status.isDefaultServer ? 'Musefold Cloud' : '自定义 new-api'}>
            <span className="block max-w-[300px] truncate font-mono text-[10.5px] text-tertiary" title={status.serverUrl}>
              {status.serverUrl}
            </span>
          </SettingRow>
          <div className="pt-6">
            {!confirmLogout ? (
              <Button variant="ghost" size="sm" className="rounded-full px-3 text-tertiary shadow-none" onClick={() => setConfirmLogout(true)}>
                退出登录
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                <span>将移除本机托管配置；手动服务商不受影响。</span>
                <Button
                  variant="danger"
                  size="xs"
                  className="rounded-full px-3 shadow-none"
                  disabled={action === 'logout'}
                  onClick={() => void logout()}
                >
                  确认退出
                </Button>
                <Button variant="ghost" size="xs" className="rounded-full px-3 shadow-none" onClick={() => setConfirmLogout(false)}>
                  取消
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn('block', className)}>
      <span className="mb-1.5 block text-[11px] font-medium text-secondary">{label}</span>
      {children}
    </label>
  );
}

function InlineMessage({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mt-3 border-l pl-3 text-[11px] leading-relaxed',
        tone === 'danger' && 'border-danger text-danger',
        tone === 'warning' && 'border-warning text-warning',
        tone === 'success' && 'border-success text-success',
      )}
    >
      {children}
    </p>
  );
}
