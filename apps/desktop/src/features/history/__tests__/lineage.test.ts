// src/features/history/__tests__/lineage.test.ts
// 微调链组装：线程分组 / 排序 / 深度 / 序号 / 孤儿与环防御

import { describe, expect, it } from 'vitest';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import { flattenHistoryThreads, historyThreadOf } from '../lineage';

let seq = 0;
function rec(id: string, createdAt: number, parentHistoryId?: string): HistoryRecord {
  seq += 1;
  return {
    id,
    promptId: null,
    providerId: 'p1',
    model: 'gpt-image-2',
    promptText: `prompt ${id} #${seq}`,
    negativeText: null,
    params: null,
    status: 'success',
    errorCode: null,
    errorMessage: null,
    imagePath: null,
    cost: null,
    costUnit: 'point',
    durationMs: null,
    createdAt,
    parentHistoryId,
  };
}

/** 模拟 history.list：createdAt 倒序 */
function listed(...records: HistoryRecord[]): HistoryRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

describe('flattenHistoryThreads', () => {
  it('没有微调时保持原始倒序，全部为根', () => {
    const items = flattenHistoryThreads(listed(rec('a', 100), rec('b', 200), rec('c', 300)));
    expect(items.map((i) => i.record.id)).toEqual(['c', 'b', 'a']);
    expect(items.every((i) => i.depth === 0 && i.refinementIndex === 0 && !i.orphan)).toBe(true);
    expect(items.every((i) => i.threadSize === 1)).toBe(true);
  });

  it('微调紧跟根之后按时间正序展开，深度与序号递增', () => {
    const root = rec('root', 100);
    const r1 = rec('r1', 200, 'root');
    const r2 = rec('r2', 300, 'r1');
    const other = rec('other', 250);
    const items = flattenHistoryThreads(listed(root, r1, r2, other));

    // r2(300) 是全局最新 → root 线程整体排在 other(250) 之前
    expect(items.map((i) => i.record.id)).toEqual(['root', 'r1', 'r2', 'other']);
    expect(items.map((i) => i.depth)).toEqual([0, 1, 2, 0]);
    expect(items.map((i) => i.refinementIndex)).toEqual([0, 1, 2, 0]);
    expect(items[0].threadSize).toBe(3);
    expect(items[0].childCount).toBe(1);
    expect(items[0].threadRootId).toBe('root');
    expect(items[2].threadRootId).toBe('root');
  });

  it('线程按最新活动排序：老根 + 新微调的线程排到前面', () => {
    const oldRoot = rec('old-root', 100);
    const newRefine = rec('new-refine', 900, 'old-root');
    const midRoot = rec('mid-root', 500);
    const items = flattenHistoryThreads(listed(oldRoot, newRefine, midRoot));
    expect(items.map((i) => i.record.id)).toEqual(['old-root', 'new-refine', 'mid-root']);
  });

  it('同一父级的多个微调（分叉）按时间正序，序号连续', () => {
    const root = rec('root', 100);
    const a = rec('a', 300, 'root');
    const b = rec('b', 200, 'root');
    const items = flattenHistoryThreads(listed(root, a, b));
    expect(items.map((i) => i.record.id)).toEqual(['root', 'b', 'a']);
    expect(items.map((i) => i.refinementIndex)).toEqual([0, 1, 2]);
    expect(items[0].childCount).toBe(2);
  });

  it('父记录不在结果集里的微调降级为孤儿根', () => {
    const orphan = rec('orphan', 200, 'deleted-parent');
    const items = flattenHistoryThreads(listed(orphan, rec('x', 100)));
    expect(items[0].record.id).toBe('orphan');
    expect(items[0].depth).toBe(0);
    expect(items[0].orphan).toBe(true);
    expect(items[1].orphan).toBe(false);
  });

  it('环引用不会死循环，记录只输出一次', () => {
    const a = rec('a', 100, 'b');
    const b = rec('b', 200, 'a');
    const items = flattenHistoryThreads(listed(a, b));
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.record.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('自引用被忽略', () => {
    const items = flattenHistoryThreads(listed(rec('self', 100, 'self')));
    expect(items).toHaveLength(1);
    expect(items[0].depth).toBe(0);
  });
});

describe('historyThreadOf', () => {
  it('从任意成员取整条线程', () => {
    const root = rec('root', 100);
    const r1 = rec('r1', 200, 'root');
    const r2 = rec('r2', 300, 'r1');
    const noise = rec('noise', 400);
    const records = listed(root, r1, r2, noise);

    for (const id of ['root', 'r1', 'r2']) {
      const thread = historyThreadOf(records, id);
      expect(thread.map((i) => i.record.id)).toEqual(['root', 'r1', 'r2']);
    }
    expect(historyThreadOf(records, 'noise').map((i) => i.record.id)).toEqual(['noise']);
  });

  it('记录不存在时返回空数组', () => {
    expect(historyThreadOf([rec('a', 1)], 'missing')).toEqual([]);
  });
});
