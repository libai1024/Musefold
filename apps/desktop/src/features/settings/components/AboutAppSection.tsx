// src/features/settings/components/AboutAppSection.tsx
// 关于 App —— 版本、更新通道、支持资源与快捷键（自「数据与关于」拆分）。
import { SectionShell } from '../components/SectionShell';
import { AboutSection } from './AboutSection';

export function AboutAppSection() {
  return (
    <SectionShell title="关于 App" description="查看当前版本、检查更新，或获取文档与支持资源。">
      <AboutSection />
    </SectionShell>
  );
}
