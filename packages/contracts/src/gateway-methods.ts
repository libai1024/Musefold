/** Methods deployed through the v2.5 host data channel. */
export const DESIGN_SCHEME_METHOD_NAMES = [
  'designSchemes.cancel',
  'designSchemes.checkUpdate',
  'designSchemes.confirmInstall',
  'designSchemes.create',
  'designSchemes.exportPackage',
  'designSchemes.formalize',
  'designSchemes.promoteWorkingDraft',
  'designSchemes.get',
  'designSchemes.importPackage',
  'designSchemes.list',
  'designSchemes.modify',
  'designSchemes.prepareRun',
  'designSchemes.remove',
  'designSchemes.purge',
  'designSchemes.rename',
  'designSchemes.run',
  'designSchemes.searchMarket',
  'designSchemes.selectCover',
  'designSchemes.update',
] as const;

/**
 * Lifecycle methods that stay canonical contract entries without a data-channel deployment:
 * the package picker needs a host-native file dialog and travels a dedicated preload seam.
 */
export const DESIGN_SCHEME_LIFECYCLE_METHOD_NAMES = ['designSchemes.prepareImportPackage'] as const;

export const DESIGN_SCHEME_CANONICAL_METHOD_NAMES = [
  ...DESIGN_SCHEME_METHOD_NAMES,
  ...DESIGN_SCHEME_LIFECYCLE_METHOD_NAMES,
] as const;

