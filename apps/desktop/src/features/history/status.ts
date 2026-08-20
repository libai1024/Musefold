// src/features/history/status.ts
// 历史记录三态展示元数据 —— 纯逻辑，可单测（TASK-HIS-01）

import type { HistoryStatus } from '@shared/types/enums';

export interface HistoryStatusMeta {
  status: HistoryStatus;
  /** 简短中文标签 */
  label: string;
  /** tailwind text color class */
  colorClass: string;
  /** 是否允许「重试」动作（仅 failed） */
  canRetry: boolean;
  /** 是否按失败样式展示 errorMessage */
  showError: boolean;
}

const META: Record<HistoryStatus, HistoryStatusMeta> = {
  success: {
    status: 'success',
    label: '成功',
    colorClass: 'text-success',
    canRetry: false,
    showError: false,
  },
  failed: {
    status: 'failed',
    label: '失败',
    colorClass: 'text-danger',
    canRetry: true,
    showError: true,
  },
  cancelled: {
    status: 'cancelled',
    label: '已取消',
    colorClass: 'text-tertiary',
    canRetry: false,
    showError: false,
  },
};

/** 归一化未知 status，避免 UI 崩；未知当 failed 处理但保留原串不可用时回落 */
export function historyStatusMeta(status: string | null | undefined): HistoryStatusMeta {
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    return META[status];
  }
  return META.failed;
}
