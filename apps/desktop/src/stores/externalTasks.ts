// 外部任务活动（SET-02）：控制面发起的生图/方案/Skill 运行点亮朱点，
// 用户对「后台有 Agent 在花钱」永远有全局感知（V04-ARCHITECTURE §6.4）。

import { create } from 'zustand';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

interface ExternalTasksState {
  activeJobs: Record<string, number>;
  running: boolean;
  apply: (jobId: string, running: boolean) => void;
}

export const useExternalTasksStore = create<ExternalTasksState>((set) => ({
  activeJobs: {},
  running: false,
  apply: (jobId, running) =>
    set((state) => {
      const activeJobs = { ...state.activeJobs };
      if (running) activeJobs[jobId] = Date.now();
      else delete activeJobs[jobId];
      return { activeJobs, running: Object.keys(activeJobs).length > 0 };
    }),
}));

let bridged = false;

/** 一次性桥接：订阅主进程的外部活动事件（AppShell 挂载时调用）。 */
export function bridgeExternalTaskActivity(): void {
  if (bridged) return;
  bridged = true;
  try {
    api.automation.onActivity(({ jobId, running }) => {
      useExternalTasksStore.getState().apply(jobId, running);
    });
  } catch {
    // 预览桥等环境没有该通道：朱点忙碌态退化为本地任务
  }
}
