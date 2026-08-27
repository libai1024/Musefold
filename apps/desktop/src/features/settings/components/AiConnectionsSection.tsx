// src/features/settings/components/AiConnectionsSection.tsx
// 中转站分区「Agent」tab 内容：master-detail 分栏，就地编辑。
// v2 设置整合：外壳、通道边界事实卡与页脚脚注移除，本组件只承担 Agent 通道面板。
// dirty 守卫:左栏切换/新建前若面板有未保存修改,先弹 InlineConfirm(放弃修改/继续编辑),
// 并经 relay-dirty-store 上抛给 RelaySection 拦截 tab 切换。
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, MessageSquareText, Plus } from '../../../components/ui/icons';
import type { AiConnectionPreset } from '@musefold/desktop-contracts/ai';
import { Button } from '../../../components/ui/button';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { AI_CONNECTION_RESTART_REQUIRED } from '../ai-connection-errors';
import { useAiConnectionStore } from '../ai-connection-store';
import { AiConnectionDetailPanel } from '../components/AiConnectionDetailPanel';
import { InlineConfirm, MasterDetail, MasterDetailItem } from '../components/MasterDetail';
import { resolveConnectionDot } from '../components/connection-status';
import { SettingsCard } from '../components/SectionShell';
import { useRelayDirtyStore } from '../relay-dirty-store';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { accessModeOfProvider } from '../../../lib/ai-access';

/** 被守卫拦下的切换意图:确认「放弃修改」后再执行 */
type PendingSwitch =
  | { kind: 'select'; id: string }
  | { kind: 'create'; presetId?: AiConnectionPreset['id'] };

