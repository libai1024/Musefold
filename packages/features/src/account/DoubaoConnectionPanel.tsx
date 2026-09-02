'use client';

import type { DoubaoAccountStatus } from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Badge } from '@musefold/ui/components/badge';
import { DoubaoMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { toast } from '@musefold/ui/components/sonner';
import { LogOut, RefreshCw } from '@musefold/ui/icons';
import { useState } from 'react';
import {
  useDoubaoAccountStatus,
  useLogoutDoubao,
  useRefreshDoubaoLogin,
  useStartDoubaoLogin,
} from './hooks';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

/** 已登录:账号摘要 + 当日免费额度 + 状态刷新/退出。 */
function LoggedInView({ status }: { status: DoubaoAccountStatus }) {
  const logout = useLogoutDoubao();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-testid="doubao-logged-in">
      <div className="flex items-center gap-3">
        {status.avatarDataUrl ? (
          <img
            src={status.avatarDataUrl}
            alt=""
            className="size-9 shrink-0 rounded-full border border-border object-cover"
            data-testid="doubao-avatar"
          />
        ) : (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background"
            aria-hidden
          >
            <DoubaoMark className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-medium text-foreground text-sm"
            data-testid="doubao-account-name"
          >
            {status.accountName ?? '豆包账号'}
          </p>
          <p
            className="mt-0.5 text-muted-foreground text-xs tabular-nums"
            data-testid="doubao-usage"
          >
            今日免费额度剩余 {status.usage.remaining}/{status.usage.limit} 次
          </p>
        </div>
        <Badge variant="secondary">已登录</Badge>
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setConfirmOpen(true)}
          data-testid="doubao-logout"
        >
          <LogOut className="size-3.5" />
          退出豆包登录
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>退出豆包登录?</AlertDialogTitle>
            <AlertDialogDescription>
              退出后免费试用通道不可用,已生成的图片不受影响;可稍后重新扫码登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="doubao-logout-confirm"
              onClick={() =>
                logout.mutate(undefined, {
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
            >
              {logout.isPending && <Spinner className="size-3.5" />}
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 未登录:QR 登录流(开始/刷新/状态跟进),二维码以 data URL 就地展示,不弹窗。 */
function LoginFlowView({ status }: { status: DoubaoAccountStatus }) {
  const start = useStartDoubaoLogin();
  const refresh = useRefreshDoubaoLogin();
  const pending = start.isPending || refresh.isPending;
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const showQr = status.loginState === 'qr-ready' && status.qrCodeDataUrl !== null;

  return (
    <div className="flex flex-col gap-3" data-testid="doubao-login-flow">
      {showQr ? (
        <div className="flex items-start gap-3">
          <img
            src={status.qrCodeDataUrl ?? undefined}
            alt="豆包登录二维码"
            className="size-32 shrink-0 rounded-md border border-border bg-white p-1"
            data-testid="doubao-login-qr"
          />
          <p className="pt-1 text-muted-foreground text-xs leading-5">
            打开豆包 App 扫码登录。二维码约两分钟过期,失效后点「刷新二维码」。
          </p>
        </div>
      ) : (
        <p
          className="flex items-center gap-2 text-muted-foreground text-sm"
          data-testid="doubao-login-hint"
        >
          {(status.loginState === 'loading' || status.loginState === 'scanned') && (
            <Spinner className="size-3.5" />
          )}
          {status.loginState === 'loading'
            ? '正在获取登录二维码…'
            : status.loginState === 'scanned'
              ? '已扫码,请在豆包 App 内确认登录'
              : status.loginState === 'verification-required'
                ? '豆包要求人工验证,请在豆包窗口中完成验证后刷新二维码'
                : '未登录。扫码登录后可使用豆包每日免费生图额度。'}
        </p>
      )}
      {status.errorMessage && (
        <p className="text-destructive text-xs" data-testid="doubao-login-error" role="alert">
          {status.errorMessage}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {status.loginState === 'logged-out' ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => start.mutate(undefined, { onError })}
            data-testid="doubao-login-start"
          >
            {start.isPending && <Spinner className="size-3.5" />}
            扫码登录
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => refresh.mutate(undefined, { onError })}
            data-testid="doubao-login-refresh"
          >
            {refresh.isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            刷新二维码
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 豆包免费试用(桌面专属,承接 V25-UI-SPEC §0.2「账号/连接区可达入口」):
 * 冻结 browser-service 的薄适配面 —— QR 扫码登录、状态、刷新与退出。
 * 仅在 capabilities.hasDoubaoWebLogin 宿主挂载;会话存系统隔离分区,凭据不过渲染层。
 */
export function DoubaoConnectionPanel() {
  const status = useDoubaoAccountStatus();

  return (
    <Card data-testid="settings-doubao-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <DoubaoMark className="size-4" aria-hidden />
          <CardTitle>豆包免费试用</CardTitle>
        </div>
        <CardDescription>扫码登录豆包网页账号,使用每日免费生图额度</CardDescription>
      </CardHeader>
      <CardContent>
        {status.isPending ? (
          <Skeleton className="h-12 w-full" data-testid="doubao-status-loading" />
        ) : status.isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-destructive text-sm" data-testid="doubao-status-error">
              {errorMessage(status.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void status.refetch()}
              data-testid="doubao-status-retry"
            >
              重试
            </Button>
          </div>
        ) : status.data.loggedIn ? (
          <LoggedInView status={status.data} />
        ) : (
          <LoginFlowView status={status.data} />
        )}
      </CardContent>
    </Card>
  );
}
