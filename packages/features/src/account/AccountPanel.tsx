'use client';

import type { AccountSummary } from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@musefold/ui/components/alert-dialog';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useScreenIntent } from '../shell/screen-intent-store';
import { accountErrorMessage, extractErrorCode } from './error-messages';
import {
  formatPoints,
  useAccountStatus,
  useLogin,
  useLogout,
  useRedeem,
  useRegister,
} from './hooks';
import { useRememberedUsername } from './remembered-username';
import { accountIdentityKey, isAccountRestricted } from './account-session';
import { AccountRecoveryPanel, OriginalSessionRecovery } from './AccountRecoveryPanel';
import { LoginCapacityDialog, LoginSessionsPanel, PendingLoginReleases } from './LoginSessions';
import { AccountNoticesPanel } from './AccountNoticesPanel';

export function AuthForm() {
  const lastUsername = useRememberedUsername((s) => s.lastUsername);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(lastUsername ?? '');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // 确认密码是纯 UI 态:只用于提交前比对,绝不进 gateway payload / cache / 日志。
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const login = useLogin();
  const register = useRegister();
  const active = mode === 'login' ? login : register;
  const authPending = login.isPending || register.isPending;

  useEffect(() => {
    if (lastUsername) setUsername((current) => current || lastUsername);
  }, [lastUsername]);

  // 仅挂载时清密码并聚焦:登出后 AuthForm 重挂载。登录/注册成功写 lastUsername
  // 时表单可能仍在,不能把用户刚输入的密码清掉。
  useEffect(() => {
    const remembered = useRememberedUsername.getState().lastUsername;
    if (!remembered) return;
    setPassword('');
    passwordRef.current?.focus();
  }, []);

  const switchMode = () => {
    if (authPending) return;
    setMode(mode === 'login' ? 'register' : 'login');
    setConfirmPassword('');
    setPasswordMismatch(false);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (authPending || !username.trim() || !password) return;
    // 密码按原始字符串精确比较(不 trim);提交路径(按钮点击与 Enter 隐式提交)
    // 统一走这里再校验一次,可提交状态不作为唯一拦截。
    if (mode === 'register' && password !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }
    active.mutate(
      { username: username.trim(), password, ...(twoFactorCode ? { twoFactorCode } : {}) },
      {
        onError: (error) => {
          if (extractErrorCode(error) === 'AUTH_SESSION_LIMIT') setCapacityOpen(true);
          if (extractErrorCode(error) === 'AUTH_2FA_REQUIRED') setShowTwoFactor(true);
        },
      },
    );
    setPassword('');
    setConfirmPassword('');
    setTwoFactorCode('');
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} data-testid="account-auth-form">
      <div className="flex flex-col gap-2">
        <Label htmlFor="account-username">用户名</Label>
        <Input
          id="account-username"
          data-testid="account-username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="account-password">密码</Label>
        <Input
          ref={passwordRef}
          id="account-password"
          data-testid="account-password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          aria-invalid={passwordMismatch || undefined}
          aria-describedby={passwordMismatch ? 'account-password-mismatch' : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordMismatch(false);
          }}
        />
      </div>
      {mode === 'register' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-confirm-password">确认密码</Label>
          <Input
            id="account-confirm-password"
            data-testid="account-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            aria-invalid={passwordMismatch || undefined}
            aria-describedby={passwordMismatch ? 'account-password-mismatch' : undefined}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setPasswordMismatch(false);
            }}
          />
        </div>
      )}
      {showTwoFactor && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-two-factor">两步验证码或备用码</Label>
          <Input
            id="account-two-factor"
            autoComplete="one-time-code"
            value={twoFactorCode}
            onChange={(event) => setTwoFactorCode(event.target.value)}
          />
        </div>
      )}
      {passwordMismatch && (
        <p
          id="account-password-mismatch"
          className="text-destructive text-sm"
          data-testid="account-password-mismatch"
          role="alert"
        >
          两次输入的密码不一致
        </p>
      )}
      {active.isError && (
        <p className="text-destructive text-sm" data-testid="account-auth-error">
          {accountErrorMessage(active.error)}
        </p>
      )}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-muted-foreground text-xs"
          onClick={switchMode}
          disabled={authPending}
        >
          {mode === 'login' ? '没有账号?注册' : '已有账号?登录'}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={active.isPending || !username.trim() || !password}
          data-testid="account-auth-submit"
        >
          {active.isPending && <Spinner className="size-3.5" />}
          {mode === 'login' ? '登录' : '注册'}
        </Button>
      </div>
      {capacityOpen && (
        <LoginCapacityDialog
          onClose={() => {
            setCapacityOpen(false);
            active.reset();
          }}
          restoreFocus={() => passwordRef.current?.focus()}
        />
      )}
    </form>
  );
}

