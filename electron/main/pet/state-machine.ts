// electron/main/pet/state-machine.ts
// 桌宠动画状态机 —— theme.json 驱动的 A/B/C 三类状态调度。
//
// 这里只决定"播哪个动画"，不持有任何业务状态。生成任务的权威状态在
// packages/core 的 generation service，本机只消费它推来的活动快照。
//
// 优先级（高→低）：Error > Notification > CBridge(锁) > Reaction > Working > IdleEgg > Idle
// 睡眠链强制走桥：idle --(180s)--> collapse-sleep (C) --> sleeping (A)
//                 --(任意活动)--> wake (C) --> idle

import type { PetStateDef, PetTheme } from '@shared/types/pet';

export enum StatePriority {
  Idle = 0,
  IdleEgg = 10,
  Working = 20,
  /** C 过渡桥的锁标记，只有 Error 能抢 */
  CBridge = 30,
  /** 用户主动交互，短暂高优先级 */
  Reaction = 35,
  Notification = 40,
  Error = 50,
}

/** 按状态名推断优先级。未知状态一律按工作态处理。 */
function priorityOf(name: string, spec: PetStateDef): StatePriority {
  if (name === 'error') return StatePriority.Error;
  if (name === 'notification') return StatePriority.Notification;
  if (name.startsWith('react-')) return StatePriority.Reaction;
  if (spec.type === 'C') return StatePriority.CBridge;
  if (name === 'idle') return StatePriority.Idle;
  if (name.startsWith('idle-')) return StatePriority.IdleEgg;
  return StatePriority.Working;
}

export interface StateMachineOptions {
  theme: PetTheme;
  /** 状态变化回调，用于推帧给宠物窗口 */
  onChange: (state: string, spec: PetStateDef) => void;
  /**
   * 是否允许进入睡眠链。默认恒真；实际接入时传"没有生图任务在跑"，
   * 免得用户正等着出图，宠物先睡着了。
   */
  canSleep?: () => boolean;
}

/** 连续发呆多久后进睡眠链 */
const IDLE_SLEEP_MS = 180_000;
/** 睡眠条件的轮询间隔 */
const SLEEP_POLL_MS = 15_000;
/** error 是 A 类会永久停留，超过这个时间自动回 idle，避免卡死在错误表情上 */
const ERROR_RECOVER_MS = 6_000;
const IDLE_EGG_MIN_MS = 20_000;
const IDLE_EGG_JITTER_MS = 20_000;

export class PetStateMachine {
  private readonly theme: PetTheme;
  private readonly onChange: StateMachineOptions['onChange'];
  private readonly canSleep: () => boolean;

  private current = 'idle';
  /** A 类基态。B/C 播完回到这里 */
  private base = 'idle';
  /** C 过渡播放中，除 Error 外一律拒绝抢占 */
  private locked = false;
  private currentPriority: StatePriority = StatePriority.Idle;
  /** B 的 returnTo / C 的 to / error 回收，同一时刻只会有一个 */
  private timer: NodeJS.Timeout | null = null;
  private idleEggTimer: NodeJS.Timeout | null = null;
  private sleepPoll: NodeJS.Timeout | null = null;
  /**
   * 连续发呆的起点。
   *
   * 只在真正有事发生时刷新（工作态、用户交互、被唤醒），彩蛋插播不算。
   * 早先把睡眠和状态切换共用一个计时器，结果每 20-40s 一次的彩蛋会不断
   * 把睡眠计时清零，宠物永远睡不着。
   */
  private idleSince = Date.now();
  private disposed = false;

  constructor(options: StateMachineOptions) {
    this.theme = options.theme;
    this.onChange = options.onChange;
    this.canSleep = options.canSleep ?? ((): boolean => true);
    this.sleepPoll = setInterval(() => this.checkSleep(), SLEEP_POLL_MS);
    this.armIdleEggs();
  }

  getState(): string {
    return this.current;
  }

  getSpec(): PetStateDef | null {
    return this.theme.states[this.current] ?? null;
  }

