// 历史记录三态展示元数据 —— 纯逻辑，可单测（TASK-HIS-01）
// V13-ENT-02：词表对齐 contracts 的 GenerationStatus（'succeeded'），双端共用同一份元数据。
// 桌面列表查询仍用 desktop-contracts/enums 的桌面词表（'success'），映射见 history store。

/** 云任务三态（与 @musefold/contracts 的 GenerationStatus 同形）；domain 不依赖 contracts。 */
export type HistoryStatus = 'succeeded' | 'failed' | 'cancelled';

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
  succeeded: {
    status: 'succeeded',
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

/** 归一化未知 status，避免 UI 崩；未知当 failed 处理但保留原串不可用时回落。
 * 桌面存储词表 `success` 视为 `succeeded`，防止 IPC 行状态漏进展示层时被当成失败。 */
export function historyStatusMeta(status: string | null | undefined): HistoryStatusMeta {
  if (status === 'success' || status === 'succeeded') return META.succeeded;
  if (status === 'failed' || status === 'cancelled') return META[status];
  return META.failed;
}