export function AiConnectionsRelayPanel() {
  const connections = useAiConnectionStore((state) => state.connections);
  const presets = useAiConnectionStore((state) => state.presets);
  const loaded = useAiConnectionStore((state) => state.loaded);
  const loading = useAiConnectionStore((state) => state.loading);
  const error = useAiConnectionStore((state) => state.error);
  const load = useAiConnectionStore((state) => state.load);
  const testStatus = useAiConnectionStore((state) => state.testStatus);
  const providers = useGenerationStore((state) => state.providers);
  const activeProviderId = useGenerationStore((state) => state.activeProviderId);
  const stationConnections = useMemo(
    () => connections.filter((connection) => connection.managedBy !== 'account'),
    [connections],
  );
  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const relayMode = accessModeOfProvider(activeProvider) === 'relay';

  // 选中态:null = 跟随默认/首条;creating 非空 = 新建草稿(未落库)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ presetId?: AiConnectionPreset['id'] } | null>(null);
  const selectedConnection = creating
    ? null
    : stationConnections.find((c) => c.id === selectedId) ??
      stationConnections.find((c) => c.isActive) ??
      stationConnections[0] ??
      null;

  // dirty 守卫:面板 dirty 上抛 + 待执行切换;tab 层经 relay-dirty-store 读取
  const [panelDirty, setPanelDirty] = useState(false);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const setRelayDirty = useRelayDirtyStore((s) => s.setDirty);
  useEffect(() => {
    setRelayDirty(panelDirty);
  }, [panelDirty, setRelayDirty]);
  useEffect(() => () => setRelayDirty(false), [setRelayDirty]);

  useEffect(() => {
    if (!loaded && !loading) void load().catch(() => {});
  }, [load, loaded, loading]);

  const startCreate = (presetId?: AiConnectionPreset['id']) => {
    setSelectedId(null);
    setCreating(presetId ? { presetId } : {});
  };

  const applyPending = () => {
    if (!pending) return;
    if (pending.kind === 'select') {
      setCreating(null);
      setSelectedId(pending.id);
    } else {
      startCreate(pending.presetId);
    }
    setPending(null);
  };

  const requestSelect = (id: string) => {
    if (!creating && id === (selectedConnection?.id ?? null)) return;
    if (panelDirty) {
      setPending({ kind: 'select', id });
      return;
    }
    setCreating(null);
    setSelectedId(id);
  };

  const requestCreate = (presetId?: AiConnectionPreset['id']) => {
    if (panelDirty) {
      setPending({ kind: 'create', presetId });
      return;
    }
    startCreate(presetId);
  };

  const dirtyGuard = pending ? (
    <InlineConfirm
      label="未保存的修改"
      confirmLabel="放弃修改"
      cancelLabel="继续编辑"
      danger
      testId="settings-ai-dirty-guard"
      onConfirm={applyPending}
      onCancel={() => setPending(null)}
    />
  ) : undefined;

  const showMasterDetail = stationConnections.length > 0 || creating !== null;

  if (loading && !loaded) {
    return (
      <div className="flex min-h-36 items-center justify-center gap-2 text-[11px] text-tertiary" data-testid="settings-ai-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在读取 AI 连接…
      </div>
    );
  }

  if (error && stationConnections.length === 0) {
    return (
      <div className="rounded-md border border-danger/35 bg-danger/5 px-4 py-4" role="alert" data-testid="settings-ai-error">
        <p className="text-[12px] font-medium text-danger">AI 连接读取失败</p>
        <p className="mt-1 text-meta text-secondary">{error}</p>
        <div className="mt-3 flex gap-2">
          {error === AI_CONNECTION_RESTART_REQUIRED && (
            <Button size="sm" variant="primary" onClick={() => void api.system.relaunch()} data-testid="settings-ai-relaunch">
              立即重启
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
        </div>
      </div>
    );
  }

  if (!showMasterDetail) {
    // 空态对齐生图版式:居中 max-w-md 列、图标砖在标题上方、divider 行 + chevron hover 位移
    return (
      <div
        className="mx-auto flex w-full max-w-md flex-col px-6 py-8"
        data-testid="settings-ai-empty"
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-inset text-secondary"
          aria-hidden="true"
        >
          <MessageSquareText className="h-5 w-5" />
        </span>
        <p className="mt-3 text-[13px] font-medium text-primary">连接一个可用的文本模型</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-tertiary">
          API Key 由你提供并在本机加密保存。没有连接也不影响空白搭建、Prompt 标注、YAML 或 Skill 手动导入。
        </p>

        <div className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
          {presets.slice(0, 6).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => startCreate(preset.id)}
              data-testid={`settings-ai-quick-${preset.id}`}
              className="no-drag group flex w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[12px] font-medium text-primary">
                  {preset.name}
                  {preset.recommended && (
                    <span className="text-meta font-normal text-tertiary">推荐</span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-1 block text-meta leading-relaxed text-tertiary">
                  {preset.routeKind === 'direct' ? '厂商直连' : '兼容网关'}
                  {preset.hint ? ` · ${preset.hint}` : ''}
                </span>
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => startCreate()}
            data-testid="settings-ai-quick-custom"
            className="no-drag group flex w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <Plus className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
            <span className="flex-1 text-[12px] font-medium text-primary">自定义添加连接</span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    );
  }

  return (
    <SettingsCard
      title="已配置连接"
      bodyClassName="settings-md-card"
      data-testid="settings-ai-list"
    >
      <MasterDetail
        testId="settings-ai-master-detail"
        rail={
          <>
            {stationConnections.map((connection) => (
              <MasterDetailItem
                key={connection.id}
                icon={<ModelBrandIcon model={connection.model} className="h-4 w-4" />}
                title={connection.name}
                meta={connection.model}
                metaMono
                statusDot={resolveConnectionDot({
                  hasKey: connection.hasKey,
                  testState: testStatus[connection.id]?.state,
                })}
                active={connection.isActive}
                selected={!creating && selectedConnection?.id === connection.id}
                onClick={() => requestSelect(connection.id)}
                testId={`settings-ai-row-${connection.id}`}
              />
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="settings-md-new text-tertiary"
              onClick={() => requestCreate()}
              data-testid="settings-ai-new"
            >
              <Plus className="h-3.5 w-3.5" /> 新建连接
            </Button>
          </>
        }
      >
        <AiConnectionDetailPanel
          key={creating ? 'new' : (selectedConnection?.id ?? 'none')}
          connection={selectedConnection}
          presetSeed={creating?.presetId ?? null}
          relayMode={relayMode}
          onDirtyChange={setPanelDirty}
          dirtyGuard={dirtyGuard}
          onCreated={(id) => {
            setCreating(null);
            setSelectedId(id);
          }}
          onDiscardNew={() => setCreating(null)}
          onDeleted={() => setSelectedId(null)}
        />
      </MasterDetail>
    </SettingsCard>
  );
}
