// src/features/settings/components/OpenCapabilitiesSection.tsx
// 开放能力 —— v2 设置整合：自动化 + 已连接应用（Cloud MCP）合并为一页。
import { SectionShell } from '../components/SectionShell';
import { AutomationSection } from './AutomationSection';
import { ConnectedAppsSection } from './ConnectedAppsSection';

export function OpenCapabilitiesSection() {
  return (
    <SectionShell title="开放能力" description="把 Musefold 的能力开放给本机 Agent、脚本与已连接的 AI 客户端。">
      <AutomationSection />
      <ConnectedAppsSection />
    </SectionShell>
  );
}
