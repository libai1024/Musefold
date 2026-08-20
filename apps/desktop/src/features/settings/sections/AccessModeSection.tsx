import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Loader2,
  QrCode,
  Server,
  UserRound,
} from '../../../components/ui/icons';
import { ModelBrandIcon, matchModelBrand } from '../../../components/ui/brand-icons';
import { formatPoints } from '@musefold/domain';
import {
  accessModeOfProvider,
  accountImageSourceOfProvider,
  preferredByokEntry,
  verifyAiAccessConnectivity,
  type AccountImageSource,
  type AiAccessMode,
} from '../../../lib/ai-access';
import { displayModelName } from '../../../lib/model-catalog';
import { cn } from '../../../lib/utils';
import { toast } from '../../../stores/toast';
import { useAccountStore } from '../../account/store';
import { useDoubaoAccountStore } from '../../account/doubao-store';
import { useGenerationStore } from '../../generation/store';
import { useAiConnectionStore } from '../ai-connection-store';
import {
  AccessModeTransition,
  AccountIdentityTransition,
  type AccessModeTransitionState,
  type AccountIdentity,
  type AccountIdentityTransitionState,
} from '../components/AccessTransitions';
import { SectionShell, SettingRow } from '../components/SectionShell';
import { useSettingsStore } from '../store';
import { switchAccountSource } from '../account-source-switch';

