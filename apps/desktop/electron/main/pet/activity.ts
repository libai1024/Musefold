// electron/main/pet/activity.ts
// 生图活动 → 动画状态的映射。
//
// 单独成文件是为了能脱离 Electron 测：这里的计数一旦漂移，宠物就会永久卡在
// 忙碌态，而那种问题在真机上很难复现。

/** 状态机里这个模块用得到的部分 */
export interface ActivityHost {
  setState(name: string, force?: boolean): boolean;
}

/** 真正进入生图后统一播放画面内的环形散步，避免并发数改变角色路线。 */
export function stateForJobs(jobs: number): string {
  if (jobs <= 0) return 'idle';
  return 'creating';
}

export class PetActivityTracker {
  private running = 0;

  constructor(private host: () => ActivityHost | null) {}

  get runningJobs(): number {
    return this.running;
  }

  /** 提交后、真正开跑前的等待。已经在忙就不打断当前动画。 */
  pending(): void {
    if (this.running > 0) return;
    this.host()?.setState('thinking');
  }

  /** 任务开始。返回的函数在任务落地时调用，重复调用安全。 */
  start(): (outcome: 'success' | 'failed' | 'cancelled') => void {
    this.running += 1;
    this.host()?.setState(stateForJobs(this.running), true);

    let settled = false;
    return (outcome) => {
      // 同一个任务被收尾两次会让计数漂移，宠物就再也回不到 idle
      if (settled) return;
      settled = true;
      this.running = Math.max(0, this.running - 1);

      const host = this.host();
      if (!host) return;

      if (this.running > 0) {
        // 还有别的任务在跑：降档继续忙。这时候播结果动画会让批量生成
        // 变成一串闪烁的表情
        host.setState(stateForJobs(this.running), true);
        return;
      }

      if (outcome === 'success') host.setState('happy', true);
      else if (outcome === 'failed') host.setState('error', true);
      else host.setState('idle', true);
    };
  }

  /** 桌宠关闭时清账，免得下次打开继承一个虚高的计数。 */
  reset(): void {
    this.running = 0;
  }
}
