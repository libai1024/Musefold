// src/features/settings/components/DataStorageSection.tsx
// 数据存储 —— 本机数据的导入导出、备份与重置（自「数据与关于」拆分）。
import { SectionShell } from '../components/SectionShell';
import { DataSection } from './DataSection';

export function DataStorageSection() {
  return (
    <SectionShell title="数据存储" description="本机数据的导入导出、备份、日志与重置。">
      <DataSection />
    </SectionShell>
  );
}
