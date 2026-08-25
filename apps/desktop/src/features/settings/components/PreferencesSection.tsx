// src/features/settings/components/PreferencesSection.tsx
// 偏好 —— v2 设置整合：生成默认值 + 外观合并为一页。
import { SectionShell } from '../components/SectionShell';
import { GenerationSection } from './GenerationSection';
import { AppearanceSection } from './AppearanceSection';

export function PreferencesSection() {
  return (
    <SectionShell title="偏好" description="新设计的默认生成参数与界面外观。">
      <GenerationSection />
      <AppearanceSection />
    </SectionShell>
  );
}
