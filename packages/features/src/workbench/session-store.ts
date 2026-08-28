'use client';

import { create } from 'zustand';

/**
 * 活动会话是跨壳/屏状态:壳侧栏「对话」区选中它,工作台屏读它渲染时间线。
 * 会话数据本身在 React Query 缓存;这里只存 UI 指针。
 */
interface ActiveSessionState {
  activeSessionId: string | null;
  setActiveSessionId(id: string | null): void;
}

export const useActiveSession = create<ActiveSessionState>((set) => ({
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
}));
