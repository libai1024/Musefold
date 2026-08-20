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
import { accessModeOfProvider } from '../../lib/ai-access';
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
  const accountStatus = useAccountStore((state) => state.status);
  const refreshQuota = useAccountStore((state) => state.refreshQuota);
  const doubaoStatus = useDoubaoAccountStore((state) => state.status);
  const doubaoStatusLoading = useDoubaoAccountStore((state) => state.loading);
  const refreshDoubaoStatus = useDoubaoAccountStore((state) => state.refreshStatus);
  const refreshDoubaoUsage = useDoubaoAccountStore((state) => state.refreshUsage);
  const aiConnections = useAiConnectionStore((state) => state.connections);
  const aiConnectionsLoaded = useAiConnectionStore((state) => state.loaded);
  const loadAiConnections = useAiConnectionStore((state) => state.load);
  const currentView = useAppStore((state) => state.currentView);
  const setView = useAppStore((state) => state.setView);
  const setSettingsSection = useSettingsStore((state) => state.setSection);

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<{ left: number; bottom: number } | null>(null);
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
  const officialConnection = aiConnections.find((connection) => connection.managedBy === 'account') ?? null;
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
    if (mode === 'account' && accountStatus.loggedIn) void refreshQuota().catch(() => {});
  }, [accountStatus.loggedIn, activeDoubao, mode, refreshDoubaoStatus, refreshDoubaoUsage, refreshQuota]);

  useEffect(() => {
    if (!modelMenuOpen && !settingsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const element = event.target as Element;
      if (modelMenuOpen && !element.closest('[data-relay-model-switcher]')) setModelMenuOpen(false);
      if (settingsOpen && !element.closest('[data-sidebar-settings-menu]')) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
        setSettingsOpen(false);
      }
    };
    const closeOnResize = () => {
      setModelMenuOpen(false);
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
  }, [modelMenuOpen, settingsOpen]);

  const openSettingsAt = (section: 'access' | 'providers') => {
    setSettingsSection(section);
    setView('settings');
    setModelMenuOpen(false);
    setSettingsOpen(false);
  };

  const handlePrimaryClick = () => {
    setSettingsOpen(false);
    if (!modelMenuOpen) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setModelMenuAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 6 });
    }
    setModelMenuOpen((open) => !open);
  };

  const toggleSettingsOpen = () => {
    const nextOpen = !settingsOpen;
    if (nextOpen) {
      const rect = settingsTriggerRef.current?.getBoundingClientRect();
      if (rect) setSettingsAnchor({ left: Math.max(8, rect.right - 220), bottom: window.innerHeight - rect.top + 6 });
      setModelMenuOpen(false);
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
      await setActiveProvider(providerId);
      setModelMenuOpen(false);
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
      && officialConnection
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
    const from = activeDoubao ? 'doubao' : 'official';
    if (target === from) {
      setModelMenuOpen(false);
      return;
    }
    if (target === 'doubao' && !doubaoReady) {
      toast.error('豆包账号不可用', '请先在设置中完成豆包扫码登录。');
      return;
    }
    if (target === 'official' && !officialReady) {
      toast.error('Musefold 官方账号不可用', '请先在设置中登录官方账号。');
      return;
    }
    setModelMenuOpen(false);
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

  return (
    <div className="flex items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={handlePrimaryClick}
        disabled={Boolean(identityTransition)}
        aria-label={mode === 'relay'
          ? `切换生图模型，当前${title} ${detail}`
          : `选择生图账号，当前${title}`}
        aria-haspopup="dialog"
        aria-expanded={modelMenuOpen}
        aria-busy={mode === 'account' && Boolean(identityTransition)}
        title={`${title} · ${detail}`}
        className={cn(
          'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-wait disabled:opacity-70',
          modelMenuOpen && 'bg-hover text-primary',
        )}
        data-testid="provider-quick-switch"
        data-relay-model-switcher
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
            className={cn('block truncate text-[10.5px] leading-[1.3]', activeDoubao && doubaoStatus?.usage.remaining === 0 ? 'text-warning' : 'text-tertiary')}
            data-testid={activeDoubao ? 'sidebar-doubao-remaining' : mode === 'relay' ? 'sidebar-relay-model' : 'sidebar-account-balance'}
            aria-live="polite"
          >
            {detail}
          </span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-quaternary transition-transform', modelMenuOpen && 'rotate-180')} />
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
        <Settings className="h-4 w-4 shrink-0" strokeWidth={currentView === 'settings' ? 2.3 : 2} />
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

      {modelMenuOpen && modelMenuAnchor && createPortal(
        <div
          role="dialog"
          aria-label={mode === 'account' ? '切换生图账号' : '切换生图模型'}
          data-relay-model-switcher
          data-testid={mode === 'account' ? 'account-source-switcher' : 'relay-model-switcher'}
          className="no-drag fixed z-[70] w-[292px] overflow-hidden rounded-lg border border-border-default bg-popover text-[11px] shadow-pop animate-scale-fade-in"
          style={{ left: modelMenuAnchor.left, bottom: modelMenuAnchor.bottom }}
        >
          {mode === 'account' ? (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <p className="text-[11.5px] font-medium text-primary">切换生图账号</p>
                <p className="mt-0.5 text-[10px] text-tertiary">选择后验证账号并播放切换动画</p>
              </div>
              <div className="p-1.5" role="listbox" aria-label="可用生图账号">
                {([
                  {
                    source: 'doubao' as const,
                    name: doubaoName,
                    detail: doubaoReady ? doubaoDetail : '未登录，请先在设置中扫码',
                    available: doubaoReady,
                    avatarDataUrl: doubaoStatus?.avatarDataUrl,
                  },
                  {
                    source: 'official' as const,
                    name: officialName,
                    detail: officialReady ? accountBalance : '未登录，请先登录官方账号',
                    available: officialReady,
                    avatarDataUrl: null,
                  },
                ]).map((account) => {
                  const active = account.source === (activeDoubao ? 'doubao' : 'official');
                  return (
                    <button
                      key={account.source}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={!account.available}
                      onClick={() => beginAccountSwitch(account.source)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
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
                        <span className="mt-0.5 block truncate text-[10px] text-tertiary">{account.detail}</span>
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="border-b border-border-subtle px-3 py-2.5">
                <p className="text-[11.5px] font-medium text-primary">切换生图模型</p>
                <p className="mt-0.5 text-[10px] text-tertiary">当前为中转站模式</p>
              </div>
              <div className="max-h-[280px] overflow-y-auto p-1.5" role="listbox" aria-label="可用生图模型">
                {relayProviders.map((provider) => {
                  const active = provider.id === activeProviderId;
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
                        <span className="mt-0.5 block truncate text-[10px] text-tertiary">{displayModelName(provider.model)}</span>
                      </span>
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-tertiary" /> : active && <Check className="h-3.5 w-3.5 text-accent" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => openSettingsAt('providers')}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border-subtle px-2 py-2.5 text-[10px] text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                data-testid="relay-model-manage"
              >
                <Settings2 className="h-3.5 w-3.5" /> 管理生图中转站
              </button>
            </>
          )}
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
