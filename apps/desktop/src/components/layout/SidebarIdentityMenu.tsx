// 侧栏身份菜单容器(自 SidebarAccessSwitcher 拆出):下拉根、触发器、身份模型与跨模式切换验证。
// 下拉内容(账号/中转站分组)在 IdentityMenuBody;testid 契约见 model-hub-ui.test.ts 与 tests/e2e。
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@musefold/ui';
import { ChevronDown, Server, UserRound } from '../ui/icons';
import { ModelBrandIcon, matchModelBrand } from '../ui/brand-icons';
import { useAccountStore } from '../../features/account/store';
import { useDoubaoAccountStore } from '../../features/account/doubao-store';
import { useGenerationStore } from '../../features/generation/store';
import { useSettingsStore } from '../../features/settings/store';
import { useAiConnectionStore } from '../../features/settings/ai-connection-store';
import { accessModeOfProvider, preferredByokEntry } from '../../lib/ai-access';
import { displayModelName } from '../../lib/model-catalog';
import { formatPoints } from '@musefold/domain';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/toast';
import type {
  AccountIdentity,
  AccountIdentityTransitionState,
} from '../../features/settings/components/AccessTransitions';
import { IdentityMenuBody } from './IdentityMenuBody';

interface SidebarIdentityMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 深链进设置:section 定分区,relayTab 定中转站内部 tab(providers=生图,ai=Agent) */
  openSettingsAt: (section: 'account' | 'relay', relayTab?: 'providers' | 'ai') => void;
  identityTransitionActive: boolean;
  onAccountTransition: (state: AccountIdentityTransitionState) => void;
}

