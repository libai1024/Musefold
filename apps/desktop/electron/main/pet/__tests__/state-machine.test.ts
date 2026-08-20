import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PetStateMachine } from '../state-machine';
import type { PetTheme } from '@shared/types/pet';

const theme: PetTheme = {
  name: 'test',
  displayName: 'test',
  canvas: { w: 300, h: 300 },
  idleEggs: ['idle-look'],
  states: {
    idle: { file: 'svg/idle.svg', type: 'A', loop: 'pingpong' },
    typing: { file: 'svg/typing.svg', type: 'A', loop: 'subloop' },
    juggling: { file: 'svg/juggling.svg', type: 'A', loop: 'subloop' },
    sleeping: { file: 'svg/sleeping.svg', type: 'A', loop: 'pingpong' },
    error: { file: 'svg/error.svg', type: 'A', loop: 'pingpong' },
    'idle-look': {
      file: 'svg/idle-look.svg',
      type: 'B',
      loop: 'pingpong',
      returnTo: 'idle',
      durMs: 6000,
    },
    happy: {
      file: 'svg/happy.svg',
      type: 'B',
      loop: 'pingpong',
      returnTo: 'idle',
      durMs: 2400,
    },
    'react-poke': {
      file: 'svg/react-poke.svg',
      type: 'B',
      loop: 'pingpong',
      returnTo: 'idle',
      durMs: 1500,
    },
    'collapse-sleep': {
      file: 'svg/collapse-sleep.svg',
      type: 'C',
      loop: 'once-freeze',
      to: 'sleeping',
      durMs: 3080,
    },
    wake: {
      file: 'svg/wake.svg',
      type: 'C',
      loop: 'once-freeze',
      to: 'idle',
      durMs: 3080,
    },
  },
};

function makeMachine(canSleep = (): boolean => true): {
  machine: PetStateMachine;
  changes: string[];
} {
  const changes: string[] = [];
  const machine = new PetStateMachine({
    theme,
    onChange: (state) => changes.push(state),
    canSleep,
  });
  return { machine, changes };
}

describe('PetStateMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('B 类播完自动回到 returnTo', () => {
    const { machine } = makeMachine();
    machine.setState('happy');
    expect(machine.getState()).toBe('happy');

    vi.advanceTimersByTime(2400);
    expect(machine.getState()).toBe('idle');
    machine.dispose();
  });

  it('C 过渡桥期间拒绝抢占，播完自动过桥', () => {
    const { machine } = makeMachine();
    machine.setState('collapse-sleep');

    // 锁期内普通状态抢不走
    expect(machine.setState('typing')).toBe(false);
    expect(machine.getState()).toBe('collapse-sleep');

    vi.advanceTimersByTime(3080);
    expect(machine.getState()).toBe('sleeping');
    machine.dispose();
  });

  it('error 能打断 C 锁', () => {
    const { machine } = makeMachine();
    machine.setState('collapse-sleep');
    expect(machine.setState('error')).toBe(true);
    expect(machine.getState()).toBe('error');
    machine.dispose();
  });

  it('error 不会永久卡住，超时自动回 idle', () => {
    const { machine } = makeMachine();
    machine.setState('error');
    expect(machine.getState()).toBe('error');

    vi.advanceTimersByTime(6000);
    expect(machine.getState()).toBe('idle');
    machine.dispose();
  });

  it('低优先级抢不走高优先级，但 force 可以', () => {
    const { machine } = makeMachine();
    machine.setState('error');

    expect(machine.setState('typing')).toBe(false);
    expect(machine.getState()).toBe('error');

    // 生成开始这类权威转换必须落地，否则宠物会卡在错误表情上
    expect(machine.setState('typing', true)).toBe(true);
    expect(machine.getState()).toBe('typing');
    machine.dispose();
  });

  it('彩蛋插播不会阻止睡眠', () => {
    const { machine } = makeMachine();

    // 三分钟里彩蛋会反复插播并回到 idle；早先的实现用同一个计时器，
    // 每次插播都会把睡眠倒计时清零，宠物永远睡不着
    vi.advanceTimersByTime(200_000);

    expect(['collapse-sleep', 'sleeping']).toContain(machine.getState());
    machine.dispose();
  });

  it('有任务在跑时不睡', () => {
    const { machine } = makeMachine(() => false);
    vi.advanceTimersByTime(300_000);
    expect(machine.getState()).toBe('idle');
    machine.dispose();
  });

  it('睡着后能被唤醒并走 wake 桥回 idle', () => {
    const { machine } = makeMachine();
    machine.setState('collapse-sleep');
    vi.advanceTimersByTime(3080);
    expect(machine.getState()).toBe('sleeping');

    machine.wakeFromSleep();
    expect(machine.getState()).toBe('wake');

    vi.advanceTimersByTime(3080);
    expect(machine.getState()).toBe('idle');
    machine.dispose();
  });

  it('collapse-sleep 播放中途也能被唤醒', () => {
    const { machine } = makeMachine();
    machine.setState('collapse-sleep');
    vi.advanceTimersByTime(1000);

    machine.wakeFromSleep();
    expect(machine.getState()).toBe('wake');
    machine.dispose();
  });

  it('dispose 之后不再切换状态', () => {
    const { machine, changes } = makeMachine();
    machine.dispose();
    const before = changes.length;

    expect(machine.setState('typing')).toBe(false);
    vi.advanceTimersByTime(300_000);
    expect(changes.length).toBe(before);
  });
});
