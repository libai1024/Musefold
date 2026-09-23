import { create } from 'zustand';
import type { SettingsSectionId } from '../settings/section-ids';

/**
 * 跨屏一次性意图(如「设置 → 提示词库回收站」「存为提示词 → 跳库高亮」):
 * 发起方写入 intent 后由宿主切屏,目标屏 mount 时 consume 并落到对应子视图。
 * 与 useActiveSession 同机制:features 内共享 zustand,双宿主自动获得。
 */
export type ScreenIntent =
  | { kind: 'prompts-trash' }
  | { kind: 'history-trash' }
  | { kind: 'prompt-highlight'; promptId: string }
  /** ⌘/Ctrl+K 全局唤起搜索:切到提示词库后由该屏 mount/意图变化时聚焦搜索框。 */
  | { kind: 'prompts-focus-search' }
  /** 「新设计」(钮/⌘N):切到工作台后聚焦 Composer 输入框,直接进入输入状态(承 ChatGPT ⌘N 语义)。 */
  | { kind: 'workbench-focus-composer' }
  /** 提示词详情「相关作品」缩略 → 跳历史屏并选中该回合(历史屏 mount 时消费)。 */
  | { kind: 'history-select'; jobId: string }
  /** 侧栏账号区深链(01 §2 左下角账号/中转站/豆包):落设置对应卡并滚动高亮。 */
  | { kind: 'settings-account' }
  | { kind: 'settings-connections' }
  /** 通用设置深链(07-00 P2):分区 + 可选高亮 testid。既有 account/connections 别名仍可用。 */
  | { kind: 'settings-section'; section: SettingsSectionId; highlight?: string }
  /** 设计方案详情深链(工作台「查看详情」):落方案中心整屏详情,宿主切屏后由视图 mount 消费。 */
  | { kind: 'scheme-detail'; schemeId: string };

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

/** 密钥/连接引导:落到设置连接分区后再切屏(宿主注入 onOpenSettings)。 */
export function openConnectionsSettings(onOpenSettings?: () => void): void {
  useScreenIntent.getState().setIntent({
    kind: 'settings-section',
    section: 'connections',
  });
  onOpenSettings?.();
}
