import type { GenerationJob, GenerationStatus } from '@musefold/contracts';

export const STATUS_LABELS: Record<GenerationStatus, string> = {
  pending_approval: '待批准',
  queued: '排队中',
  running: '生成中',
  succeeded: '成功',
  failed: '失败',
  cancelling: '取消中',
  cancelled: '已取消',
  rejected: '已拒绝',
  expired: '已过期',
};

/** Badge 语义 variant(禁止硬编码色值,V25-UI-SPEC §1.2)。 */
export function statusBadgeVariant(
  status: GenerationStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'succeeded':
      return 'secondary';
    case 'failed':
    case 'rejected':
      return 'destructive';
    case 'cancelled':
      return 'outline';
    default:
      return 'default';
  }
}

/** 终态集合:行操作组据此切「取消」/「重试」。 */
export function isActiveStatus(status: GenerationStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'cancelling' ||
    status === 'pending_approval'
  );
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
  });
  return `${day} ${time}`;
}

/** 检视「创建时间」用完整年月日时分,不做「今天只显示时刻」的相对省略。 */
export function formatFullDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 终态用时:宿主上报的 durationMs 优先(含上游耗时口径),
 * 缺省时退回 finishedAt - startedAt;都不可用返回 null,不伪造 0。
 */
export function jobDurationMs(job: GenerationJob): number | null {
  if (job.durationMs != null && job.durationMs >= 0) return job.durationMs;
  if (!job.startedAt || !job.finishedAt) return null;
  const elapsed = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

/** 承旧 lib/format.formatDuration:亚秒给毫秒,其余一位小数的秒(05-C2 tabular)。 */
export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  return ms < 1_000 ? `${Math.round(ms)}ms` : `${(ms / 1_000).toFixed(1)}s`;
}

export function formatDuration(job: GenerationJob): string | null {
  return formatDurationMs(jobDurationMs(job));
}

/** 成本文案:null 不伪造 0(ui-parity 05 §2),已知值走 tabular「x 积分」。 */
export function formatCostPoints(costPoints: number | null | undefined): string | null {
  return costPoints == null ? null : `${costPoints.toLocaleString('zh-CN')} 积分`;
}

/** 磁盘占用 readout(承旧 HistoryDiskUsage.formatBytes)。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0] as string;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index] as string;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

const MAX_THREAD_DEPTH = 4;

export interface ThreadedJob {
  job: GenerationJob;
  depth: number;
  /** 所属线程根 id(孤儿微调 = 自己)。 */
  threadRootId: string;
  /** 线程内微调的时间序号(根为 0,微调从 1 开始)。 */
  refinementIndex: number;
  /** 该记录直接派生出的微调数。 */
  childCount: number;
  /** 线程内记录总数(根 + 全部微调);根行的「+n 微调」= threadSize - 1。 */
  threadSize: number;
  /** 有 parentRunId 但父记录不在结果集里(已删除或被筛掉)。 */
  orphan: boolean;
}

interface ThreadIndex {
  byId: Map<string, GenerationJob>;
  childrenByParent: Map<string, GenerationJob[]>;
  parentOf: Map<string, string>;
}

function buildThreadIndex(jobs: readonly GenerationJob[]): ThreadIndex {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const parentOf = new Map<string, string>();
  for (const job of jobs) {
    const parentId = job.parentRunId ?? undefined;
    if (!parentId || parentId === job.id || !byId.has(parentId)) continue;
    parentOf.set(job.id, parentId);
  }
  // 断环:沿父链走,遇到重复节点就把当前边移除(任何记录只输出一次)。
  for (const id of [...parentOf.keys()]) {
    const seen = new Set([id]);
    let cursor = id;
    while (parentOf.has(cursor)) {
      const next = parentOf.get(cursor) as string;
      if (seen.has(next)) {
        parentOf.delete(cursor);
        break;
      }
      seen.add(next);
      cursor = next;
    }
  }
  const childrenByParent = new Map<string, GenerationJob[]>();
  for (const [childId, parentId] of parentOf) {
    const list = childrenByParent.get(parentId) ?? [];
    list.push(byId.get(childId) as GenerationJob);
    childrenByParent.set(parentId, list);
  }
  // 微调按时间正序还原迭代过程(createdAt 是 ISO 串,字典序即时间序)。
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return { byId, childrenByParent, parentOf };
}

function rootIdOf(index: ThreadIndex, id: string): string {
  let cursor = id;
  while (index.parentOf.has(cursor)) cursor = index.parentOf.get(cursor) as string;
  return cursor;
}

function flattenThread(index: ThreadIndex, root: GenerationJob): ThreadedJob[] {
  const items: ThreadedJob[] = [];
  let refinementCounter = 0;
  function visit(job: GenerationJob, depth: number) {
    const children = index.childrenByParent.get(job.id) ?? [];
    if (depth > 0) refinementCounter += 1;
    items.push({
      job,
      depth: Math.min(depth, MAX_THREAD_DEPTH),
      threadRootId: root.id,
      refinementIndex: depth === 0 ? 0 : refinementCounter,
      childCount: children.length,
      threadSize: 0, // 结尾统一回填
      orphan: depth === 0 && Boolean(job.parentRunId),
    });
    for (const child of children) visit(child, depth + 1);
  }
  visit(root, 0);
  for (const item of items) item.threadSize = items.length;
  return items;
}

/**
 * 同页线程归组(对齐旧 domain/history-lineage.flattenHistoryThreads):
 * 线程按「线程内最新活动」倒序(活跃线程浮到顶部,依赖入参已按 createdAt 倒序),
 * 线程内根在前、微调按时间正序缩进;父行不在结果集的微调降级为孤儿根并标注。
 */
export function threadJobs(jobs: readonly GenerationJob[]): ThreadedJob[] {
  const index = buildThreadIndex(jobs);
  const emittedRoots = new Set<string>();
  const items: ThreadedJob[] = [];
  for (const job of jobs) {
    const rootId = rootIdOf(index, job.id);
    if (emittedRoots.has(rootId)) continue;
    emittedRoots.add(rootId);
    items.push(...flattenThread(index, index.byId.get(rootId) as GenerationJob));
  }
  return items;
}

/** 微调标签:根行不标;孤儿标「微调」,子行标「微调 n」(承旧 refinementLabel)。 */
export function refinementLabel(item: ThreadedJob): string | null {
  if (item.depth > 0) return `微调 ${item.refinementIndex}`;
  return item.orphan ? '微调' : null;
}

/** 孤儿链路降级文案(承旧 refinementTitle)。 */
export function refinementTitle(item: ThreadedJob): string | undefined {
  if (item.orphan) return '微调(来源记录已删除)';
  return item.depth > 0 ? '基于上一张图微调' : undefined;
}
