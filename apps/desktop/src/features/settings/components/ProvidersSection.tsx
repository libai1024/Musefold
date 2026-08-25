// src/features/settings/components/ProvidersSection.tsx
// 中转站分区「生图」tab 内容：master-detail 分栏，就地编辑。
// v2 设置整合：外壳与「通道边界」事实卡上移/删除，本组件只承担生图通道面板。
import { useMemo, useState } from 'react';
import { Plus } from '../../../components/ui/icons';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { SettingsCard } from '../components/SectionShell';
import { MasterDetail, MasterDetailItem } from '../components/MasterDetail';
import { ProviderDetailPanel } from '../components/ProviderDetailPanel';
import { resolveConnectionDot } from '../components/connection-status';
import { ProviderEmptyGuide } from '@renderer/runtime/generation-access';
import { accessModeOfProvider } from '../../../lib/ai-access';
import { displayModelName } from '../../../lib/model-catalog';

export function ProvidersRelayPanel() {
  const providers = useGenerationStore((s) => s.providers);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const testStatus = useGenerationStore((s) => s.testStatus);
  const stationProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.managedBy !== 'account' && provider.type !== 'doubao-web',
      ),
    [providers],
  );
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const relayMode = accessModeOfProvider(activeProvider) === 'relay';

  // 选中态:null = 跟随默认/首条;creating 非空 = 新建草稿(未落库)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ presetId?: string } | null>(null);
  const selectedProvider = creating
    ? null
    : stationProviders.find((p) => p.id === selectedId) ??
      stationProviders.find((p) => p.id === activeProviderId) ??
      stationProviders[0] ??
      null;

  const startCreate = (presetId?: string) => {
    setSelectedId(null);
    setCreating(presetId ? { presetId } : {});
  };

  if (stationProviders.length === 0 && !creating) {
    return <ProviderEmptyGuide context="settings" testId="settings-empty-provider" onOpenNew={startCreate} />;
  }

  return (
    <SettingsCard
      title="已配置服务商"
      bodyClassName="settings-md-card"
      data-testid="settings-provider-list"
    >
      <MasterDetail
        testId="settings-provider-master-detail"
        rail={
          <>
            {stationProviders.map((p) => {
              const isDoubaoWeb = p.type === 'doubao-web';
              // doubao-web 无密钥概念,状态点只随测试状态走;其余类型缺密钥优先告警
              const statusDot = resolveConnectionDot({
                hasKey: p.hasKey,
                keyAgnostic: isDoubaoWeb,
                testState: testStatus[p.id]?.state,
              });
              return (
                <MasterDetailItem
                  key={p.id}
                  icon={<ModelBrandIcon model={p.model} className="h-4 w-4" />}
                  title={p.name}
                  meta={displayModelName(p.model)}
                  metaMono
                  statusDot={statusDot}
                  active={p.id === activeProviderId}
                  selected={!creating && selectedProvider?.id === p.id}
                  onClick={() => {
                    setCreating(null);
                    setSelectedId(p.id);
                  }}
                  testId={`settings-provider-row-${p.id}`}
                />
              );
            })}
            <Button
              size="sm"
              variant="ghost"
              className="settings-md-new text-tertiary"
              onClick={() => startCreate()}
              data-testid="settings-provider-new"
            >
              <Plus className="h-3.5 w-3.5" /> 新建服务商
            </Button>
          </>
        }
      >
        <ProviderDetailPanel
          key={creating ? 'new' : (selectedProvider?.id ?? 'none')}
          provider={selectedProvider}
          presetSeed={creating?.presetId ?? null}
          relayMode={relayMode}
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