export function AccessModeSection() {
  const providers = useGenerationStore((state) => state.providers);
  const activeProviderId = useGenerationStore((state) => state.activeProviderId);
  const setActiveProvider = useGenerationStore((state) => state.setActive);
  const testProvider = useGenerationStore((state) => state.testProvider);

  const connections = useAiConnectionStore((state) => state.connections);
  const connectionsLoaded = useAiConnectionStore((state) => state.loaded);
  const connectionsLoading = useAiConnectionStore((state) => state.loading);
  const loadConnections = useAiConnectionStore((state) => state.load);
  const setActiveConnection = useAiConnectionStore((state) => state.setActive);
  const validateConnection = useAiConnectionStore((state) => state.validate);

  const accountStatus = useAccountStore((state) => state.status);
  const doubaoStatus = useDoubaoAccountStore((state) => state.status);
  const refreshDoubaoStatus = useDoubaoAccountStore((state) => state.refreshStatus);
  const refreshDoubaoUsage = useDoubaoAccountStore((state) => state.refreshUsage);

  const preferredAccountSource = useSettingsStore((state) => state.accountImageSource);
  const setPreferredAccountSource = useSettingsStore((state) => state.setAccountImageSource);
  const setSection = useSettingsStore((state) => state.setSection);

  const [modeTransition, setModeTransition] = useState<AccessModeTransitionState | null>(null);
  const [identityTransition, setIdentityTransition] = useState<AccountIdentityTransitionState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!connectionsLoaded && !connectionsLoading) void loadConnections().catch(() => {});
  }, [connectionsLoaded, connectionsLoading, loadConnections]);

  useEffect(() => {
    const doubao = providers.find((provider) => provider.type === 'doubao-web');
    if (!doubao?.hasKey) return;
    void refreshDoubaoStatus().catch(() => refreshDoubaoUsage().catch(() => {}));
  }, [providers, refreshDoubaoStatus, refreshDoubaoUsage]);

  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const activeConnection = connections.find((connection) => connection.isActive) ?? connections[0] ?? null;
  const currentMode = accessModeOfProvider(activeProvider) ?? 'account';
  const currentAccountSource = accountImageSourceOfProvider(activeProvider) ?? preferredAccountSource;
  const doubaoProvider = providers.find((provider) => provider.type === 'doubao-web') ?? null;
  const officialProvider = providers.find((provider) => provider.managedBy === 'account') ?? null;
  const officialConnection = connections.find((connection) => connection.managedBy === 'account') ?? null;
  const relayProviders = useMemo(
    () => providers.filter((provider) => provider.managedBy !== 'account' && provider.type !== 'doubao-web'),
    [providers],
  );
  const relayConnections = useMemo(
    () => connections.filter((connection) => connection.managedBy !== 'account'),
    [connections],
  );
  const relayProvider = preferredByokEntry(relayProviders);
  const relayConnection = preferredByokEntry(relayConnections);
  const doubaoReady = Boolean(doubaoProvider?.hasKey && (doubaoStatus?.loggedIn ?? true));
  const officialReady = Boolean(
    accountStatus.loggedIn
      && accountStatus.health !== 'token-invalid'
      && officialProvider
      && officialConnection,
  );

  const accountBalance = !accountStatus.loggedIn
    ? '未登录'
    : accountStatus.health === 'token-invalid'
      ? '登录已失效'
      : accountStatus.quota
        ? `${formatPoints(accountStatus.quota.value)} 积分`
        : '余额读取中';
  const doubaoName = doubaoStatus?.accountName?.trim() || '豆包账号';
  const doubaoDetail = doubaoStatus
    ? `今日剩余 ${doubaoStatus.usage.remaining} / ${doubaoStatus.usage.limit} 次`
    : doubaoProvider?.hasKey
      ? '已连接，次数读取中'
      : '未登录';

  const identityOf = (source: AccountImageSource): AccountIdentity => source === 'doubao'
    ? {
        source,
        name: doubaoName,
        detail: doubaoDetail,
        avatarDataUrl: doubaoStatus?.avatarDataUrl,
      }
    : {
        source,
        name: accountStatus.username?.trim() || 'Musefold 官方账号',
        detail: accountBalance,
      };

  const chooseAvailableAccountSource = (): AccountImageSource | null => {
    if (preferredAccountSource === 'doubao' && doubaoReady) return 'doubao';
    if (preferredAccountSource === 'official' && officialReady) return 'official';
    if (doubaoReady) return 'doubao';
    if (officialReady) return 'official';
    return null;
  };

  const activateTarget = async (targetMode: AiAccessMode, accountSource?: AccountImageSource) => {
    setPending(true);
    if (targetMode === 'account') {
      try {
        if (!accountSource) throw new Error('没有可用的账号');
        await switchAccountSource(accountSource);
      } finally {
        setPending(false);
      }
      return;
    }
    let connectivityPassed = false;
    const previousProviderId = useGenerationStore.getState().activeProviderId;
    const previousConnection = useAiConnectionStore.getState().connections.find((connection) => connection.isActive) ?? null;
    try {
      if (targetMode === 'relay') {
        if (!relayProvider || !relayConnection) throw new Error('请先分别配置生图与 Agent 中转站');
        await verifyAiAccessConnectivity([
          {
            label: '生图',
            run: async () => {
              const result = await testProvider(relayProvider.id);
              return { ok: result.state === 'ok', message: result.message || '生图模型连接失败' };
            },
          },
          {
            label: 'Agent',
            run: async () => {
              const result = await validateConnection(relayConnection.id);
              return { ok: result.ok, message: result.message || 'Agent 模型连接失败' };
            },
          },
        ]);
        connectivityPassed = true;
        if (previousProviderId !== relayProvider.id) await setActiveProvider(relayProvider.id);
        if (previousConnection?.id !== relayConnection.id) await setActiveConnection(relayConnection.id);
        toast.success('已切换到中转站模式', `${relayProvider.name} · ${displayModelName(relayProvider.model)}`);
        return;
      }

    } catch (error) {
      await Promise.allSettled([
        previousProviderId && useGenerationStore.getState().activeProviderId !== previousProviderId
          ? setActiveProvider(previousProviderId)
          : Promise.resolve(),
        previousConnection && useAiConnectionStore.getState().connections.find((connection) => connection.isActive)?.id !== previousConnection.id
          ? setActiveConnection(previousConnection.id)
          : Promise.resolve(),
      ]);
      toast.error(
        connectivityPassed ? '切换接入方式失败' : '联通性测试未通过',
        error instanceof Error ? error.message : '请稍后重试。',
      );
      throw error;
    } finally {
      setPending(false);
    }
  };

  const chooseMode = (target: AiAccessMode) => {
    if (pending || modeTransition || identityTransition || target === currentMode) return;
    if (target === 'relay' && (!relayProvider || !relayConnection)) {
      toast.error('中转站尚未完整配置', '请先分别配置生图与 Agent 中转站。');
      setSection(!relayProvider ? 'providers' : 'ai');
      return;
    }
    const accountSource = target === 'account' ? chooseAvailableAccountSource() : undefined;
    if (target === 'account' && !accountSource) {
      toast.error('账号模式尚未就绪', '请先登录豆包或 Musefold 官方账号。');
      setSection(preferredAccountSource === 'official' ? 'account' : 'doubao');
      return;
    }
    setModeTransition({
      from: currentMode,
      to: target,
      stationName: relayProvider?.name ?? null,
      stationModel: relayProvider?.model ?? null,
    });
  };

  const chooseAccount = (target: AccountImageSource) => {
    if (pending || modeTransition || identityTransition) return;
    if (target === 'doubao' && !doubaoReady) {
      setSection('doubao');
      return;
    }
    if (target === 'official' && !officialReady) {
      setSection('account');
      return;
    }
    if (target === currentAccountSource && currentMode === 'account') return;
    if (currentMode !== 'account') {
      setPreferredAccountSource(target);
      toast.success('已设置账号模式的默认账号', target === 'doubao' ? doubaoName : 'Musefold 官方账号');
      return;
    }
    setIdentityTransition({ from: identityOf(currentAccountSource), to: identityOf(target) });
  };

  return (
    <SectionShell
      title="AI 接入"
      description="在账号模式与自备中转站之间选择。模式切换前会验证目标通道，失败时保留当前配置。"
    >
      <SettingRow
        label="接入模式"
        hint={currentMode === 'account'
          ? '生图使用豆包或 Musefold 官方账号。'
          : '生图与 Agent 均使用自备中转站，不调用账号额度。'}
        data-testid="settings-access-mode"
      >
        <div className="inline-flex w-full rounded-md bg-inset p-0.5 sm:w-auto" role="radiogroup" aria-label="AI 接入模式">
          {(['account', 'relay'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={currentMode === mode}
              onClick={() => chooseMode(mode)}
              disabled={pending}
              data-testid={`settings-access-mode-${mode}`}
              className={cn(
                'h-7 flex-1 rounded-[5px] px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] sm:flex-none',
                currentMode === mode ? 'bg-elevated text-primary shadow-xs' : 'text-tertiary hover:text-primary',
              )}
            >
              {mode === 'account' ? '账号模式' : '中转站模式'}
            </button>
          ))}
        </div>
      </SettingRow>

      {currentMode === 'account' ? (
        <div className="mt-7" data-testid="settings-account-source-picker">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <h3 className="text-[12.5px] font-medium text-primary">生图账号</h3>
              <p className="mt-0.5 text-[10.5px] text-tertiary">豆包与官方账号之间切换，不改变接入模式。</p>
            </div>
            {pending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-tertiary" />}
          </div>
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            <AccountChoice
              source="doubao"
              active={currentAccountSource === 'doubao'}
              ready={doubaoReady}
              title={doubaoName}
              detail={doubaoDetail}
              avatarDataUrl={doubaoStatus?.avatarDataUrl}
              onClick={() => chooseAccount('doubao')}
            />
            <AccountChoice
              source="official"
              active={currentAccountSource === 'official'}
              ready={officialReady}
              title={accountStatus.username?.trim() || 'Musefold 官方账号'}
              detail={accountBalance}
              onClick={() => chooseAccount('official')}
            />
          </div>
        </div>
      ) : (
        <div className="mt-7" data-testid="settings-relay-summary">
          <div className="mb-2">
            <h3 className="text-[12.5px] font-medium text-primary">当前中转站</h3>
            <p className="mt-0.5 text-[10.5px] text-tertiary">左下角可快速切换生图模型；连接配置保留在高级设置。</p>
          </div>
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            <RelaySummaryRow
              label="生图中转站"
              name={relayProvider?.name ?? '未配置'}
              model={relayProvider?.model ?? null}
              onClick={() => setSection('providers')}
            />
            <RelaySummaryRow
              label="Agent 中转站"
              name={relayConnection?.name ?? '未配置'}
              model={relayConnection?.model ?? null}
              onClick={() => setSection('ai')}
            />
          </div>
        </div>
      )}

      {modeTransition && (
        <AccessModeTransition
          key={`${modeTransition.from}-${modeTransition.to}`}
          state={modeTransition}
          onSwap={() => activateTarget(modeTransition.to, modeTransition.to === 'account' ? chooseAvailableAccountSource() ?? undefined : undefined)}
          onComplete={() => setModeTransition(null)}
        />
      )}
      {identityTransition && (
        <AccountIdentityTransition
          key={`${identityTransition.from.source}-${identityTransition.to.source}`}
          state={identityTransition}
          onSwap={() => activateTarget('account', identityTransition.to.source)}
          onComplete={() => setIdentityTransition(null)}
        />
      )}
    </SectionShell>
  );
}

