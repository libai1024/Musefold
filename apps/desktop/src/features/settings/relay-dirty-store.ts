// src/features/settings/relay-dirty-store.ts
// relay 面板 dirty 状态的跨层通道:detail panel → section(左栏切换拦截)→ RelaySection(tab 切换拦截)。
// 瞬时 UI 状态,不持久化;section 卸载(含 tab 切换成功)时由清理 effect 自动复位。

import { create } from 'zustand';

interface RelayDirtyState {
  /** 当前 relay 面板是否有未保存修改(含 API Key 局部输入) */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export const useRelayDirtyStore = create<RelayDirtyState>((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
}));
