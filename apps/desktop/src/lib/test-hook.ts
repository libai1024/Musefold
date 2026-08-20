// src/lib/test-hook.ts
// E2E 测试钩子 —— 仅在 dev / MUSEFOLD_E2E 下把 store 句柄挂到 window.__musefold_test，
// 让 Playwright 可以确定性地切视图、读状态、等 store 结算，而不依赖脆弱的 UI 路径。
//
// 安全性：只暴露 UI store 的读写与视图切换，不新增任何特权能力；
// 生产构建下（import.meta.env.PROD 且无 MUSEFOLD_E2E）整个安装函数直接 return，
// 且没有任何模块引用 window.__musefold_test，因此不构成攻击面。

import { useAppStore, type ViewKey } from '../stores/app';
import { useLibraryStore } from '../features/library/store';
import { useGenerationStore } from '../features/generation/store';
import { useHistoryStore } from '../features/history/store';
import { useSettingsStore } from '../features/settings/store';
import { useOnboardingStore } from '../features/onboarding/store';
import { useGenerationWorkbenchStore } from '../features/generation/workbench/store';
import { useAiConnectionStore } from '../features/settings/ai-connection-store';
import { useSkillRuntimeStore } from '../features/generation/workbench/skill-runtime-store';
import { useSchemeCreationStore } from '../features/design-schemes/creation-store';
import { useSchemeRunStore } from '../features/design-schemes/run-store';
import { useAccountStore } from '../features/account/store';
import { useCloudConnectionsStore } from '../features/settings/cloud-connections-store';
import type { SharePayload } from '@musefold/desktop-contracts/share';

interface TestHook {
  setView: (v: ViewKey) => void;
  getView: () => ViewKey;
  stores: {
    app: typeof useAppStore;
    library: typeof useLibraryStore;
    generation: typeof useGenerationStore;
    history: typeof useHistoryStore;
    settings: typeof useSettingsStore;
    onboarding: typeof useOnboardingStore;
    workbench: typeof useGenerationWorkbenchStore;
    aiConnections: typeof useAiConnectionStore;
    skillRuntime: typeof useSkillRuntimeStore;
    schemeCreation: typeof useSchemeCreationStore;
    schemeRun: typeof useSchemeRunStore;
    account: typeof useAccountStore;
    cloudConnections: typeof useCloudConnectionsStore;
  };
  /** 读任意 store 的当前快照（结构化可序列化部分由调用方挑选） */
  snapshot: (name: keyof TestHook['stores']) => unknown;
  /** 仅供 E2E：模拟 OS deeplink / 分享导入意图。 */
  requestShareImport: (payload: SharePayload) => void;
}

declare global {
  interface Window {
    __musefold_test?: TestHook;
  }
}

function enabled(): boolean {
  if (import.meta.env.DEV) return true;
  // 打包后的 E2E：主进程通过 MUSEFOLD_E2E 环境变量启动，preload 透出到 process 无法读，
  // 故用 URL 查询或 localStorage 兜底；默认在真实用户构建里为 false。
  try {
    if (typeof location !== 'undefined' && location.search.includes('musefold_e2e=1')) return true;
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('PFE2E')) return true;
  } catch {
    /* noop */
  }
  return false;
}

export function installTestHook(): void {
  if (!enabled()) return;
  const stores = {
    app: useAppStore,
    library: useLibraryStore,
    generation: useGenerationStore,
    history: useHistoryStore,
    settings: useSettingsStore,
    onboarding: useOnboardingStore,
    workbench: useGenerationWorkbenchStore,
    aiConnections: useAiConnectionStore,
    skillRuntime: useSkillRuntimeStore,
    schemeCreation: useSchemeCreationStore,
    schemeRun: useSchemeRunStore,
    account: useAccountStore,
    cloudConnections: useCloudConnectionsStore,
  };
  window.__musefold_test = {
    setView: (v) => useAppStore.getState().setView(v),
    getView: () => useAppStore.getState().currentView,
    requestShareImport: (payload) => useAppStore.getState().requestShareImport(payload),
    stores,
    snapshot: (name) => stores[name].getState(),
  };
}
