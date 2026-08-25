// packages/desktop-contracts/src/api-method-versions.ts
// window.api 方法面 → 引入该能力的外壳 semver。
//
// 热更新体系的第一个会消费 bundle 的外壳是 0.5.0；更早的引入时间没有意义
// （0.5.0 之前的外壳根本不会消费 bundle）。因此本表现有全部方法一律填 '0.5.0'。
// 新增方法必须填「首个将随其发布的外壳 semver」。
//
// 完整性由编译器强制：给 window.api 加方法而不在本表登记引入版本，typecheck
// 会因本映射缺少对应键而失败——这就是登记表不会烂掉的机制。
//
// 协议按 IPC 通道集合推导 minShellVersion；renderer 源码不引用通道常量，真正
// 依赖的是 preload 暴露的 window.api.<group>.<method>。本表按方法面建索引，
// 是对协议条款的语义等价实现。
//
// 本文件是零 runtime import 叶子（只 import type Api），供
// scripts/derive-min-shell-version.mjs 在 Node 24 类型剥离下动态 import。

import type { Api } from './ipc';

/** 热更新首个可用外壳；现有方法的引入版本一律落在这条基线上。 */
const BASELINE = '0.5.0';

/**
 * 将 window.api 的方法面映射为「引入该能力的外壳 semver」。
 *
 * 理想的两层形状是 `{ readonly [G in keyof Api]: { readonly [M in keyof Api[G]]: string } }`，
 * 但 Api 含非函数成员（`automation.budget`），那些键必须递归映射为
 * 嵌套对象，不能写成 string。函数叶子必须是 string。
 */
export type ApiMethodIntroducedIn = {
  readonly [G in keyof Api]: ApiNestedIntroducedIn<Api[G]>;
};

type ApiNestedIntroducedIn<T> = {
  readonly [M in keyof T]: T[M] extends (...args: never[]) => unknown
    ? string
    : ApiNestedIntroducedIn<T[M]>;
};

