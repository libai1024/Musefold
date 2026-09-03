import { describe, expect, it } from 'vitest';
import { toCanonicalTraceItem } from '../design-scheme-agent-adapter';

// 旧会话轨迹 → canonical compilationTraceItem 的降级规则:
// detail/output 过长或含本地路径时逐级丢弃,标题截断;只有身份都不合法才丢条目。

describe('toCanonicalTraceItem', () => {
  it('合法条目原样映射,durationMs 取整且非负', () => {
    expect(
      toCanonicalTraceItem({
        id: 'compiler',
        kind: 'tool',
        title: 'Scheme Compiler 编译方案',
        detail: '模型 gpt-5.4-mini',
        status: 'success',
        durationMs: 1234.7,
      }),
    ).toEqual({
      id: 'compiler',
      kind: 'tool',
      title: 'Scheme Compiler 编译方案',
      detail: '模型 gpt-5.4-mini',
      status: 'success',
      durationMs: 1235,
    });
  });

  it('detail 含本地路径 → 丢 detail 保留条目;output 仍保留', () => {
    const item = toCanonicalTraceItem({
      id: 'history-snapshot',
      kind: 'tool',
      title: '固化历史来源',
      detail: '/Users/alice/Library/Application Support/musefold/snap.png',
      output: '共 1 张图片',
      status: 'success',
    });
    expect(item).toEqual({
      id: 'history-snapshot',
      kind: 'tool',
      title: '固化历史来源',
      output: '共 1 张图片',
      status: 'success',
    });
  });

  it('超长 detail/output/title 截断到契约上限而不是丢弃', () => {
    const item = toCanonicalTraceItem({
      id: 'creation-summary',
      kind: 'assistant',
      title: 'A'.repeat(300),
      detail: 'd'.repeat(2_000),
      output: 'o'.repeat(10_000),
      status: 'success',
    });
    expect(item?.title).toHaveLength(120);
    expect(item?.detail).toHaveLength(600);
    expect(item?.output).toHaveLength(4_000);
  });

  it('id 不是合法 opaque id → 整条丢弃(不伪造身份)', () => {
    expect(
      toCanonicalTraceItem({
        id: '/etc/passwd',
        kind: 'system',
        title: '创建失败',
        status: 'error',
      }),
    ).toBeNull();
  });
});
