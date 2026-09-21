import { create } from 'zustand';
import type { SettingsSectionId } from './section-ids';

/**
 * 设置分区记忆(V25-UI-SPEC §6.1「分区记忆」):离开设置再回来,停在上次的分区。
 * 只存 UI 指针,内存态、重启清零;分区是否仍可用由 SettingsScreen 按 capability 兜底。
 */
interface SettingsNavState {
  activeSectionId: SettingsSectionId | null;
  setActiveSectionId(id: SettingsSectionId): void;
}

export const useSettingsNav = create<SettingsNavState>((set) => ({
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
