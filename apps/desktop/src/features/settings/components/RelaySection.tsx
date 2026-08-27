// 中转站 —— v2 设置整合：生图与 Agent 两条自备通道合并为一页，
// 顶部分段控件切换 tab（relayTab 存于 settings store，深链 providers/ai 预选对应 tab）。
// dirty 守卫:面板有未保存修改时切 tab 先弹 InlineConfirm(放弃修改/继续编辑),
// dirty 信号由各 tab section 经 relay-dirty-store 上抛。
import { useState } from 'react';
import { SettingsSegmentedControl } from '@musefold/product-ui';
import { SectionShell } from '../components/SectionShell';
import { InlineConfirm } from '../components/MasterDetail';
import { useSettingsStore, type RelayTab } from '../store';
import { useRelayDirtyStore } from '../relay-dirty-store';
import { capabilities } from '../../../runtime/capabilities';
import { ProvidersRelayPanel } from './ProvidersSection';
import { AiConnectionsRelayPanel } from './AiConnectionsSection';

export function RelaySection() {
  const relayTab = useSettingsStore((state) => state.relayTab);
  const setRelayTab = useSettingsStore((state) => state.setRelayTab);
  const relayDirty = useRelayDirtyStore((state) => state.dirty);
  // 被守卫拦下的目标 tab:确认「放弃修改」后再切换
  const [pendingTab, setPendingTab] = useState<RelayTab | null>(null);

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

  const requestTab = (next: RelayTab) => {
    if (next === effectiveTab) return;
    if (relayDirty) {
      setPendingTab(next);
      return;
    }
    setRelayTab(next);
  };

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
            onChange={requestTab}
            testIdPrefix="relay-tab"
            ariaLabel="中转站通道"
          />
        </div>
      )}
      {pendingTab && (
        <div className="relay-tab-guard" data-testid="relay-tab-dirty-guard">
          <InlineConfirm
            label="未保存的修改"
            confirmLabel="放弃修改"
            cancelLabel="继续编辑"
            danger
            onConfirm={() => {
              setRelayTab(pendingTab);
              setPendingTab(null);
            }}
            onCancel={() => setPendingTab(null)}
          />
        </div>
      )}
      {effectiveTab === 'providers' ? <ProvidersRelayPanel /> : <AiConnectionsRelayPanel />}
    </SectionShell>
  );
}
