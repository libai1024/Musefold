'use client';

import { useCapabilities } from '@musefold/platform';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Skeleton } from '@musefold/ui/components/skeleton';
import {
  Bot,
  ChevronsUpDown,
  LogIn,
  LogOut,
  Settings,
  Sparkles,
  UserRound,
  Waypoints,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import { useScreenIntent } from '../shell/screen-intent-store';
import { formatPoints, useAccountStatus, useAiProviders, useLogout } from './hooks';

/**
 * 移动顶栏额度 readout(V25-UI-SPEC §2.3):Sparkles + 积分数字。
 * 未登录/加载中不占位——顶栏保持干净,登录入口在设置分区。
 */
export function MobileQuotaReadout() {
  const account = useAccountStatus();
  if (!account.isSuccess) return null;
  return (
    <span
      className="flex items-center gap-1 px-1.5 text-muted-foreground text-xs tabular-nums"
      data-testid="mobile-quota"
    >
      <Sparkles className="size-3.5 text-primary" aria-hidden />
      {formatPoints(account.data.quota)}
    </span>
  );
}

/**
 * 生图接入两行(仅桌面,hasLocalAiProviders 门控后挂载,hook 安全):
 * 中转站 = 本机自配连接目录;豆包 = 存量 doubao-web 连接(登录管理渲染层暂缓,
 * 入口深链设置连接卡,不在此实现该域 UI)。
 */
function AccessMenuItems({ onOpenConnections }: { onOpenConnections: () => void }) {
  const providers = useAiProviders();
  const relayCount =
    providers.data?.filter((provider) => provider.type !== 'doubao-web').length ?? 0;
  const doubaoConnected =
    providers.data?.some((provider) => provider.type === 'doubao-web' && provider.hasKey) ?? false;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] text-muted-foreground">生图接入</DropdownMenuLabel>
      <DropdownMenuItem onSelect={onOpenConnections} data-testid="account-menu-relay">
        <Waypoints className="size-4" />
        <span className="flex-1">中转站</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {providers.isPending ? '…' : relayCount > 0 ? `${relayCount} 个连接` : '未配置'}
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onOpenConnections} data-testid="account-menu-doubao">
        <Bot className="size-4" />
        <span className="flex-1">豆包</span>
        <span className="text-[11px] text-muted-foreground">
          {providers.isPending ? '…' : doubaoConnected ? '已接入' : '未接入'}
        </span>
      </DropdownMenuItem>
    </>
  );
}

/**
 * 壳侧栏左下角账号区(承旧 SidebarAccessSwitcher 语义,收敛为 v2.5 形态):
 * 身份主钮(头像 + 名称/积分 + 在线状态点)向上弹出菜单——账号(登入/登出为默认动作)、
 * 中转站、豆包(桌面)三类接入的统一入口;右侧齿轮直达设置(承 e2e `nav-settings` 契约)。
 */
export function AccountFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const account = useAccountStatus();
  const logout = useLogout();
  const capabilities = useCapabilities();
  const setIntent = useScreenIntent((s) => s.setIntent);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const openAccount = () => {
    setIntent({ kind: 'settings-account' });
    onOpenSettings();
  };
  const openConnections = () => {
    setIntent({ kind: 'settings-connections' });
    onOpenSettings();
  };

  const signedIn = account.isSuccess;
  const name = signedIn ? (account.data.displayName ?? account.data.username) : null;

  return (
    <div className="flex items-center gap-1">
      {account.isPending ? (
        <Skeleton className="h-11 min-w-0 flex-1" data-testid="account-footer-loading" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid={signedIn ? 'account-footer' : 'account-footer-signed-out'}
              title={signedIn && name ? name : '登录账号'}
              className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
            >
              <span
                className={cn(
                  'relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs',
                  signedIn
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {signedIn && name ? (
                  name.slice(0, 1).toUpperCase()
                ) : (
                  <UserRound className="size-3.5" />
                )}
                <span
                  className={cn(
                    'absolute -right-px -bottom-px size-2 rounded-full ring-2 ring-sidebar',
                    signedIn ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[13px] text-sidebar-foreground leading-[1.3]">
                  {signedIn && name ? name : '登录账号'}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground leading-[1.3] tabular-nums">
                  {signedIn ? `${formatPoints(account.data.quota)} 积分` : '同步与云生图'}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-56"
            data-testid="account-menu"
          >
            {signedIn ? (
              <>
                <DropdownMenuLabel className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="shrink-0 font-normal text-[11px] text-muted-foreground tabular-nums">
                    {formatPoints(account.data.quota)} 积分
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={openAccount} data-testid="account-menu-manage">
                  <UserRound className="size-4" /> 账户与额度
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={openAccount} data-testid="account-menu-login">
                <LogIn className="size-4" /> 登录 Musefold 账号
              </DropdownMenuItem>
            )}

            {capabilities.hasLocalAiProviders && (
              <AccessMenuItems onOpenConnections={openConnections} />
            )}

            {signedIn && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setLogoutConfirmOpen(true)}
                  data-testid="account-menu-logout"
                >
                  <LogOut className="size-4" /> 登出
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-sidebar-foreground"
        aria-label="设置"
        title="设置"
        data-testid="nav-settings"
        onClick={onOpenSettings}
      >
        <Settings className="size-4" />
      </Button>

      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>登出账号？</AlertDialogTitle>
            <AlertDialogDescription>
              登出后云同步与云生图将不可用，本机数据保持不变。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="account-menu-logout-confirm"
              onClick={() => logout.mutate()}
            >
              登出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