export function SidebarIdentityMenu({
  open,
  onOpenChange,
  openSettingsAt,
  identityTransitionActive,
  onAccountTransition,
}: SidebarIdentityMenuProps) {
  const providers = useGenerationStore((state) => state.providers);
  const activeProviderId = useGenerationStore((state) => state.activeProviderId);
  const setActiveProvider = useGenerationStore((state) => state.setActive);
  const testProvider = useGenerationStore((state) => state.testProvider);
  const setActiveConnection = useAiConnectionStore((state) => state.setActive);
  const accountStatus = useAccountStore((state) => state.status);
  const refreshQuota = useAccountStore((state) => state.refreshQuota);
  const doubaoStatus = useDoubaoAccountStore((state) => state.status);
  const doubaoStatusLoading = useDoubaoAccountStore((state) => state.loading);
  const refreshDoubaoStatus = useDoubaoAccountStore((state) => state.refreshStatus);
  const refreshDoubaoUsage = useDoubaoAccountStore((state) => state.refreshUsage);
  const aiConnectionsLoaded = useAiConnectionStore((state) => state.loaded);
  const loadAiConnections = useAiConnectionStore((state) => state.load);
  const preferredAccountSource = useSettingsStore((state) => state.accountImageSource);

  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const identityTriggerRef = useRef<HTMLButtonElement>(null);

  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const mode = accessModeOfProvider(activeProvider) ?? 'account';
  const activeDoubao = activeProvider?.type === 'doubao-web';
  const doubaoProvider = providers.find((provider) => provider.type === 'doubao-web') ?? null;
  const officialProvider = providers.find((provider) => provider.managedBy === 'account') ?? null;
  const relayProviders = providers.filter(
    (provider) => provider.managedBy !== 'account' && provider.type !== 'doubao-web',
  );

  useEffect(() => {
    if (!aiConnectionsLoaded) void loadAiConnections().catch(() => {});
  }, [aiConnectionsLoaded, loadAiConnections]);

  useEffect(() => {
    if (activeDoubao) {
      void refreshDoubaoStatus().catch(() => refreshDoubaoUsage().catch(() => {}));
      const refresh = () => void refreshDoubaoUsage().catch(() => {});
      const interval = window.setInterval(refresh, 30_000);
      window.addEventListener('focus', refresh);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener('focus', refresh);
      };
    }
    if (mode === 'account' && !activeDoubao && accountStatus.loggedIn)
      void refreshQuota().catch(() => {});
  }, [
    accountStatus.loggedIn,
    activeDoubao,
    mode,
    refreshDoubaoStatus,
    refreshDoubaoUsage,
    refreshQuota,
  ]);

  const chooseRelayProvider = async (providerId: string) => {
    if (pendingProviderId || providerId === activeProviderId) return;
    setPendingProviderId(providerId);
    try {
      const result = await testProvider(providerId);
      if (result.state !== 'ok') throw new Error(result.message || '生图模型连接失败');
      if (mode !== 'relay') {
        // 跨模式进入中转站：Agent 通道一并切到最近的自备连接并验证，失败则不切换
        const connectionState = useAiConnectionStore.getState();
        if (!connectionState.loaded && !connectionState.loading) await connectionState.load();
        const stationConnections = connectionState.connections.filter(
          (connection) => connection.managedBy !== 'account',
        );
        const targetConnection = preferredByokEntry(stationConnections);
        if (!targetConnection) throw new Error('请先在设置中配置 Agent 中转站连接');
        const connectionResult = await connectionState.validate(targetConnection.id);
        if (!connectionResult.ok) throw new Error(connectionResult.message || 'Agent 模型连接失败');
        await setActiveConnection(targetConnection.id);
      }
      await setActiveProvider(providerId);
      onOpenChange(false);
      const provider = providers.find((item) => item.id === providerId);
      toast.success(
        '生图模型已切换',
        provider ? `${provider.name} · ${displayModelName(provider.model)}` : undefined,
      );
    } catch (error) {
      toast.error('模型切换失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setPendingProviderId(null);
    }
  };

  const accountBalance = !accountStatus.loggedIn
    ? '官方账号未登录'
    : accountStatus.health === 'token-invalid'
      ? '登录已失效'
      : accountStatus.quota
        ? `${formatPoints(accountStatus.quota.value)} 积分`
        : '余额读取中';
  const doubaoName = doubaoStatus?.accountName?.trim() || '豆包账号';
  const doubaoDetail = doubaoStatus
    ? `今日剩余 ${doubaoStatus.usage.remaining} / ${doubaoStatus.usage.limit} 次`
    : doubaoStatusLoading
      ? '正在读取今日剩余次数'
      : '今日剩余次数暂不可用';
  const officialName = accountStatus.username?.trim() || 'Musefold 官方账号';
  const doubaoReady = Boolean(doubaoProvider?.hasKey && (doubaoStatus?.loggedIn ?? true));
  const officialReady = Boolean(
    officialProvider && accountStatus.loggedIn && accountStatus.health !== 'token-invalid',
  );
  const identityOf = (source: 'doubao' | 'official'): AccountIdentity =>
    source === 'doubao'
      ? {
          source,
          name: doubaoName,
          detail: doubaoDetail,
          avatarDataUrl: doubaoStatus?.avatarDataUrl,
        }
      : {
          source,
          name: officialName,
          detail: accountBalance,
        };

  function beginAccountSwitch(target: 'doubao' | 'official') {
    if (identityTransitionActive) return;
    // relay 模式下没有「当前账号」，动画的 from 取偏好的账号来源
    const from = mode === 'relay' ? preferredAccountSource : activeDoubao ? 'doubao' : 'official';
    if (target === from && mode === 'account') {
      onOpenChange(false);
      return;
    }
    if ((target === 'doubao' && !doubaoReady) || (target === 'official' && !officialReady)) {
      openSettingsAt('account');
      return;
    }
    onOpenChange(false);
    onAccountTransition({ from: identityOf(from), to: identityOf(target) });
  }
  const title =
    mode === 'relay'
      ? // 生图与 Agent 中转站不一定同源，常驻身份不点名具体站点，只说明接入形态
        activeProvider
        ? '自定义中转站'
        : '中转站未配置'
      : activeDoubao
        ? doubaoName
        : officialName;
  const detail =
    mode === 'relay'
      ? displayModelName(activeProvider?.model) || '模型未配置'
      : activeDoubao
        ? doubaoDetail
        : accountBalance;
  const initial = title.charAt(0).toUpperCase();
  const ready =
    mode === 'relay'
      ? Boolean(activeProvider?.hasKey)
      : activeDoubao
        ? Boolean(doubaoStatus?.loggedIn ?? activeProvider?.hasKey)
        : accountStatus.loggedIn && accountStatus.health !== 'token-invalid';

  // 官方优先：身份菜单固定官方在前，豆包作为体验/备用通道排在后面。
  const identityAccounts = [
    {
      source: 'official' as const,
      name: officialName,
      detail: officialReady ? accountBalance : '未登录 · 点击去登录',
      available: true,
      active: mode === 'account' && !activeDoubao,
      avatarDataUrl: null,
      onChoose: () => beginAccountSwitch('official'),
    },
    {
      source: 'doubao' as const,
      name: doubaoName,
      detail: doubaoReady ? doubaoDetail : '未登录 · 点击去登录',
      available: true,
      active: mode === 'account' && activeDoubao,
      avatarDataUrl: doubaoStatus?.avatarDataUrl ?? null,
      onChoose: () => beginAccountSwitch('doubao'),
    },
  ];
  const relayOptions = relayProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    model: provider.model,
    active: mode === 'relay' && provider.id === activeProviderId,
    pending: provider.id === pendingProviderId,
  }));

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          ref={identityTriggerRef}
          type="button"
          disabled={identityTransitionActive}
          aria-label={
            mode === 'relay' ? `切换生图身份，当前${title} ${detail}` : `选择生图账号，当前${title}`
          }
          aria-haspopup="menu"
          aria-busy={mode === 'account' && identityTransitionActive}
          title={`${title} · ${detail}`}
          className={cn(
            'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-wait disabled:opacity-70',
            open && 'bg-hover text-primary',
          )}
          data-testid="provider-quick-switch"
          data-identity-switcher
        >
          <span
            className={cn(
              'relative flex h-7 w-7 shrink-0 items-center justify-center bg-inset text-[11px] font-semibold text-secondary',
              mode === 'account'
                ? 'overflow-hidden rounded-full border border-border-subtle'
                : 'rounded-md',
            )}
          >
            {activeDoubao && doubaoStatus?.avatarDataUrl ? (
              <img
                src={doubaoStatus.avatarDataUrl}
                alt=""
                className="h-full w-full object-cover"
                data-testid="sidebar-doubao-avatar"
              />
            ) : mode === 'account' ? (
              initial || <UserRound className="h-3.5 w-3.5 text-tertiary" />
            ) : matchModelBrand(activeProvider?.model) !== 'generic' ? (
              <ModelBrandIcon model={activeProvider?.model} className="h-4 w-4" />
            ) : (
              <Server className="h-4 w-4" />
            )}
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-sidebar',
                ready ? 'bg-success' : 'bg-tertiary',
              )}
            />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span
              className="block truncate text-[12px] font-medium leading-[1.3] text-primary"
              data-testid={
                activeDoubao
                  ? 'sidebar-doubao-account'
                  : mode === 'relay'
                    ? 'sidebar-relay-name'
                    : 'sidebar-official-account'
              }
            >
              {title}
            </span>
            <span
              className={cn(
                'block truncate text-meta leading-[1.3]',
                activeDoubao && doubaoStatus?.usage.remaining === 0
                  ? 'text-warning'
                  : 'text-tertiary',
              )}
              data-testid={
                activeDoubao
                  ? 'sidebar-doubao-remaining'
                  : mode === 'relay'
                    ? 'sidebar-relay-model'
                    : 'sidebar-account-balance'
              }
              aria-live="polite"
            >
              {detail}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-quaternary transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        aria-label="切换生图身份"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          identityTriggerRef.current?.focus();
        }}
        data-identity-switcher
        data-testid="identity-switcher"
        className="no-drag mf-sidebar-identity-menu w-[292px] p-0 text-[11px]"
      >
        <IdentityMenuBody
          title={title}
          detail={detail}
          accounts={identityAccounts}
          relayProviders={relayOptions}
          pendingProviderId={pendingProviderId}
          chooseRelayProvider={chooseRelayProvider}
          openSettingsAt={openSettingsAt}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