  /**
   * 外部状态切换入口，要过 C 锁和优先级两道闸。被拒时返回 false。
   *
   * `force=true` 跳过两道闸，仅用于**权威的生命周期转换**（新一轮生成开始、
   * 任务结束回 idle）。这些反映真实业务状态，必须落地。优先级闸的本意是挡
   * 自发的低优先级事件（彩蛋插播），不该挡它们 —— 否则宠物会被 error(50)
   * 或 working(20) 这类高优先级 A 态永久拒绝，卡死在旧表情上。
   */
  setState(name: string, force = false): boolean {
    if (this.disposed) return false;
    const spec = this.theme.states[name];
    if (!spec) return false;
    if (name === this.current) return false;

    const priority = priorityOf(name, spec);
    if (!force) {
      if (this.locked && priority < StatePriority.Error) return false;
      if (priority < this.currentPriority) return false;
    }

    // 工作态和交互态说明"有事发生"，重置发呆起点；彩蛋不算
    if (priority >= StatePriority.Working) this.idleSince = Date.now();

    this.apply(name, spec, priority);
    return true;
  }

  /**
   * 内部切换：跳过两道闸直接落地。
   *
   * B 的 returnTo 必须走这条路 —— 回 idle 时 Idle(0) 低于当前 B 态优先级，
   * 走公开入口会被自己的闸拒掉，宠物就永远回不了 idle。
   */
  private transitionTo(name: string): void {
    if (this.disposed) return;
    const spec = this.theme.states[name];
    if (!spec || name === this.current) return;
    this.apply(name, spec, priorityOf(name, spec));
  }

  private apply(name: string, spec: PetStateDef, priority: StatePriority): void {
    this.clearTimer();

    this.current = name;
    this.currentPriority = priority;
    this.locked = spec.type === 'C';
    this.onChange(name, spec);

    if (spec.type === 'A') {
      this.base = name;
      if (name === 'idle') {
        this.armIdleEggs();
      } else if (name === 'error') {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.transitionTo('idle');
        }, spec.durMs ?? ERROR_RECOVER_MS);
      }
      // 其余 A 类（typing / sleeping / react-drag）停在原地，等外部切走
      return;
    }

    if (spec.type === 'B') {
      const returnTo = spec.returnTo ?? this.base;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.transitionTo(returnTo);
      }, spec.durMs ?? 6_000);
      return;
    }

    // C：锁住直到播完，再自动过桥
    const to = spec.to ?? 'idle';
    this.timer = setTimeout(() => {
      this.timer = null;
      this.locked = false;
      this.transitionTo(to);
    }, spec.durMs ?? 3_080);
  }

  /** 任何用户活动都能唤醒，睡眠链的任意阶段都适用。 */
  wakeFromSleep(): void {
    if (this.current === 'wake') return;
    const sleeping =
      this.current === 'sleeping' ||
      this.current === 'collapse-sleep' ||
      this.base === 'sleeping';
    if (!sleeping) return;
    // collapse-sleep 播放中带着 C 锁，但用户唤醒是睡眠链内部推进，不该被锁挡住
    this.locked = false;
    this.idleSince = Date.now();
    this.transitionTo('wake');
  }

  /** 用户在场的信号（移入、点击、拖拽），推迟睡眠但不改变当前动画。 */
  noteActivity(): void {
    this.idleSince = Date.now();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private checkSleep(): void {
    if (this.disposed) return;
    if (this.current !== 'idle') return;
    if (Date.now() - this.idleSince < IDLE_SLEEP_MS) return;
    if (!this.canSleep()) return;
    this.setState('collapse-sleep');
  }

  /** 待机时隔 20-40s 随机插一段彩蛋。彩蛋是 B 类，播完回 idle 时会重新 arm。 */
  private armIdleEggs(): void {
    if (this.idleEggTimer) clearTimeout(this.idleEggTimer);
    this.idleEggTimer = null;
    if (this.theme.idleEggs.length === 0) return;

    const delay = IDLE_EGG_MIN_MS + Math.random() * IDLE_EGG_JITTER_MS;
    this.idleEggTimer = setTimeout(() => {
      this.idleEggTimer = null;
      // 有任务时保持 idle 基态；待机彩蛋不应掩盖忙碌状态或让测试/宿主误判为空闲。
      if (this.current !== 'idle' || !this.canSleep()) {
        if (this.current === 'idle') this.armIdleEggs();
        return;
      }
      const eggs = this.theme.idleEggs;
      this.setState(eggs[Math.floor(Math.random() * eggs.length)]);
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.idleEggTimer) clearTimeout(this.idleEggTimer);
    this.idleEggTimer = null;
    if (this.sleepPoll) clearInterval(this.sleepPoll);
    this.sleepPoll = null;
  }
}