function RedeemRow({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [code, setCode] = useState('');
  const redeem = useRedeem();

  const handleRedeem = () => {
    const trimmed = code.trim();
    if (!trimmed || redeem.isPending) return;
    redeem.mutate(trimmed, {
      onSuccess: () => {
        setCode('');
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="输入兑换码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="h-8"
          data-testid="account-redeem-input"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={redeem.isPending || !code.trim()}
          onClick={handleRedeem}
          data-testid="account-redeem-submit"
        >
          {redeem.isPending && <Spinner className="size-3.5" />}
          兑换
        </Button>
      </div>
      {redeem.recovery && (
        <div
          role={redeem.recovery.status === 'failed' ? 'alert' : 'status'}
          className="flex flex-col gap-1 text-muted-foreground text-xs"
          data-testid="account-redeem-recovery"
          data-status={redeem.recovery.status}
        >
          <p>{redeem.recovery.message}</p>
          {redeem.recovery.status !== 'pending' && onOpenHistory && (
            <Button
              type="button"
              variant="link"
              className="h-auto w-fit p-0 text-xs"
              data-testid="account-redeem-history"
              onClick={() => {
                if (redeem.recovery?.jobId)
                  useScreenIntent
                    .getState()
                    .setIntent({ kind: 'history-select', jobId: redeem.recovery.jobId });
                onOpenHistory();
              }}
            >
              {redeem.recovery.jobId ? '查看原任务' : '查看生成历史'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SignedInView({
  account,
  refresh,
  refreshing,
  onOpenHistory,
}: {
  account: AccountSummary;
  refresh(): void;
  refreshing: boolean;
  onOpenHistory?: () => void;
}) {
  const logout = useLogout();
  const name = account.displayName ?? account.username;
  const restricted = isAccountRestricted(account);

  return (
    <div className="flex flex-col gap-4" data-testid="account-signed-in">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm"
          aria-hidden
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground text-sm">{name}</p>
          {!restricted && (
            <p className="mt-0.5 text-muted-foreground text-xs" data-testid="account-points">
              {formatPoints(account.quota)} 积分
            </p>
          )}
        </div>
        <Badge variant={restricted || account.canGenerate ? 'secondary' : 'destructive'}>
          {restricted ? '待验证' : account.canGenerate ? '可生图' : '余额不足'}
        </Badge>
      </div>
      <Separator />
      {restricted ? (
        <AccountRecoveryPanel account={account} refresh={refresh} refreshing={refreshing} />
      ) : (
        <RedeemRow onOpenHistory={onOpenHistory} />
      )}
      {!account.recovery && <OriginalSessionRecovery />}
      <div className="flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              data-testid="account-logout"
            >
              退出登录
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>退出登录?</AlertDialogTitle>
              <AlertDialogDescription>
                退出后云同步与在线生图将不可用,本地数据不受影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => logout.mutate()}
                data-testid="account-logout-confirm"
              >
                退出登录
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/**
 * 账号面板(V25-UI-SPEC §7.1):未登录展示账密表单(凭据委托 New API 校验),
 * 已登录展示身份/积分/兑换码/退出。双宿主同一份,凭据流经 gateway.account。
 */
export function AccountPanel({ onOpenHistory }: { onOpenHistory?: () => void } = {}) {
  const account = useAccountStatus();
  const rememberUsername = useRememberedUsername((s) => s.remember);

  useEffect(() => {
    if (account.data?.username) rememberUsername(account.data.username);
  }, [account.data?.username, rememberUsername]);

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="settings-account-card">
        <CardHeader>
          <CardTitle>账号</CardTitle>
          <CardDescription>Musefold 云账号:同步、在线生图与积分</CardDescription>
        </CardHeader>
        <CardContent>
          <PendingLoginReleases />
          {account.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : account.isError ? (
            <div className="flex flex-col gap-3">
              <p
                className="text-muted-foreground text-sm"
                data-testid="settings-account-signed-out"
              >
                未登录。登录后可使用云同步与在线生图。
              </p>
              <AuthForm />
            </div>
          ) : (
            <SignedInView
              key={accountIdentityKey(account.data)}
              account={account.data}
              refresh={() => {
                void account.refetch();
              }}
              refreshing={account.isFetching}
              onOpenHistory={onOpenHistory}
            />
          )}
        </CardContent>
      </Card>
      {account.isSuccess && !isAccountRestricted(account.data) && (
        <div className="flex flex-col gap-6" key={accountIdentityKey(account.data)}>
          <LoginSessionsPanel />
          <AccountNoticesPanel account={account.data} />
        </div>
      )}
    </div>
  );
}
