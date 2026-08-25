// src/features/settings/components/AppearanceSection.tsx
// 外观 —— 主题来源（跟随系统 / 浅色 / 深色）
import { Monitor, Sun, Moon } from '../../../components/ui/icons';
import {
  useAppStore,
  type InterfaceDensity,
  type ReducedMotion,
  type ThemeSource,
} from '../../../stores/app';
import { SettingRow, SettingsCard } from '../components/SectionShell';
import { ChoiceChips } from '../components/ChoiceChips';

const OPTIONS = [
  { value: 'system' as ThemeSource, label: '跟随系统', icon: Monitor },
  { value: 'light' as ThemeSource, label: '浅色', icon: Sun },
  { value: 'dark' as ThemeSource, label: '深色', icon: Moon },
];

const MOTION_OPTIONS = [
  { value: 'system' as ReducedMotion, label: '系统' },
  { value: 'on' as ReducedMotion, label: '减少' },
  { value: 'off' as ReducedMotion, label: '完整' },
];

const DENSITY_OPTIONS = [
  { value: 'comfortable' as InterfaceDensity, label: '舒适' },
  { value: 'compact' as InterfaceDensity, label: '紧凑' },
];

export function AppearanceSection() {
  const themeSource = useAppStore((s) => s.themeSource);
  const setThemeSource = useAppStore((s) => s.setThemeSource);
  const theme = useAppStore((s) => s.theme);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const setReducedMotion = useAppStore((s) => s.setReducedMotion);
  const density = useAppStore((s) => s.density);
  const setDensity = useAppStore((s) => s.setDensity);

  return (
    <>
      <SettingsCard title="界面设置" description="设置应用主题、界面密度和动效表现">
        <SettingRow
          data-testid="appearance-theme-row"
          label="主题"
          hint={
            themeSource === 'system'
              ? `跟随系统，当前为${theme === 'dark' ? '深色' : '浅色'}`
              : '手动指定明暗'
          }
        >
          <ChoiceChips
            aria-label="主题来源"
            value={themeSource}
            onChange={setThemeSource}
            options={OPTIONS}
          />
        </SettingRow>
        <SettingRow
          label="减少动效"
          hint={
            reducedMotion === 'system'
              ? '跟随系统辅助功能设置'
              : reducedMotion === 'on'
                ? '关闭过渡、入场和循环动画'
                : '始终保留完整界面动效'
          }
          data-testid="appearance-motion-row"
        >
          <ChoiceChips
            aria-label="减少动效"
            value={reducedMotion}
            onChange={setReducedMotion}
            options={MOTION_OPTIONS}
          />
        </SettingRow>
        <SettingRow
          label="界面密度"
          hint={density === 'compact' ? '缩短主要列表与卡片间距' : '保留更宽松的浏览间距'}
          data-testid="appearance-density-row"
        >
          <ChoiceChips
            aria-label="界面密度"
            value={density}
            onChange={setDensity}
            options={DENSITY_OPTIONS}
          />
        </SettingRow>
      </SettingsCard>
    </>
  );
}
