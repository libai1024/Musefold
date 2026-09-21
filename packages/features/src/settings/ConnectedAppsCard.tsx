'use client';

import type { CloudMcpAuthorization } from '@musefold/contracts';
import { CLOUD_MCP_CUSTOM_SERVER_CODE } from '@musefold/contracts';
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
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { useState } from 'react';
import { extractErrorCode } from '../account/error-messages';
import { useAccountStatus } from '../account/hooks';
import { useCloudMcpAuthorizations, useRevokeCloudMcpAuthorization } from './hooks';
import { useSettingsNav } from './settings-nav-store';

export function formatConnectedAppAuthorizedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isCustomServerError(error: unknown): boolean {
  if (extractErrorCode(error) === CLOUD_MCP_CUSTOM_SERVER_CODE) return true;
  return error instanceof Error && error.message.includes('暂不支持');
}

function connectedAppsErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '已连接应用加载失败';
}

/**
 * Cloud MCP「已连接应用」卡(07-settings-04 §2.4 / §6 P2)。
 * 四态:loading / error+重试 / 空 / ready;未登录与自定义服务器整卡换成门控文案。
 */
export function ConnectedAppsCard() {
  const account = useAccountStatus();
  const signedIn = account.isSuccess;
  const list = useCloudMcpAuthorizations(signedIn);
  const revoke = useRevokeCloudMcpAuthorization();
  const openAccount = useSettingsNav((state) => state.setActiveSectionId);
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);

  const items = list.data?.items ?? [];
  const showSkeleton = account.isPending || (signedIn && list.isPending && !list.data);
  const customServer = signedIn && list.isError && isCustomServerError(list.error);
  const showError = signedIn && list.isError && !list.data && !customServer;

  function confirmRevoke(app: CloudMcpAuthorization) {
    revoke.mutate(app.clientId, {
      onSuccess: () => {
        setPendingClientId(null);
        toast.success(`已撤销 ${app.name} 的授权`);
      },
      onError: (error) => toast.error(connectedAppsErrorMessage(error)),
    });
  }

  return (
    <Card data-testid="settings-connected-apps-card">
      <CardHeader>
        <CardTitle>已连接应用</CardTitle>
        <CardDescription>
          管理已授权访问 Musefold 云端 MCP 的客户端,撤销后对方需重新授权
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {account.isError ? (
          <div className="flex flex-col gap-3" data-testid="settings-connected-apps-signed-out">
            <p className="text-muted-foreground text-sm">登录 Musefold 账号后可管理</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-fit"
              data-testid="settings-connected-apps-signin"
              onClick={() => openAccount('account')}
            >
              前往登录
            </Button>
          </div>
        ) : customServer ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="settings-connected-apps-unsupported"
          >
            自定义账号服务器暂不支持 Cloud MCP 连接管理
          </p>
        ) : showSkeleton ? (
          <div className="flex flex-col gap-2" data-testid="settings-connected-apps-loading">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : showError ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="settings-connected-apps-error"
          >
            <p className="min-w-0 flex-1 text-destructive text-xs">
              {connectedAppsErrorMessage(list.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              data-testid="settings-connected-apps-retry"
              onClick={() => void list.refetch()}
            >
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="settings-connected-apps-empty">
            还没有已连接的应用
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="settings-connected-apps-list">
            {items.map((app) => (
              <li
                key={app.clientId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2"
                data-testid="settings-connected-apps-row"
                data-client-id={app.clientId}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground text-sm">{app.name}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    授权于 {formatConnectedAppAuthorizedAt(app.authorizedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-destructive hover:text-destructive"
                  disabled={revoke.isPending}
                  data-testid="settings-connected-apps-revoke"
                  onClick={() => setPendingClientId(app.clientId)}
                >
                  撤销
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={pendingClientId !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setPendingClientId(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>撤销授权?</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后该应用将无法再调用你的 Musefold 云端能力,需重新授权。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={revoke.isPending}
              data-testid="settings-connected-apps-revoke-confirm"
              onClick={(event) => {
                event.preventDefault();
                const app = items.find((item) => item.clientId === pendingClientId);
                if (app) confirmRevoke(app);
              }}
            >
              {revoke.isPending ? '撤销中…' : '撤销授权'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
