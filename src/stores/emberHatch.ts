// 引首落印的瞬态编排 store（v0.3.3 朱点规范 §7）。
// 引导 finish() 捕获 logo 圆点坐标 → 覆盖层执行运笔飞行 → 朱点本体接管落印与小字。
import { create } from 'zustand';
import { useAppStore } from './app';

export interface HatchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HatchPhase = 'idle' | 'flying' | 'landing';

interface EmberHatchState {
  phase: HatchPhase;
  from: HatchRect | null;
  /** 引导完成时调用：记录起点，进入飞行段 */
  requestHatch: (from: HatchRect) => void;
  /** 覆盖层抵达落点：本体开始落印（按压 + 墨晕 + 小字） */
  land: () => void;
  /** 小字散去后归位 */
  reset: () => void;
}

export const useEmberHatchStore = create<EmberHatchState>((set) => ({
  phase: 'idle',
  from: null,
  requestHatch: (from) => set({ phase: 'flying', from }),
  land: () => set({ phase: 'landing', from: null }),
  reset: () => set({ phase: 'idle', from: null }),
}));

/** 与 MusefoldLogoAnimated 相同口径的减少动效判定：显式开 = 否；跟随系统时读系统偏好。 */
export function hatchMotionAllowed(): boolean {
  const pref = useAppStore.getState().reducedMotion;
  if (pref === 'on') return false;
  if (pref === 'off') return true;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}
