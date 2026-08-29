import { create } from 'zustand';

/**
 * 跨屏一次性意图(如「设置 → 提示词库回收站」「存为提示词 → 跳库高亮」):
 * 发起方写入 intent 后由宿主切屏,目标屏 mount 时 consume 并落到对应子视图。
 * 与 useActiveSession 同机制:features 内共享 zustand,双宿主自动获得。
 */
export type ScreenIntent =
  | { kind: 'prompts-trash' }
  | { kind: 'history-trash' }
  | { kind: 'prompt-highlight'; promptId: string }
  /** 侧栏账号区深链(01 §2 左下角账号/中转站/豆包):落设置对应卡并滚动高亮。 */
  | { kind: 'settings-account' }
  | { kind: 'settings-connections' };

interface ScreenIntentState {
  intent: ScreenIntent | null;
  setIntent(intent: ScreenIntent): void;
  /** 匹配则清空并返回该意图;不匹配不动(留给目标屏)。 */
  consume<K extends ScreenIntent['kind']>(kind: K): Extract<ScreenIntent, { kind: K }> | null;
}

export const useScreenIntent = create<ScreenIntentState>((set, get) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  consume: <K extends ScreenIntent['kind']>(kind: K) => {
    const current = get().intent;
    if (current?.kind !== kind) return null;
    set({ intent: null });
    return current as Extract<ScreenIntent, { kind: K }>;
  },
}));
