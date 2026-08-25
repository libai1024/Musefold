// src/features/settings/components/DataAndAboutSection.tsx
// 数据与关于 —— v2 设置整合：数据与存储 + 关于合并为一页。
import { SectionShell } from '../components/SectionShell';
import { DataSection } from './DataSection';
import { AboutSection } from './AboutSection';

export function DataAndAboutSection() {
  return (
    <SectionShell title="数据与关于" description="本机数据的导入导出与备份、版本更新和支持资源。">
      <DataSection />
      <AboutSection />
    </SectionShell>
  );
}
