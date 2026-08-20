// electron/preload/api/skill-runtime.ts
// skillRuntime 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const skillRuntimeApi = {
  prepareGithub: (
    request: import("@musefold/desktop-contracts/skill-runtime").PrepareGithubSkillRuntimeRequest,
  ) => ipcRenderer.invoke(IPC.SKILL_RUNTIME_PREPARE_GITHUB, request),
  execute: (
    request: import("@musefold/desktop-contracts/skill-runtime").ExecuteSkillRuntimeRequest,
  ) => ipcRenderer.invoke(IPC.SKILL_RUNTIME_EXECUTE, request),
  cancel: (executionId: string) =>
    ipcRenderer.invoke(IPC.SKILL_RUNTIME_CANCEL, executionId),
  release: (runtimeId: string) =>
    ipcRenderer.invoke(IPC.SKILL_RUNTIME_RELEASE, runtimeId),
  onEvent: (
    cb: (
      event: import("@musefold/desktop-contracts/skill-runtime").SkillRuntimeEvent,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: import("@musefold/desktop-contracts/skill-runtime").SkillRuntimeEvent,
    ) => cb(payload);
    ipcRenderer.on(IPC.SKILL_RUNTIME_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC.SKILL_RUNTIME_EVENT, listener);
  },
};
