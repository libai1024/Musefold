// shared/types/pet.ts
// 桌宠（悬浮伴侣）的主题与状态契约。
//
// 桌宠是**纯表现层**：它自己不产生任何业务状态，只订阅生图活动快照后决定播哪个动画。
// 生成的权威状态机仍然只有 Workbench 一套（docs/v0.2/DEVELOPMENT-RULES.md §4），
// 这里的"状态机"指的是动画状态机，两者不可混淆。

/** 动画状态的三种时序语义。 */
export type PetStateType =
  /** 循环：进入即播、离开才换，用于长期停留的处境（待机、生成中、睡着）。 */
  | 'A'
  /** 回归：播一次，durMs 后自动回到 returnTo，用于一次性反馈（成功、被戳）。 */
  | 'B'
  /**
   * 过渡桥：锁住状态，播完自动跳到 to。除 error 外任何状态都抢不走，
   * 用于必须完整播完才有意义的衔接动作（趴下睡觉、醒来）。
   */
  | 'C';

/** 循环播放方式。渲染层据此决定 sprite 播完后怎么处理。 */
export type PetLoopMode =
  /** 来回播，正放完倒放，适合呼吸类无缝循环。 */
  | 'pingpong'
  /** 截取核心帧段连续重复，适合打字这类持续动作。 */
  | 'subloop'
  /** 播一次后定格在尾帧，C 类过渡桥专用。 */
  | 'once-freeze';

export interface PetStateDef {
  /** sprite 相对主题根目录的路径，例如 svg/idle.svg */
  file: string;
  /**
   * 多帧动作序列（含首帧的完整播放顺序）。静态图主题用它做关键帧轮播，
   * 让动作本身有变化（画画的落笔-抬笔-再落笔），而不只是整体呼吸。
   * 省略时退化为单帧。
   */
  files?: string[];
  /** 帧序列每帧停留时长（毫秒），默认 650 */
  frameMs?: number;
  type: PetStateType;
  loop: PetLoopMode;
  /** B 类必填：播完回到哪个状态，通常是 idle */
  returnTo?: string;
  /** C 类文档用：约束这座桥的入口状态，状态机不强制校验 */
  from?: string;
  /** C 类必填：播完自动切到哪个状态 */
  to?: string;
  /** B / C 类必填：播放时长（毫秒）。A 类无意义 */
  durMs?: number;
}

/** theme.json 的结构。分组只是给人看的，加载后会拍平成一张表。 */
export interface PetThemeManifest {
  name: string;
  displayName: string;
  version: string;
  author: string;
  description: string;
  schemaVersion: number;
  meta?: {
    canvas?: { w: number; h: number };
    format?: string;
    note?: string;
  };
  states: Record<string, PetStateDef>;
  transitions?: Record<string, PetStateDef>;
  reactions?: Record<string, PetStateDef>;
  mini?: Record<string, PetStateDef | string>;
  /** 待机时随机插播的彩蛋状态名 */
  idleEggs?: string[];
}

/** 加载并拍平后的主题，主进程和渲染层共用。 */
export interface PetTheme {
  name: string;
  displayName: string;
  /** 所有状态拍平到一张表，键是 canonical 状态名 */
  states: Record<string, PetStateDef>;
  idleEggs: string[];
  canvas: { w: number; h: number };
}

/**
 * 生图活动快照 —— 桌宠唯一的业务输入。
 *
 * 主进程在生成任务开始和结束时算出这份快照推给桌宠，桌宠据此挑动画。
 * 之所以推快照而不是推事件序列，是因为多张图并发时事件会交错，
 * 用快照能保证桌宠状态和真实并发数始终一致，不会因为丢事件而卡住。
 */
export interface PetActivitySnapshot {
  /** 当前正在跑的生图任务数。0 表示空闲 */
  runningJobs: number;
  /** 最近一次结束的任务结果，用于触发一次性的成功/失败反馈 */
  lastOutcome?: 'success' | 'failed' | 'cancelled';
  /** 伴随 lastOutcome 的一句话，显示在气泡里 */
  message?: string;
}

/** 渲染层发给主进程的交互事件。 */
export type PetInteraction =
  /** 左键按下，用于阻止系统把单击误判为打开主界面 */
  | 'pointer-down'
  /** 双击本体时明确打开主界面 */
  | 'open-main'
  /** 触发表情反应 */
  | 'poke'
  /** 开始拖拽 */
  | 'drag-start'
  /** 结束拖拽 */
  | 'drag-end'
  /** 鼠标移入或点击，用于从睡眠中唤醒 */
  | 'wake';

/** Composer 在主窗口内容区内的锚点；主进程负责换算成屏幕坐标。 */
export interface PetComposerAnchor {
  /** Composer 右边缘相对内容区左侧的距离。 */
  right: number;
  /** Composer 下边缘相对内容区顶部的距离。 */
  bottom: number;
}

/** 主进程推给宠物窗口的一帧渲染指令。 */
export interface PetFrame {
  /** canonical 状态名 */
  state: string;
  /** sprite 的可加载 URL 序列（主进程已解析成 media:// 并附版本参数）。单帧状态长度为 1 */
  srcs: string[];
  /** srcs 长度大于 1 时的每帧停留时长（毫秒） */
  frameMs: number;
  loop: PetLoopMode;
  /** 气泡文字；无则不显示 */
  message?: string;
}
