import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Loader2,
  Power,
  Server,
  Settings,
  Settings2,
  UserRound,
} from '../ui/icons';
import { ModelBrandIcon, matchModelBrand } from '../ui/brand-icons';
import { APP_NAME } from '@musefold/domain/constants';
import { useAccountStore } from '../../features/account/store';
import { useDoubaoAccountStore } from '../../features/account/doubao-store';
import { useGenerationStore } from '../../features/generation/store';
import { useSettingsStore } from '../../features/settings/store';
import { useAiConnectionStore } from '../../features/settings/ai-connection-store';
import { accessModeOfProvider, preferredByokEntry } from '../../lib/ai-access';
import { displayModelName } from '../../lib/model-catalog';
import { formatPoints } from '@musefold/domain';
import { cn } from '../../lib/utils';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { useAppStore } from '../../stores/app';
import { toast } from '../../stores/toast';
import {
  AccountIdentityTransition,
  type AccountIdentity,
  type AccountIdentityTransitionState,
} from '../../features/settings/components/AccessTransitions';
import { switchAccountSource } from '../../features/settings/account-source-switch';

export function SidebarAccessSwitcher() {
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
  const currentView = useAppStore((state) => state.currentView);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);
  const preferredAccountSource = useSettingsStore((state) => state.accountImageSource);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [identityTransition, setIdentityTransition] = useState<AccountIdentityTransitionState | null>(null);
  const [petEnabled, setPetEnabled] = useState<boolean | null>(null);
  const [petPending, setPetPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
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
    if (mode === 'account' && !activeDoubao && accountStatus.loggedIn) void refreshQuota().catch(() => {});
  }, [accountStatus.loggedIn, activeDoubao, mode, refreshDoubaoStatus, refreshDoubaoUsage, refreshQuota]);

  useEffect(() => {
    if (!menuOpen && !settingsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const element = event.target as Element;
      if (menuOpen && !element.closest('[data-identity-switcher]')) setMenuOpen(false);
      if (settingsOpen && !element.closest('[data-sidebar-settings-menu]')) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setSettingsOpen(false);
      }
    };
    const closeOnResize = () => {
      setMenuOpen(false);
      setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [menuOpen, settingsOpen]);

  const openSettingsAt = (section: 'account' | 'relay') => {
    setSettingsSection(section);
    setView('settings');
    setMenuOpen(false);
    setSettingsOpen(false);
  };

  const handlePrimaryClick = () => {
    setSettingsOpen(false);
    if (!menuOpen) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setMenuAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 6 });
    }
    setMenuOpen((open) => !open);
  };

  const toggleSettingsOpen = () => {
    const nextOpen = !settingsOpen;
    if (nextOpen) {
      const rect = settingsTriggerRef.current?.getBoundingClientRect();
      if (rect) setSettingsAnchor({ left: Math.max(8, rect.right - 220), bottom: window.innerHeight - rect.top + 6 });
      setMenuOpen(false);
      void api.pet.isEnabled().then((result) => setPetEnabled(result.enabled)).catch(() => setPetEnabled(false));
    }
    setSettingsOpen(nextOpen);
  };

  const togglePet = async () => {
    if (petPending) return;
    setPetPending(true);
    try {
      const result = await api.pet.setEnabled(!petEnabled);
      setPetEnabled(result.enabled);
    } catch (error) {
      toast.error('桌宠状态切换失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setPetPending(false);
    }
  };

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
      setMenuOpen(false);
      const provider = providers.find((item) => item.id === providerId);
      toast.success('生图模型已切换', provider ? `${provider.name} · ${displayModelName(provider.model)}` : undefined);
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
    officialProvider
      && accountStatus.loggedIn
      && accountStatus.health !== 'token-invalid',
  );
  const identityOf = (source: 'doubao' | 'official'): AccountIdentity => source === 'doubao'
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
    if (identityTransition) return;
    // relay 模式下没有「当前账号」，动画的 from 取偏好的账号来源
    const from = mode === 'relay' ? preferredAccountSource : (activeDoubao ? 'doubao' : 'official');
    if (target === from && mode === 'account') {
      setMenuOpen(false);
      return;
    }
    if ((target === 'doubao' && !doubaoReady) || (target === 'official' && !officialReady)) {
      openSettingsAt('account');
      return;
    }
    setMenuOpen(false);
    setIdentityTransition({ from: identityOf(from), to: identityOf(target) });
  }
  const title = mode === 'relay'
    ? activeProvider?.name || '中转站未配置'
    : activeDoubao
      ? doubaoName
      : officialName;
  const detail = mode === 'relay'
    ? displayModelName(activeProvider?.model) || '模型未配置'
    : activeDoubao
      ? doubaoDetail
      : accountBalance;
  const initial = title.charAt(0).toUpperCase();
  const ready = mode === 'relay'
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
      avatarDataUrl: doubaoStatus?.avatarDataUrl,
      onChoose: () => beginAccountSwitch('doubao'),
    },
  ];

  return (
    <div className="flex items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={handlePrimaryClick}
        disabled={Boolean(identityTransition)}
        aria-label={mode === 'relay'
          ? `切换生图身份，当前${title} ${detail}`
          : `选择生图账号，当前${title}`}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-busy={mode === 'account' && Boolean(identityTransition)}
        title={`${title} · ${detail}`}
        className={cn(
          'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-wait disabled:opacity-70',
          menuOpen && 'bg-hover text-primary',
        )}
        data-testid="provider-quick-switch"
        data-identity-switcher
      >
        <span className={cn(
          'relative flex h-7 w-7 shrink-0 items-center justify-center bg-inset text-[11px] font-semibold text-secondary',
          mode === 'account' ? 'overflow-hidden rounded-full border border-border-subtle' : 'rounded-md',
        )}>
          {activeDoubao && doubaoStatus?.avatarDataUrl
            ? <img src={doubaoStatus.avatarDataUrl} alt="" className="h-full w-full object-cover" data-testid="sidebar-doubao-avatar" />
            : mode === 'account'
              ? initial || <UserRound className="h-3.5 w-3.5 text-tertiary" />
              : matchModelBrand(activeProvider?.model) !== 'generic'
                ? <ModelBrandIcon model={activeProvider?.model} className="h-4 w-4" />
                : <Server className="h-4 w-4" />}
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-sidebar', ready ? 'bg-success' : 'bg-tertiary')} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12px] font-medium leading-[1.3] text-primary" data-testid={activeDoubao ? 'sidebar-doubao-account' : mode === 'relay' ? 'sidebar-relay-name' : 'sidebar-official-account'}>
            {title}
          </span>
          <span
            className={cn('block truncate text-meta leading-[1.3]', activeDoubao && doubaoStatus?.usage.remaining === 0 ? 'text-warning' : 'text-tertiary')}
            data-testid={activeDoubao ? 'sidebar-doubao-remaining' : mode === 'relay' ? 'sidebar-relay-model' : 'sidebar-account-balance'}
            aria-live="polite"
          >
            {detail}
          </span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-quaternary transition-transform', menuOpen && 'rotate-180')} />
      </button>

      <button
        ref={settingsTriggerRef}
        type="button"
        onClick={toggleSettingsOpen}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
          currentView === 'settings' ? 'bg-pressed text-accent' : 'text-secondary hover:bg-hover hover:text-primary',
        )}
        aria-label="打开应用菜单"
        aria-haspopup="menu"
        aria-expanded={settingsOpen}
        title="设置"
        data-testid="sidebar-settings"
        data-sidebar-settings-menu
      >
        <Settings className="h-4 w-4 shrink-0" strokeWidth={currentView === 'settings' ? 2.25 : 1.75} />
      </button>

      {settingsOpen && settingsAnchor && createPortal(
        <div
          role="menu"
          aria-label={`${APP_NAME} 应用菜单`}
          data-sidebar-settings-menu
          data-testid="sidebar-settings-menu"
          className="no-drag fixed z-[75] w-[220px] overflow-hidden rounded-lg border border-border-default bg-popover text-[11px] shadow-pop animate-scale-fade-in"
          style={{ left: settingsAnchor.left, bottom: settingsAnchor.bottom }}
        >
          <div className="border-b border-border-subtle px-3 py-2.5">
            <p className="text-[12px] font-semibold text-primary">{APP_NAME}</p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void togglePet()}
              disabled={petPending || petEnabled === null}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-wait disabled:opacity-55"
              data-testid="sidebar-settings-pet-toggle"
            >
              {petPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Power className="h-4 w-4 shrink-0" />}
              <span>{petEnabled ? '隐藏桌宠' : '显示桌宠'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                setView('settings');
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-secondary transition-colors hover:bg-hover hover:text-primary"
              data-testid="sidebar-settings-open"
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span>应用设置</span>
            </button>
          </div>
        </div>,
        document.body,
      )}

      {menuOpen && menuAnchor && createPortal(
        <div
          role="dialog"
          aria-label="切换生图身份"
          data-identity-switcher
          data-testid="identity-switcher"
          className="no-drag fixed z-[70] w-[292px] overflow-hidden rounded-lg border border-border-default bg-popover text-[11px] shadow-pop animate-scale-fade-in"
          style={{ left: menuAnchor.left, bottom: menuAnchor.bottom }}
        >
          <div className="border-b border-border-subtle px-3 py-2.5">
            <p className="text-[11.5px] font-medium text-primary">{title}</p>
            <p className="mt-0.5 text-meta text-tertiary">{detail}</p>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox" aria-label="可用生图身份">
            <p className="px-2 pb-1 pt-1.5 text-meta text-quaternary">生图账号</p>
            {identityAccounts.map((account) => (
              <button
                key={account.source}
                type="button"
                role="option"
                aria-selected={account.active}
                onClick={account.onChoose}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                data-testid={`account-source-option-${account.source}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-inset text-[11px] font-semibold text-secondary">
                  {account.avatarDataUrl
                    ? <img src={account.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                    : account.source === 'official'
                      ? <ModelBrandIcon model="musefold-agent" className="h-4 w-4" />
                      : account.name.charAt(0) || <UserRound className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-primary">{account.name}</span>
                  <span className="mt-0.5 block truncate text-meta text-tertiary">{account.detail}</span>
                </span>
                {account.active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            ))}
            <p className="px-2 pb-1 pt-2 text-meta text-quaternary">中转站</p>
            {relayProviders.map((provider) => {
              const active = mode === 'relay' && provider.id === activeProviderId;
              const pending = provider.id === pendingProviderId;
              return (
                <button
                  key={provider.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={Boolean(pendingProviderId)}
                  onClick={() => void chooseRelayProvider(provider.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  data-testid={`relay-model-option-${provider.id}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
                    {matchModelBrand(provider.model) !== 'generic'
                      ? <ModelBrandIcon model={provider.model} className="h-4 w-4" />
                      : <Server className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-primary">{provider.name}</span>
                    <span className="mt-0.5 block truncate text-meta text-tertiary">{displayModelName(provider.model)}</span>
                  </span>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-tertiary" /> : active && <Check className="h-3.5 w-3.5 text-accent" />}
                </button>
              );
            })}
            {relayProviders.length === 0 && (
              <button
                type="button"
                onClick={() => openSettingsAt('relay')}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-secondary transition-colors hover:bg-hover hover:text-primary"
                data-testid="relay-model-configure"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
                  <Server className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-primary">配置中转站</span>
                  <span className="mt-0.5 block truncate text-meta text-tertiary">自备生图与 Agent 模型网关</span>
                </span>
              </button>
            )}
          </div>
          <div className="border-t border-border-subtle p-1.5">
            <button
              type="button"
              onClick={() => openSettingsAt('relay')}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              data-testid="relay-model-manage"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" /> 管理中转站
            </button>
            <button
              type="button"
              onClick={() => openSettingsAt('account')}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              data-testid="identity-account-settings"
            >
              <UserRound className="h-3.5 w-3.5 shrink-0" /> 账号设置
            </button>
          </div>
        </div>,
        document.body,
      )}

      {identityTransition && (
        <AccountIdentityTransition
          key={`${identityTransition.from.source}-${identityTransition.to.source}`}
          state={identityTransition}
          onSwap={() => switchAccountSource(identityTransition.to.source)}
          onComplete={() => setIdentityTransition(null)}
        />
      )}
    </div>
  );
}
