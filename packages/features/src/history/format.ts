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

export function formatDuration(job: GenerationJob): string | null {
  if (!job.startedAt || !job.finishedAt) return null;
  const seconds = (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds >= 60
    ? `${Math.round(seconds / 60)} 分钟`
    : `${Math.max(1, Math.round(seconds))} 秒`;
}

const MAX_THREAD_DEPTH = 4;

export interface ThreadedJob {
  job: GenerationJob;
  depth: number;
}

/**
 * 同页线程归组(承旧历史屏缩进观感):重试链子行挂到父行之后。
 * 父行不在本页时子行平铺(分页边界不做跨页装配)。
 */
export function threadJobs(jobs: readonly GenerationJob[]): ThreadedJob[] {
  const byParent = new Map<string, GenerationJob[]>();
  const ids = new Set(jobs.map((job) => job.id));
  const roots: GenerationJob[] = [];
  for (const job of jobs) {
    if (job.parentRunId && ids.has(job.parentRunId)) {
      const list = byParent.get(job.parentRunId) ?? [];
      list.push(job);
      byParent.set(job.parentRunId, list);
    } else {
      roots.push(job);
    }
  }
  const result: ThreadedJob[] = [];
  function push(job: GenerationJob, depth: number) {
    result.push({ job, depth });
    const children = byParent.get(job.id) ?? [];
    // 子行按时间正序排在父行下,重演重试顺序。
    for (const child of [...children].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      push(child, Math.min(depth + 1, MAX_THREAD_DEPTH));
    }
  }
  for (const root of roots) push(root, 0);
  return result;
}