function AccountChoice({ source, active, ready, title, detail, avatarDataUrl, onClick }: {
  source: AccountImageSource;
  active: boolean;
  ready: boolean;
  title: string;
  detail: string;
  avatarDataUrl?: string | null;
  onClick: () => void;
}) {
  const initial = title.trim().charAt(0).toUpperCase();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`settings-account-source-${source}`}
      className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-inset text-[11px] font-semibold text-secondary">
        {avatarDataUrl
          ? <img src={avatarDataUrl} alt="" className="h-full w-full object-cover" />
          : source === 'official'
            ? <ModelBrandIcon model="musefold-agent" className="h-4 w-4" />
            : initial || <QrCode className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-primary">{title}</span>
        <span className={cn('mt-0.5 block truncate text-[10.5px]', ready ? 'text-tertiary' : 'text-warning')}>
          {ready ? detail : `${detail} · 点击配置`}
        </span>
      </span>
      {active ? <Check className="h-4 w-4 shrink-0 text-accent" /> : <ChevronRight className="h-4 w-4 shrink-0 text-quaternary" />}
    </button>
  );
}

function RelaySummaryRow({ label, name, model, onClick }: {
  label: string;
  name: string;
  model: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
        {model && matchModelBrand(model) !== 'generic'
          ? <ModelBrandIcon model={model} className="h-4 w-4" />
          : <Server className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] text-tertiary">{label}</span>
        <span className="mt-0.5 block truncate text-[12px] font-medium text-primary">
          {name} · {displayModelName(model) || '模型未配置'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-quaternary" />
    </button>
  );
}
