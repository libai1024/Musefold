'use client';

import type { AiProvider } from '@musefold/contracts';
import { ACCOUNT_CLOUD_PROVIDER_TYPE } from '@musefold/contracts';
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
import { DoubaoMark, MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import {
  Check,
  ChevronsUpDown,
  LogIn,
  LogOut,
  Plug,
  Settings,
  Sparkles,
  UserRound,
  Waypoints,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import { useScreenIntent } from '../shell/screen-intent-store';
import { isAccountRestricted } from './account-session';
import {
  formatPoints,
  useAccountStatus,
  useAiProviders,
  useLogout,
  useSetActiveAiProvider,
} from './hooks';

/**
 * 移动顶栏额度 readout(V25-UI-SPEC §2.3):Sparkles + 积分数字。
 * 未登录/加载中不占位——顶栏保持干净,登录入口在设置分区。
 */
export function MobileQuotaReadout() {
  const account = useAccountStatus();
  if (!account.isSuccess || isAccountRestricted(account.data)) return null;
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
 * 左下角当前生效的生图通道(触发钮显示什么):
 * - account:官方账号(推荐主通道;无本地活跃连接、活跃行是账号托管行、或 Web)
 * - doubao:免费试用通道(活跃行 type=doubao-web)
 * - relay:第三方中转站(其余活跃行)
 */
type ChannelDisplay =
  | { kind: 'account' }
  | { kind: 'doubao'; provider: AiProvider }
  | { kind: 'relay'; provider: AiProvider };

const ACCOUNT_CHANNEL: ChannelDisplay = { kind: 'account' };

function resolveChannel(items: readonly AiProvider[] | undefined): ChannelDisplay {
  const active = items?.find((provider) => provider.isActive);
  if (!active || active.type === ACCOUNT_CLOUD_PROVIDER_TYPE) return ACCOUNT_CHANNEL;
  if (active.type === 'doubao-web') return { kind: 'doubao', provider: active };
  return { kind: 'relay', provider: active };
}

/**
 * 「更多连接」子菜单(仅桌面,hasLocalAiProviders 门控后挂载,hook 安全)。
 * 通道定位:官方账号是推荐主通道;豆包免费试用;中转站第三方自备。
 * 点击即切活跃连接(setActive,左下角显示与 Composer 预选跟随),
 * 未配置的通道点击深链设置对应卡(登录/接入等重配置一律在设置里)。
 */
function MoreConnectionsMenu({
  onOpenAccount,
  onOpenConnections,
}: {
  onOpenAccount: () => void;
  onOpenConnections: () => void;
}) {
  const providers = useAiProviders();
  const setActive = useSetActiveAiProvider();
  const capabilities = useCapabilities();

  const items = providers.data ?? [];
  const activeId = items.find((provider) => provider.isActive)?.id ?? null;
  const accountRow =
    items.find((provider) => provider.type === ACCOUNT_CLOUD_PROVIDER_TYPE && provider.isActive) ??
    items.find((provider) => provider.type === ACCOUNT_CLOUD_PROVIDER_TYPE);
  const doubao = items.find((provider) => provider.type === 'doubao-web' && provider.hasKey);
  // 列表按 is_active DESC, updated_at DESC:首个可用中转站即「活跃或最近」项。
  const relays = items.filter(
    (provider) =>
      provider.type !== 'doubao-web' && provider.managedBy !== 'account' && provider.hasKey,
  );
  const relayTarget = relays[0];
  const relayActive = relays.some((provider) => provider.id === activeId);
  const doubaoActive = doubao != null && doubao.id === activeId;
  // 无任何活跃本地连接时,官方账号即当前通道。
  const accountActive = activeId === null || accountRow?.id === activeId;

  const switchTo = (target: AiProvider | undefined, label: string, fallback: () => void) => {
    if (!target) {
      // 未配置:切不了,先去设置里接入。
      fallback();
      return;
    }
    if (target.id === activeId) return;
    setActive.mutate(target.id, {
      onSuccess: () => toast.success(`已切换到${label}`, { description: target.name }),
      onError: () => toast.error('切换失败，请稍后重试'),
    });
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="account-menu-more">
        <Plug className="size-4 text-muted-foreground" /> 更多连接
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52" data-testid="account-menu-more-content">
        <DropdownMenuItem
          onSelect={() => {
            if (accountActive) return;
            switchTo(accountRow, '官方账号', onOpenAccount);
          }}
          data-testid="account-menu-official"
        >
          <MusefoldMark className="size-4 [--primary:currentColor]" aria-hidden />
          <span className="flex-1">官方账号</span>
          {accountActive ? (
            <Check className="size-3.5 text-primary" aria-label="当前使用" />
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {accountRow ? '推荐' : '未接入'}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => switchTo(relayTarget, '中转站', onOpenConnections)}
          data-testid="account-menu-relay"
        >
          <Waypoints className="size-4" />
          <span className="flex-1">中转站</span>
          {relayActive ? (
            <Check className="size-3.5 text-primary" aria-label="当前使用" />
          ) : (
            <span className="max-w-24 truncate text-[11px] text-muted-foreground">
              {relayTarget ? relayTarget.name : '未配置'}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => switchTo(doubao, '豆包', onOpenConnections)}
          data-testid="account-menu-doubao"
        >
          <DoubaoMark className="size-4" aria-hidden />
          <span className="flex-1">豆包</span>
          {doubaoActive ? (
            <Check className="size-3.5 text-primary" aria-label="当前使用" />
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {/* 未配置但宿主有豆包登录面:深链设置连接区的豆包卡,就地扫码登录。 */}
              {doubao ? '免费试用' : capabilities.hasDoubaoWebLogin ? '去登录' : '未配置'}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenConnections} data-testid="account-menu-connections">
          <Settings className="size-4" /> 连接设置
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * 壳侧栏左下角账号区(承旧 SidebarAccessSwitcher 语义,收敛为 v2.5 形态):
 * 触发钮显示**当前生效的生图通道**(官方账号/豆包/中转站连接),切换后即时更新;
 * 菜单默认动作是登入/登出,中转站与豆包的切换收在「更多连接」子菜单(桌面)。
 * 右侧齿轮直达设置(承 e2e `nav-settings` 契约)。
 */
export function AccountFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const capabilities = useCapabilities();
  if (capabilities.hasLocalAiProviders) {
    return <DesktopAccountFooter onOpenSettings={onOpenSettings} />;
  }
  return <AccountFooterBody onOpenSettings={onOpenSettings} channel={ACCOUNT_CHANNEL} />;
}

/** 桌面变体:多一层本地连接查询,把活跃连接解析成触发钮的通道显示。 */
function DesktopAccountFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const providers = useAiProviders();
  return (
    <AccountFooterBody onOpenSettings={onOpenSettings} channel={resolveChannel(providers.data)} />
  );
}

function AccountFooterBody({
  onOpenSettings,
  channel,
}: {
  onOpenSettings: () => void;
  channel: ChannelDisplay;
}) {
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
  const restricted = isAccountRestricted(account.data);
  const name = signedIn ? (account.data.displayName ?? account.data.username) : null;

  // 触发钮三态:官方账号(登录态)/ 豆包 / 中转站连接名。
  const trigger =
    channel.kind === 'doubao'
      ? { title: '豆包', subtitle: '免费试用通道' }
      : channel.kind === 'relay'
        ? {
            title: channel.provider.name,
            subtitle:
              channel.provider.managedBy === 'account' ? '旧托管连接，身份未绑定' : '中转站通道',
          }
        : {
            title: signedIn && name ? name : '登录账号',
            subtitle: restricted
              ? '账号需要恢复'
              : signedIn
                ? `${formatPoints(account.data.quota)} 积分`
                : '同步与云生图',
          };

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
              data-channel={channel.kind}
              title={trigger.title}
              className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
            >
              <span
                className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground"
                aria-hidden
              >
                {channel.kind === 'doubao' ? (
                  <DoubaoMark className="size-4" />
                ) : channel.kind === 'relay' ? (
                  <Waypoints className="size-3.5" />
                ) : (
                  <>
                    {/* 官方账号 = 官方黑白标记(朱点降为单色),状态点表达登录态。 */}
                    <MusefoldMark className="size-3.5 [--primary:currentColor]" />
                    <span
                      className={cn(
                        'absolute -right-px -bottom-px size-2 rounded-full ring-2 ring-sidebar',
                        signedIn ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      )}
                    />
                  </>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[13px] text-sidebar-foreground leading-[1.3]">
                  {trigger.title}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground leading-[1.3] tabular-nums">
                  {trigger.subtitle}
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
                    {restricted ? '待验证' : `${formatPoints(account.data.quota)} 积分`}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={openAccount} data-testid="account-menu-manage">
                  <UserRound className="size-4" /> {restricted ? '恢复账号' : '账户与额度'}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={openAccount} data-testid="account-menu-login">
                <LogIn className="size-4" /> 登录 Musefold 账号
              </DropdownMenuItem>
            )}

            {capabilities.hasLocalAiProviders && (
              <>
                <DropdownMenuSeparator />
                <MoreConnectionsMenu
                  onOpenAccount={openAccount}
                  onOpenConnections={openConnections}
                />
              </>
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
