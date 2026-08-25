// src/features/settings/components/RelaySection.tsx
// 中转站 —— v2 设置整合：生图与 Agent 两条自备通道合并为一页，
// 顶部分段控件切换 tab（relayTab 存于 settings store，深链 providers/ai 预选对应 tab）。
import { SettingsSegmentedControl } from '@musefold/product-ui';
import { SectionShell } from '../components/SectionShell';
import { useSettingsStore, type RelayTab } from '../store';
import { capabilities } from '../../../runtime/capabilities';
import { ProvidersRelayPanel } from './ProvidersSection';
import { AiConnectionsRelayPanel } from './AiConnectionsSection';

export function RelaySection() {
  const relayTab = useSettingsStore((state) => state.relayTab);
  const setRelayTab = useSettingsStore((state) => state.setRelayTab);

  const providersVisible = capabilities.byokProviders;
  const aiVisible = capabilities.agent;
  const options: Array<{ value: RelayTab; label: string }> = [
    ...(providersVisible ? [{ value: 'providers' as const, label: '生图' }] : []),
    ...(aiVisible ? [{ value: 'ai' as const, label: 'Agent' }] : []),
  ];
  // 深链指向的 tab 被能力门控关闭时回落到另一个可见 tab
  const effectiveTab: RelayTab =
    relayTab === 'providers' && !providersVisible
      ? 'ai'
      : relayTab === 'ai' && !aiVisible
        ? 'providers'
        : relayTab;

  return (
    <SectionShell
      title="中转站"
      description="配置自备的生图与 Agent 模型网关，密钥仅保存在本机系统密钥链。"
    >
      {options.length > 1 && (
        <div className="relay-tab-bar">
          <SettingsSegmentedControl
            value={effectiveTab}
            options={options}
            onChange={setRelayTab}
            testIdPrefix="relay-tab"
            ariaLabel="中转站通道"
          />
        </div>
      )}
      {effectiveTab === 'providers' ? <ProvidersRelayPanel /> : <AiConnectionsRelayPanel />}
    </SectionShell>
  );
}
