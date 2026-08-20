// src/features/history/lineage.ts
// 微调链（refinement lineage）—— 把扁平的历史记录按 parentHistoryId 组装成线程。
//
// 规则：
// - 线程 = 一条原始生成 + 它派生出的所有微调（可分叉成树）。
// - 列表顺序：线程按「线程内最新一条记录」倒序（活跃线程沉浮到顶部）；
//   线程内部根在前，微调按时间正序展开（还原迭代过程）。
// - 父记录已被删除（或不在当前筛选结果里）的微调，降级为独立根，仅保留「微调」标记。
// - 防御环引用：任何记录只输出一次。

import type { HistoryRecord } from '@shared/types/models';

export interface HistoryThreadItem {
  record: HistoryRecord;
  /** 距线程根的层级，根为 0 */
  depth: number;
  /** 所属线程根 id（孤儿微调 = 自己） */
  threadRootId: string;
  /** 线程内微调的时间序号（根为 0，微调从 1 开始） */
  refinementIndex: number;
  /** 该记录本身派生出的微调数（直接子级） */
  childCount: number;
  /** 线程内记录总数（根 + 所有微调），仅根行需要展示 */
  threadSize: number;
  /** 有 parentHistoryId 但父记录不在结果集里 */
  orphan: boolean;
}

interface ThreadIndex {
  byId: Map<string, HistoryRecord>;
  childrenByParent: Map<string, HistoryRecord[]>;
  /** 解析后的有效父 id（父存在且不会成环） */
  parentOf: Map<string, string>;
}

function buildIndex(records: HistoryRecord[]): ThreadIndex {
  const byId = new Map<string, HistoryRecord>();
  for (const r of records) byId.set(r.id, r);

  const parentOf = new Map<string, string>();
  for (const r of records) {
    const pid = r.parentHistoryId;
    if (!pid || pid === r.id || !byId.has(pid)) continue;
    parentOf.set(r.id, pid);
  }

  // 断开环：沿父链走，遇到重复节点则把当前边移除
  for (const id of Array.from(parentOf.keys())) {
    const seen = new Set<string>([id]);
    let cur = id;
    while (parentOf.has(cur)) {
      const next = parentOf.get(cur)!;
      if (seen.has(next)) {
        parentOf.delete(cur);
        break;
      }
      seen.add(next);
      cur = next;
    }
  }

  const childrenByParent = new Map<string, HistoryRecord[]>();
  for (const [childId, pid] of parentOf) {
    const child = byId.get(childId)!;
    const list = childrenByParent.get(pid);
    if (list) list.push(child);
    else childrenByParent.set(pid, [child]);
  }
  // 微调按时间正序（迭代顺序）
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  return { byId, childrenByParent, parentOf };
}

function rootIdOf(index: ThreadIndex, id: string): string {
  let cur = id;
  while (index.parentOf.has(cur)) cur = index.parentOf.get(cur)!;
  return cur;
}

/** 深度优先展开一条线程（根在前，微调按时间正序） */
function flattenThread(index: ThreadIndex, root: HistoryRecord): HistoryThreadItem[] {
  const items: HistoryThreadItem[] = [];
  let refinementCounter = 0;

  const visit = (record: HistoryRecord, depth: number) => {
    const children = index.childrenByParent.get(record.id) ?? [];
    items.push({
      record,
      depth,
      threadRootId: root.id,
      refinementIndex: depth === 0 ? 0 : ++refinementCounter,
      childCount: children.length,
      threadSize: 0, // 结尾统一回填
      orphan: depth === 0 && Boolean(record.parentHistoryId),
    });
    for (const child of children) visit(child, depth + 1);
  };
  visit(root, 0);

  for (const item of items) item.threadSize = items.length;
  return items;
}

/**
 * 把 history.list 的结果（时间倒序）展开成线程化列表。
 * 输出顺序：线程按最新活动倒序；线程内根在前、微调按时间正序。
 */
export function flattenHistoryThreads(records: HistoryRecord[]): HistoryThreadItem[] {
  const index = buildIndex(records);
  const emittedRoots = new Set<string>();
  const items: HistoryThreadItem[] = [];

  // records 已按 createdAt 倒序：首次遇到某线程的任意成员，即该线程的最新活动
  for (const record of records) {
    const rootId = rootIdOf(index, record.id);
    if (emittedRoots.has(rootId)) continue;
    emittedRoots.add(rootId);
    const root = index.byId.get(rootId)!;
    items.push(...flattenThread(index, root));
  }
  return items;
}

/**
 * 取包含指定记录的整条线程（检视面板的微调链）。
 * 记录不存在时返回空数组。
 */
export function historyThreadOf(records: HistoryRecord[], id: string): HistoryThreadItem[] {
  const index = buildIndex(records);
  if (!index.byId.has(id)) return [];
  const root = index.byId.get(rootIdOf(index, id))!;
  return flattenThread(index, root);
}
