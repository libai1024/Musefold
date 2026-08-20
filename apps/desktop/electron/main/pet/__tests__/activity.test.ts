import { describe, expect, it } from 'vitest';
import { PetActivityTracker, stateForJobs } from '../activity';

function makeTracker(): { tracker: PetActivityTracker; states: string[] } {
  const states: string[] = [];
  const tracker = new PetActivityTracker(() => ({
    setState(name: string) {
      states.push(name);
      return true;
    },
  }));
  return { tracker, states };
}

describe('stateForJobs', () => {
  it('生图期间统一进入环形散步', () => {
    expect(stateForJobs(0)).toBe('idle');
    expect(stateForJobs(1)).toBe('creating');
    expect(stateForJobs(2)).toBe('creating');
    expect(stateForJobs(5)).toBe('creating');
  });
});

describe('PetActivityTracker', () => {
  it('单个任务：开始忙碌，成功后庆祝', () => {
    const { tracker, states } = makeTracker();
    const settle = tracker.start();
    expect(states).toEqual(['creating']);

    settle('success');
    expect(states).toEqual(['creating', 'happy']);
    expect(tracker.runningJobs).toBe(0);
  });

  it('失败走 error，取消直接回 idle', () => {
    const { tracker, states } = makeTracker();
    tracker.start()('failed');
    tracker.start()('cancelled');
    expect(states).toEqual(['creating', 'error', 'creating', 'idle']);
  });

  it('并发升档，且中途结束不播结果动画', () => {
    const { tracker, states } = makeTracker();
    const a = tracker.start();
    const b = tracker.start();
    const c = tracker.start();
    expect(states).toEqual(['creating', 'creating', 'creating']);

    // 前两个先落地：只降档，不播 happy，否则批量生成会闪一串表情
    a('success');
    b('success');
    expect(states.slice(3)).toEqual(['creating', 'creating']);

    c('success');
    expect(states.at(-1)).toBe('happy');
    expect(tracker.runningJobs).toBe(0);
  });

  it('重复收尾不会让计数漂移', () => {
    const { tracker } = makeTracker();
    const settle = tracker.start();
    settle('success');
    settle('success');
    settle('failed');
    expect(tracker.runningJobs).toBe(0);
  });

  it('已经在忙时 pending 不打断当前动画', () => {
    const { tracker, states } = makeTracker();
    tracker.pending();
    expect(states).toEqual(['thinking']);

    tracker.start();
    tracker.pending();
    expect(states).toEqual(['thinking', 'creating']);
  });

  it('reset 清空计数', () => {
    const { tracker } = makeTracker();
    tracker.start();
    tracker.start();
    tracker.reset();
    expect(tracker.runningJobs).toBe(0);
  });
});
