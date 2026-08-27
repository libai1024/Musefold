import { describe, expect, it } from 'vitest';
import { resolveConnectionDot } from '../components/connection-status';

describe('resolveConnectionDot（中转站列表行状态点）', () => {
  it('缺少密钥优先于任何测试结果，映射 warning', () => {
    expect(resolveConnectionDot({ hasKey: false, testState: 'ok' })).toEqual({
      tone: 'warning',
      label: '缺少密钥',
    });
    expect(resolveConnectionDot({ hasKey: false }).tone).toBe('warning');
  });

  it('测试通过/失败映射 success/danger（生图 ok 与 Agent success 同语义）', () => {
    expect(resolveConnectionDot({ hasKey: true, testState: 'ok' }).tone).toBe('success');
    expect(resolveConnectionDot({ hasKey: true, testState: 'success' }).tone).toBe('success');
    expect(resolveConnectionDot({ hasKey: true, testState: 'failed' })).toEqual({
      tone: 'danger',
      label: '测试失败',
    });
  });

  it('跳过测试（无密钥）映射 warning', () => {
    expect(resolveConnectionDot({ hasKey: true, testState: 'skipped' }).tone).toBe('warning');
  });

  it('doubao-web 等无密钥概念的类型只看测试状态', () => {
    expect(resolveConnectionDot({ hasKey: false, keyAgnostic: true }).tone).toBe('muted');
    expect(resolveConnectionDot({ hasKey: false, keyAgnostic: true, testState: 'ok' }).tone).toBe(
      'success',
    );
    expect(
      resolveConnectionDot({ hasKey: false, keyAgnostic: true, testState: 'failed' }).tone,
    ).toBe('danger');
  });

  it('未测试 / idle 为灰色 muted;测试中是独立 testing tone(warning 色 + 呼吸动画)', () => {
    expect(resolveConnectionDot({ hasKey: true }).tone).toBe('muted');
    expect(resolveConnectionDot({ hasKey: true, testState: 'idle' }).tone).toBe('muted');
    expect(resolveConnectionDot({ hasKey: true, testState: 'testing' })).toEqual({
      tone: 'testing',
      label: '正在测试连接',
    });
  });
});
