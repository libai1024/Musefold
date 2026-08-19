import type { GenerationResultSurfaceStatus } from "../models";

export interface WorkbenchGenerationSnapshot {
  id: string;
  createdAt: string | number;
}

export type WorkbenchGenerationStatus =
  | "pending"
  | "pending_approval"
  | "queued"
  | "running"
  | "cancelling"
  | "partial"
  | "success"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rejected"
  | "expired";

const ACTIVE_STATUSES = new Set<WorkbenchGenerationStatus>([
  "pending",
  "pending_approval",
  "queued",
  "running",
  "cancelling",
]);

export function sortWorkbenchGenerationSnapshots<
  T extends WorkbenchGenerationSnapshot,
>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const timeDifference =
      snapshotTimestamp(left.createdAt) - snapshotTimestamp(right.createdAt);
    return timeDifference || left.id.localeCompare(right.id);
  });
}

export function upsertWorkbenchGenerationSnapshot<
  T extends WorkbenchGenerationSnapshot,
>(items: readonly T[], next: T): T[] {
  return sortWorkbenchGenerationSnapshots([
    ...items.filter((item) => item.id !== next.id),
    next,
  ]);
}

export function latestWorkbenchGenerationSnapshot<
  T extends WorkbenchGenerationSnapshot,
>(items: readonly T[]): T | null {
  return sortWorkbenchGenerationSnapshots(items).at(-1) ?? null;
}

export function isWorkbenchGenerationActive(
  status: WorkbenchGenerationStatus,
): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function activeWorkbenchGenerationSnapshots<
  T extends WorkbenchGenerationSnapshot & { status: WorkbenchGenerationStatus },
>(items: readonly T[]): T[] {
  return items.filter((item) => isWorkbenchGenerationActive(item.status));
}

export function workbenchGenerationResultStatus(
  status: WorkbenchGenerationStatus,
): GenerationResultSurfaceStatus {
  if (status === "success" || status === "succeeded" || status === "partial")
    return "success";
  if (status === "cancelled") return "cancelled";
  if (["failed", "rejected", "expired"].includes(status)) return "failed";
  return "pending";
}

export function workbenchGenerationStatusLabel(
  status: WorkbenchGenerationStatus,
): string {
  switch (status) {
    case "pending":
    case "pending_approval":
      return status === "pending_approval" ? "等待审批" : "准备中";
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "cancelling":
      return "取消中";
    case "partial":
      return "部分完成";
    case "success":
    case "succeeded":
      return "生成完成";
    case "failed":
      return "生成失败";
    case "cancelled":
      return "已取消";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
  }
}

function snapshotTimestamp(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
