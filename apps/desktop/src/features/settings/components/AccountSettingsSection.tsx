// src/features/settings/components/AccountSettingsSection.tsx
// 账号 —— v2 设置整合：官方账号优先，豆包作为体验/备用通道同页管理（AI 接入模式切换由左下角身份菜单承担）。
import { SectionShell } from '../components/SectionShell';
import { DoubaoSection } from './DoubaoSection';
import { AccountSection } from './AccountSection';

export function AccountSettingsSection() {
  return (
    <SectionShell
      title="账号"
      description="优先使用 Musefold 官方账号登录与生图；官方未就绪时可用豆包体验通道（每日限量）应急。"
      className="settings-account-section"
    >
      <AccountSection />
      <DoubaoSection />
    </SectionShell>
  );
}
