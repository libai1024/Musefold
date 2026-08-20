// packages/desktop-contracts/src/ipc/misc.ts
// pet / diagnostics 域 + skillRuntime / designScheme 既有 Api 面的再导出（V13-GOV-04 自 ipc.ts 分域拆出）。

import type { PetFrame, PetInteraction, PetComposerAnchor } from "../pet";
import type { DiagnosticReport } from "../diagnostics";
import type { SkillRuntimeApi } from "../skill-runtime";
import type { DesignSchemeApi } from "../design-scheme";

export type { SkillRuntimeApi, DesignSchemeApi };

export interface DiagnosticsApi {
  /** 订阅 preload、主进程和渲染崩溃产生的异常报告。 */
  onError: (cb: (report: DiagnosticReport) => void) => () => void;
}

export interface PetApi {
  /** 开关桌宠，返回开关后的实际状态 */
  setEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
  isEnabled: () => Promise<{ enabled: boolean }>;
  /** 宠物窗口挂载后先拉一帧，避免等到下次状态变化才有画面 */
  getFrame: () => Promise<PetFrame | null>;
  /** 首帧资源解码并提交到 DOM 后通知主进程显示透明窗口。 */
  ready: () => void;
  /** 订阅动画帧推送，返回取消订阅函数 */
  onFrame: (cb: (frame: PetFrame) => void) => () => void;
  /** 上报交互（戳、拖拽、唤醒） */
  interact: (interaction: PetInteraction) => void;
  /** 拖拽时按增量移动宠物窗口；主进程负责屏幕边界钳制 */
  moveBy: (dx: number, dy: number) => void;
  /** 跑到主界面 Composer 右侧；锚点使用主窗口内容区坐标。 */
  runToComposer: (anchor: PetComposerAnchor) => Promise<void>;
  /** 从主界面返回进入前记录的桌面位置。 */
  returnHome: () => Promise<void>;
  /** 右键弹出原生上下文菜单（打开主界面 / 隐藏桌宠 / 退出应用） */
  openMenu: () => void;
}