export const V25_METHODS_BY_DOMAIN = {
  settings: ['settings.getPreferences', 'settings.updatePreferences'],
  account: [
    'account.getStatus',
    'account.getNotices',
    'account.login',
    'account.register',
    'account.logout',
    'account.redeem',
    'account.retryRecovery',
    'account.inspectRecovery',
    'account.verifyOriginalSession',
    'account.createIndependentWorkspace',
    'account.getExecutionBinding',
    'account.getModelCatalog',
    'account.listLoginSessions',
    'account.getLoginCapacityReview',
    'account.completeLoginCapacity',
    'account.cancelLoginCapacity',
    'account.revokeLoginSessions',
    'account.touchLoginSession',
    'account.getLoginReleaseStatus',
  ],
  sync: [
    'sync.getStatus',
    'sync.listLocalWorkspaces',
    'sync.previewLocalWorkspace',
    'sync.prepareLocalWorkspace',
    'sync.setConsent',
    'sync.listConflicts',
    'sync.resolveConflict',
    'sync.setEnabled',
    'sync.syncNow',
  ],
  accountCloud: [
    'accountCloud.getStatus',
    'accountCloud.connect',
    'accountCloud.resume',
    'accountCloud.listRecovery',
    'accountCloud.listLegacy',
    'accountCloud.reconcile',
    'accountCloud.cancel',
  ],
  aiProviders: [
    'aiProviders.list',
    'aiProviders.create',
    'aiProviders.update',
    'aiProviders.remove',
    'aiProviders.setActive',
    'aiProviders.test',
    'aiProviders.listModels',
  ],
  // Agent 文本模型连接(桌面专属可选域):设计方案 Agent / Skill runtime 的 chat/completions 连接。
  agentConnections: [
    'agentConnections.list',
    'agentConnections.create',
    'agentConnections.update',
    'agentConnections.remove',
    'agentConnections.setActive',
    'agentConnections.test',
    'agentConnections.listModels',
  ],
  designSchemes: DESIGN_SCHEME_METHOD_NAMES,
  // 豆包网页登录(桌面专属可选域):冻结 browser-service 的薄适配,无入参。
  doubao: ['doubao.getStatus', 'doubao.startLogin', 'doubao.refreshLogin', 'doubao.logout'],
  // 系统 / 本地数据管理(桌面专属可选域):设置「数据存储」与「关于」两张卡。
  // 备份只按文件名寻址、存储位置只按白名单 id 打开;剪贴板复制在渲染层完成,不设 IPC。
  system: [
    'system.getAppInfo',
    'system.listBackups',
    'system.createBackup',
    'system.restoreBackup',
    'system.listStorageLocations',
    'system.openStorageLocation',
    'system.readDiagnosticLog',
    'system.clearAllData',
    'system.openExternal',
    'system.openProductDocs',
    'system.relaunch',
  ],
  // 应用更新(桌面专属可选域):设置「关于 → 应用更新」卡。
  // 状态机与偏好读写在主进程 UpdaterService / electron-store;渲染层轮询状态(无事件通道)。
  appUpdate: [
    'appUpdate.getState',
    'appUpdate.checkForUpdates',
    'appUpdate.downloadUpdate',
    'appUpdate.installUpdate',
    'appUpdate.updatePreferences',
  ],
  // 开放能力 / 本地控制面(桌面专属可选域):设置「开放能力」三张卡 + 壳级确认卡。
  // 令牌只以掩码下发,复制经主进程剪贴板(automation.copyToken),渲染层拿不到明文;
  // 确认事件走 preload `automation:confirmation*` 独立通道,不进本方法表。
  automation: [
    'automation.getStatus',
    'automation.setEnabled',
    'automation.rotateToken',
    'automation.copyToken',
    'automation.setMonthlyBudget',
    'automation.listRequestLog',
    'automation.listSpendAudit',
    'automation.resolveConfirmation',
    'automation.getIntegrationGuide',
  ],
  prompts: [
    'prompts.list',
    'prompts.get',
    'prompts.create',
    'prompts.update',
    'prompts.remove',
    'prompts.restore',
    'prompts.purge',
    'prompts.emptyTrash',
    'prompts.use',
    'prompts.listFolders',
    'prompts.createFolder',
    'prompts.updateFolder',
    'prompts.removeFolder',
    'prompts.listTags',
    'prompts.createTag',
    'prompts.updateTag',
    'prompts.removeTag',
  ],
  workbench: [
    'workbench.listSessions',
    'workbench.createSession',
    'workbench.getSession',
    'workbench.updateSession',
    'workbench.removeSession',
    'workbench.restoreSession',
    'workbench.purgeSession',
    'workbench.emptyTrash',
  ],
  generation: [
    'generation.create',
    'generation.list',
    'generation.get',
    'generation.cancel',
    'generation.retry',
    'generation.remove',
    'generation.restore',
    'generation.purge',
    'generation.listProviders',
    'generation.uploadReferenceImage',
    'generation.releaseReferenceImage',
    'generation.saveAsset',
    'generation.cleanup',
    'generation.getStorageUsage',
    'generation.revealAsset',
    'generation.copyAssetToClipboard',
  ],
  // 使用统计(双端必选):设置「使用统计」卡,桌面聚合 SQLite,云端聚合 PG 生成任务表。
  usage: ['usage.summary'],
  // Cloud MCP 已连接应用(双端可选域):列出/撤销当前用户已授权的 OAuth 客户端。
  // 出参 secret-free;自定义账号服务器由桌面域抛 CLOUD_MCP_CUSTOM_SERVER。
  cloudMcp: ['cloudMcp.listAuthorizations', 'cloudMcp.revokeAuthorization'],
} as const;

export const V25_METHOD_NAMES = Object.values(V25_METHODS_BY_DOMAIN).flat() as [
  string,
  ...string[],
];

export type DesignSchemeMethodName = (typeof DESIGN_SCHEME_METHOD_NAMES)[number];
export type DesignSchemeLifecycleMethodName = (typeof DESIGN_SCHEME_LIFECYCLE_METHOD_NAMES)[number];
export type DesignSchemeCanonicalMethodName = (typeof DESIGN_SCHEME_CANONICAL_METHOD_NAMES)[number];
export type V25MethodName = (typeof V25_METHOD_NAMES)[number];
export type V25DomainName = keyof typeof V25_METHODS_BY_DOMAIN;

const designSchemeMethodSuffixes = DESIGN_SCHEME_CANONICAL_METHOD_NAMES.map((name) => [
  name.slice('designSchemes.'.length),
  name,
]) as Array<[string, DesignSchemeCanonicalMethodName]>;

export const DESIGN_SCHEME_WIRE_METHODS = Object.fromEntries(designSchemeMethodSuffixes) as Record<
  DesignSchemeCanonicalMethodName extends `designSchemes.${infer Suffix}` ? Suffix : never,
  DesignSchemeCanonicalMethodName
>;
