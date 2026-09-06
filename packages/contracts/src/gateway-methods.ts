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
    'account.login',
    'account.register',
    'account.logout',
    'account.redeem',
  ],
  sync: [
    'sync.getStatus',
    'sync.setConsent',
    'sync.listConflicts',
    'sync.resolveConflict',
    'sync.setEnabled',
    'sync.syncNow',
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
    'generation.saveAsset',
    'generation.cleanup',
    'generation.getStorageUsage',
    'generation.revealAsset',
    'generation.copyAssetToClipboard',
  ],
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