export const API_METHOD_INTRODUCED_IN: ApiMethodIntroducedIn = {
  prompt: {
    list: BASELINE,
    get: BASELINE,
    create: BASELINE,
    update: BASELINE,
    delete: BASELINE,
    togglePin: BASELINE,
    reorderPins: BASELINE,
    incrementUsage: BASELINE,
    listDeleted: BASELINE,
    restore: BASELINE,
    purge: BASELINE,
    purgeAll: BASELINE,
    stats: BASELINE,
  },
  searchHistory: {
    list: BASELINE,
    add: BASELINE,
    clear: BASELINE,
  },
  skillRuntime: {
    prepareGithub: BASELINE,
    execute: BASELINE,
    cancel: BASELINE,
    release: BASELINE,
    onEvent: BASELINE,
  },
  designScheme: {
    startCreation: BASELINE,
    confirmInstall: BASELINE,
    cancelCreation: BASELINE,
    list: BASELINE,
    getRevision: BASELINE,
    listAssets: BASELINE,
    updateInputs: BASELINE,
    startRun: BASELINE,
    cancelRun: BASELINE,
    selectCover: BASELINE,
    formalize: BASELINE,
    rename: BASELINE,
    remove: BASELINE,
    listSourceFiles: BASELINE,
    startModify: BASELINE,
    cancelModify: BASELINE,
    promoteWorkingDraft: BASELINE,
    checkUpdate: BASELINE,
    marketSearch: BASELINE,
    exportScheme: BASELINE,
    importScheme: BASELINE,
    onEvent: BASELINE,
  },
  aiConnection: {
    listPresets: BASELINE,
    list: BASELINE,
    create: BASELINE,
    update: BASELINE,
    delete: BASELINE,
    saveKey: BASELINE,
    deleteKey: BASELINE,
    hasKey: BASELINE,
    setActive: BASELINE,
    listModels: BASELINE,
    validate: BASELINE,
  },
  provider: {
    list: BASELINE,
    create: BASELINE,
    update: BASELINE,
    delete: BASELINE,
    saveKey: BASELINE,
    hasKey: BASELINE,
    openWebLogin: BASELINE,
    webLoginStart: BASELINE,
    webLoginRefresh: BASELINE,
    webLogout: BASELINE,
    webLoginState: BASELINE,
    setWebDeveloperVisible: BASELINE,
    onWebLoginChanged: BASELINE,
    webUsage: BASELINE,
    webStatus: BASELINE,
    validate: BASELINE,
    listModels: BASELINE,
    setActive: BASELINE,
  },
  image: {
    pickLocal: BASELINE,
    stageLocal: BASELINE,
    generate: BASELINE,
    cancel: BASELINE,
    retry: BASELINE,
    onProgress: BASELINE,
  },
  workbenchSession: {
    ensure: BASELINE,
    list: BASELINE,
    get: BASELINE,
    rename: BASELINE,
    archive: BASELINE,
    delete: BASELINE,
  },
  history: {
    list: BASELINE,
    related: BASELINE,
    linkPrompt: BASELINE,
    get: BASELINE,
    delete: BASELINE,
    clear: BASELINE,
    stats: BASELINE,
  },
  share: {
    renderCard: BASELINE,
    buildDeeplink: BASELINE,
    parseDeeplink: BASELINE,
    import: BASELINE,
    consumePending: BASELINE,
    onIncoming: BASELINE,
  },
  system: {
    getPaths: BASELINE,
    getVersion: BASELINE,
    openAboutResource: BASELINE,
    openInFolder: BASELINE,
    saveImage: BASELINE,
    saveImages: BASELINE,
    copyImage: BASELINE,
    readClipboardText: BASELINE,
    readClipboardImage: BASELINE,
    diskUsage: BASELINE,
    export: BASELINE,
    import: BASELINE,
    listBackups: BASELINE,
    backupNow: BASELINE,
    restoreBackup: BASELINE,
    relaunch: BASELINE,
    resetData: BASELINE,
  },
  updater: {
    getState: BASELINE,
    check: BASELINE,
    download: BASELINE,
    install: BASELINE,
    getChannel: BASELINE,
    setChannel: BASELINE,
    onStateChanged: BASELINE,
    notifyContentReady: BASELINE,
    getContentState: BASELINE,
    checkContentNow: BASELINE,
  },
  log: {
    tail: BASELINE,
    openDir: BASELINE,
  },
  automation: {
    status: BASELINE,
    setEnabled: BASELINE,
    rotateToken: BASELINE,
    auditList: BASELINE,
    confirm: BASELINE,
    budget: {
      get: BASELINE,
      set: BASELINE,
    },
    onConfirmationRequired: BASELINE,
    onConfirmationResolved: BASELINE,
    onActivity: BASELINE,
    onSetupRequested: BASELINE,
    onProviderChanged: BASELINE,
    integrationInfo: BASELINE,
    integrationAction: BASELINE,
  },
  account: {
    status: BASELINE,
    register: BASELINE,
    login: BASELINE,
    logout: BASELINE,
    redeem: BASELINE,
    refreshQuota: BASELINE,
    setServerUrl: BASELINE,
    onChanged: BASELINE,
  },
  cloudSync: {
    status: BASELINE,
    setEnabled: BASELINE,
    syncNow: BASELINE,
    conflicts: BASELINE,
    resolve: BASELINE,
    onChanged: BASELINE,
  },
  cloudConnections: {
    list: BASELINE,
    update: BASELINE,
    revoke: BASELINE,
  },
  diagnostics: {
    onError: BASELINE,
  },
  pet: {
    setEnabled: BASELINE,
    isEnabled: BASELINE,
    getFrame: BASELINE,
    ready: BASELINE,
    onFrame: BASELINE,
    interact: BASELINE,
    moveBy: BASELINE,
    runToComposer: BASELINE,
    returnHome: BASELINE,
    openMenu: BASELINE,
  },
  window: {
    minimize: BASELINE,
    maximizeToggle: BASELINE,
    close: BASELINE,
    isMaximized: BASELINE,
    platform: BASELINE,
    onMaximizeChange: BASELINE,
    onFullscreenChange: BASELINE,
  },
};
