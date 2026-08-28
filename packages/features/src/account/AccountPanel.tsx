'use client';

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
import { toast } from '@musefold/ui/components/sonner';
import { type FormEvent, useState } from 'react';
import {
  formatPoints,
  useAccountStatus,
  useLogin,
  useLogout,
  useRedeem,
  useRegister,
} from './hooks';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const register = useRegister();
  const active = mode === 'login' ? login : register;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    active.mutate({ username: username.trim(), password });
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
          id="account-password"
          data-testid="account-password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {active.isError && (
        <p className="text-destructive text-sm" data-testid="account-auth-error">
          {errorMessage(active.error)}
        </p>
      )}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-muted-foreground text-xs"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
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
    </form>
  );
}

function RedeemRow() {
  const [code, setCode] = useState('');
  const redeem = useRedeem();

  const handleRedeem = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    redeem.mutate(trimmed, {
      onSuccess: (result) => {
        setCode('');
        toast.success(`兑换成功,到账 ${formatPoints(result.creditedQuota)} 积分`);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
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
  );
}

function SignedInView({
  username,
  displayName,
  quota,
  canGenerate,
}: {
  username: string;
  displayName: string | null;
  quota: number;
  canGenerate: boolean;
}) {
  const logout = useLogout();
  const name = displayName ?? username;

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
          <p className="mt-0.5 text-muted-foreground text-xs" data-testid="account-points">
            {formatPoints(quota)} 积分
          </p>
        </div>
        <Badge variant={canGenerate ? 'secondary' : 'destructive'}>
          {canGenerate ? '可生图' : '余额不足'}
        </Badge>
      </div>
      <Separator />
      <RedeemRow />
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
export function AccountPanel() {
  const account = useAccountStatus();

  return (
    <Card data-testid="settings-account-card">
      <CardHeader>
        <CardTitle>账号</CardTitle>
        <CardDescription>Musefold 云账号:同步、在线生图与积分</CardDescription>
      </CardHeader>
      <CardContent>
        {account.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : account.isError ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm" data-testid="settings-account-signed-out">
              未登录。登录后可使用云同步与在线生图。
            </p>
            <AuthForm />
          </div>
        ) : (
          <SignedInView
            username={account.data.username}
            displayName={account.data.displayName}
            quota={account.data.quota}
            canGenerate={account.data.canGenerate}
          />
        )}
      </CardContent>
    </Card>
  );
}
