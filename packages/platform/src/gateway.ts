import type {
  AccountSummary,
  AiProvider,
  AiProviderListModelsInput,
  AiProviderModelList,
  AiProviderTestInput,
  AiProviderTestResult,
  AppInfo,
  AppPreferences,
  AppPreferencesPatch,
  BackupInfo,
  ClearAllDataInput,
  ClearAllDataResult,
  CreateBackupResult,
  DiagnosticLog,
  OpenExternalInput,
  OpenStorageLocationInput,
  RestoreBackupInput,
  RestoreBackupResult,
  StorageLocation,
  CreateAiProvider,
  CreateGenerationInput,
  CreateWorkbenchSession,
  DesktopSyncConsent,
  DesktopSyncStatus,
  DoubaoAccountStatus,
  SyncConflictResolution,
  SyncConflictSummary,
  GenerationCleanupInput,
  GenerationCleanupResult,
  GenerationHistoryPage,
  GenerationHistoryQuery,
  GenerationIdempotencyKey,
  GenerationJob,
  GenerationReferenceImage,
  GenerationStorageUsage,
  LoginRequest,
  NewPromptDocument,
  NewPromptFolder,
  NewPromptTag,
  PromptDocument,
  PromptEmptyTrashResult,
  PromptFolder,
  PromptListQuery,
  PromptPage,
  PromptTag,
  PromptUseInput,
  PromptUseResult,
  ProviderOption,
  RedeemResult,
  RegisterRequest,
  SaveAssetInput,
  SaveAssetResult,
  UpdateAiProvider,
  UpdatePromptDocument,
  UpdatePromptFolder,
  UpdatePromptTag,
  UpdateWorkbenchSession,
  UploadReferenceImageInput,
  WorkbenchSession,
  WorkbenchSessionListQuery,
  WorkbenchSessionPage,
  DesignSchemeDetail,
  DesignSchemeDetailRevisionSelector,
  DesignSchemePage,
  MarketSearchResult,
  CreateDesignSchemeInput,
  CreateDesignSchemeResult,
  ConfirmDesignSchemeInstallInput,
  ConfirmDesignSchemeInstallResult,
  UpdateDesignSchemeInput,
  UpdateDesignSchemeResult,
  ModifyDesignSchemeInput,
  ModifyDesignSchemeResult,
  CancelDesignSchemeInput,
  CancelDesignSchemeResult,
  SelectCoverInput,
  SelectCoverResult,
  FormalizeDesignSchemeInput,
  FormalizeDesignSchemeResult,
  PromoteWorkingDraftInput,
  PromoteWorkingDraftResult,
  RenameDesignSchemeInput,
  RenameDesignSchemeResult,
  RemoveDesignSchemeInput,
  RemoveDesignSchemeResult,
  CheckDesignSchemeUpdateInput,
  CheckDesignSchemeUpdateResult,
  PrepareDesignSchemeImportPackageInput,
  PrepareDesignSchemeImportPackageResult,
  PrepareDesignSchemeRunInput,
  PrepareDesignSchemeRunResult,
  ImportDesignSchemeInput,
  ImportDesignSchemeResult,
  ExportDesignSchemeInput,
  ExportDesignSchemeResult,
  DesignSchemeRunInput,
  RunResult,
  DesignSchemeEvent,
  DesignSchemeListQuery,
  MarketSearchQuery,
} from '@musefold/contracts';

/**
 * MusefoldGateway —— features 层唯一的数据接缝(V25-ARCHITECTURE §3)。
 * Web 宿主由 @musefold/api-client 实现(HTTPS → apps/api);
 * 桌面宿主由 typed IPC 桥实现(invoke → 主进程,每方法 zod 校验)。
 * features 只依赖本接口,禁止触达 fetch/electron/window.api。
 */
export interface MusefoldGateway {
  settings: SettingsGateway;
  account: AccountGateway;
  prompts: PromptsGateway;
  workbench: WorkbenchGateway;
  generation: GenerationGateway;
  /**
   * 桌面专属:本地生图 Provider 管理(SQLite 元数据 + 主进程安全存储密钥)。
   * Web 宿主不提供(生图凭据由云端账号托管),UI 以 capabilities.hasLocalAiProviders 判断。
   */
  aiProviders?: AiProvidersGateway;
  /**
   * 桌面专属:Agent 文本模型连接(设计方案 Agent / Skill runtime 的 chat/completions)。
   * 与 aiProviders 同形状、不同事实源(v2.1 保留的 AiConnectionStore);UI 以 capabilities.hasAgentConnections 判断。
   */
  agentConnections?: AiProvidersGateway;
  /**
   * Design-scheme domain. Optional until the host has a real local/cloud adapter;
   * callers must also require capabilities.hasDesignSchemes before rendering entry points.
   */
  designSchemes?: DesignSchemesGateway;
  /**
   * 桌面专属:提示词库云同步(登录 ≠ 同步,开关由用户显式打开)。
   * Web 宿主不提供(数据天然在云端),UI 以 capabilities.hasCloudSync 判断。
   */
  sync?: SyncGateway;
  /**
   * 桌面专属:豆包网页登录(冻结 browser-service 的薄适配,QR 登录 + 状态/刷新/登出)。
   * Web 宿主不提供,UI 以 capabilities.hasDoubaoWebLogin 判断,不渲染豆包登录入口。
   */
  doubao?: DoubaoGateway;
  /**
   * 桌面专属:本机数据管理与应用信息(数据库备份 / 存储位置 / 诊断日志 / 危险区 / 版本)。
   * Web 宿主不提供(云端有自己的备份纪律,浏览器也没有本机路径概念),
   * UI 以 capabilities.hasLocalDataManagement 判断;关于卡在 Web 上降级为「Web 版」展示。
   */
  system?: SystemGateway;
}

/**
 * 桌面本机数据面。约定:备份只按备份目录内的**文件名**寻址、存储位置只按白名单 id 打开,
 * 渲染层永远不构造路径;剪贴板复制由渲染层 navigator.clipboard 完成,不进本接口。
 */
export interface SystemGateway {
  /** 版本 / 平台 / 库结构版本(报障粘贴用)。 */
  getAppInfo(): Promise<AppInfo>;
  listBackups(): Promise<BackupInfo[]>;
  /** 用 SQLite 一致性快照创建一份手动备份,返回新备份条目(列表可直接展开可见)。 */
  createBackup(): Promise<CreateBackupResult>;
  /** 恢复前主进程自动保全当前库;返回后调用方必须调 relaunch。 */
  restoreBackup(input: RestoreBackupInput): Promise<RestoreBackupResult>;
  listStorageLocations(): Promise<StorageLocation[]>;
  openStorageLocation(input: OpenStorageLocationInput): Promise<void>;
  /** 已脱敏的日志尾部(主进程 logger 保证不含密钥)。 */
  readDiagnosticLog(): Promise<DiagnosticLog>;
  /** 危险区:清空业务内容与生成历史(Provider / 密钥 / 磁盘图片不在边界内)。 */
  clearAllData(input: ClearAllDataInput): Promise<ClearAllDataResult>;
  /** 外链:https + 宿主白名单,不满足即结构化拒绝。 */
  openExternal(input: OpenExternalInput): Promise<void>;
  /** 打开随应用分发的产品文档(主进程按白名单资源 id 解析,渲染层不传路径)。 */
  openProductDocs(): Promise<void>;
  /** 重启应用(恢复备份后生效)。 */
  relaunch(): Promise<void>;
}

export interface DoubaoGateway {
  /** 只读账号摘要;不主动弹出登录窗口。 */
  getStatus(): Promise<DoubaoAccountStatus>;
  /** 启动 QR 登录流;返回含二维码 data URL 的状态快照,随后轮询 getStatus 跟进。 */
  startLogin(): Promise<DoubaoAccountStatus>;
  /** 作废当前二维码并重新走登录流(等价 stop + start)。 */
  refreshLogin(): Promise<DoubaoAccountStatus>;
  /** 清空豆包分区存储并回到未登录态。 */
  logout(): Promise<DoubaoAccountStatus>;
}

export interface DesignSchemesGateway {
  list(query: DesignSchemeListQuery): Promise<DesignSchemePage>;
  /** Omitting the selector requests the current revision. */
  get(id: string, revision?: DesignSchemeDetailRevisionSelector): Promise<DesignSchemeDetail>;
  searchMarket(query: MarketSearchQuery): Promise<MarketSearchResult>;
  create(input: CreateDesignSchemeInput): Promise<CreateDesignSchemeResult>;
  /** Optional until a host implements the active Agent-session confirmation lifecycle. */
  confirmInstall?(
    input: ConfirmDesignSchemeInstallInput,
  ): Promise<ConfirmDesignSchemeInstallResult>;
  update(input: UpdateDesignSchemeInput): Promise<UpdateDesignSchemeResult>;
  modify(input: ModifyDesignSchemeInput): Promise<ModifyDesignSchemeResult>;
  cancel(input: CancelDesignSchemeInput): Promise<CancelDesignSchemeResult>;
  selectCover(input: SelectCoverInput): Promise<SelectCoverResult>;
  formalize(input: FormalizeDesignSchemeInput): Promise<FormalizeDesignSchemeResult>;
  promoteWorkingDraft(input: PromoteWorkingDraftInput): Promise<PromoteWorkingDraftResult>;
  rename(input: RenameDesignSchemeInput): Promise<RenameDesignSchemeResult>;
  remove(input: RemoveDesignSchemeInput): Promise<RemoveDesignSchemeResult>;
  checkUpdate(input: CheckDesignSchemeUpdateInput): Promise<CheckDesignSchemeUpdateResult>;
  /** Optional until a host can validate and stage a picked/uploaded package without exposing paths. */
  prepareImportPackage?(
    input: PrepareDesignSchemeImportPackageInput,
  ): Promise<PrepareDesignSchemeImportPackageResult>;
  importPackage(input: ImportDesignSchemeInput): Promise<ImportDesignSchemeResult>;
  exportPackage(input: ExportDesignSchemeInput): Promise<ExportDesignSchemeResult>;
  /** Optional until a host can author and validate a run plan from trusted persistence. */
  prepareRun?(input: PrepareDesignSchemeRunInput): Promise<PrepareDesignSchemeRunResult>;
  run(input: DesignSchemeRunInput): Promise<RunResult>;
  subscribeEvents(listener: (event: DesignSchemeEvent) => void): () => void;
}

export interface SettingsGateway {
  getPreferences(): Promise<AppPreferences>;
  updatePreferences(patch: AppPreferencesPatch): Promise<AppPreferences>;
}

export interface AccountGateway {
  getStatus(): Promise<AccountSummary>;
  /** 账密委托 New API 校验;成功返回最新账号状态(Web 种 cookie,桌面存 bearer)。 */
  login(input: LoginRequest): Promise<AccountSummary>;
  register(input: RegisterRequest): Promise<AccountSummary>;
  logout(): Promise<void>;
  redeem(code: string): Promise<RedeemResult>;
}

export interface SyncGateway {
  getStatus(): Promise<DesktopSyncStatus>;
  /** Durable 用户决定与 runtime 状态分离;写入 consent 后由宿主决定是否启用调度。 */
  setConsent(consent: DesktopSyncConsent): Promise<DesktopSyncStatus>;
  /** 返回当前 owner 的未解决冲突摘要,不暴露 owner/workspace。 */
  listConflicts(): Promise<SyncConflictSummary[]>;
  /** Renderer 只提交冲突 id 和三选一决议。 */
  resolveConflict(
    conflictId: string,
    resolution: SyncConflictResolution,
  ): Promise<DesktopSyncStatus>;
  /** 兼容旧宿主;新调用方应使用 setConsent。 */
  setEnabled(enabled: boolean): Promise<DesktopSyncStatus>;
  syncNow(): Promise<DesktopSyncStatus>;
}

export interface AiProvidersGateway {
  list(): Promise<AiProvider[]>;
  create(input: CreateAiProvider): Promise<AiProvider>;
  update(id: string, patch: UpdateAiProvider): Promise<AiProvider>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<AiProvider>;
  /** 主进程真发探测请求(GET /models),验证 Base URL 可达与密钥有效;支持已存 id 或草稿。 */
  test(input: AiProviderTestInput): Promise<AiProviderTestResult>;
  /** 解析 OpenAI 兼容 `/models` 的 data[].id;草稿 Key 只在本次往返使用、不落库。 */
  listModels(input: AiProviderListModelsInput): Promise<AiProviderModelList>;
}

export interface PromptsGateway {
  list(query: PromptListQuery): Promise<PromptPage>;
  get(id: string): Promise<PromptDocument>;
  create(input: NewPromptDocument): Promise<PromptDocument>;
  update(id: string, patch: UpdatePromptDocument): Promise<PromptDocument>;
  remove(id: string): Promise<PromptDocument>;
  restore(id: string): Promise<PromptDocument>;
  /** 回收站内永久删除(仅已软删行合法);桌面直删 SQLite,云端硬删 PG。 */
  purge(id: string): Promise<void>;
  /**
   * 清空回收站:一次性永久删除全部已软删提示词,返回本次条数(空回收站返回 0,幂等)。
   * 破坏性动作,调用方必须先过双重确认(V25-UI-SPEC §8-I4)。
   */
  emptyTrash(): Promise<PromptEmptyTrashResult>;
  use(id: string, input: PromptUseInput): Promise<PromptUseResult>;
  listFolders(): Promise<PromptFolder[]>;
  createFolder(input: NewPromptFolder): Promise<PromptFolder>;
  updateFolder(id: string, patch: UpdatePromptFolder): Promise<PromptFolder>;
  removeFolder(id: string): Promise<PromptFolder>;
  listTags(): Promise<PromptTag[]>;
  createTag(input: NewPromptTag): Promise<PromptTag>;
  updateTag(id: string, patch: UpdatePromptTag): Promise<PromptTag>;
  removeTag(id: string): Promise<PromptTag>;
}

export interface WorkbenchGateway {
  listSessions(query: WorkbenchSessionListQuery): Promise<WorkbenchSessionPage>;
  createSession(input: CreateWorkbenchSession): Promise<WorkbenchSession>;
  getSession(id: string): Promise<WorkbenchSession>;
  updateSession(id: string, patch: UpdateWorkbenchSession): Promise<WorkbenchSession>;
  removeSession(id: string): Promise<WorkbenchSession>;
  restoreSession(id: string): Promise<WorkbenchSession>;
}

export interface GenerationGateway {
  create(
    input: CreateGenerationInput,
    idempotencyKey: GenerationIdempotencyKey,
  ): Promise<GenerationJob>;
  list(query: GenerationHistoryQuery): Promise<GenerationHistoryPage>;
  get(id: string): Promise<GenerationJob>;
  cancel(id: string): Promise<GenerationJob>;
  retry(id: string, idempotencyKey: GenerationIdempotencyKey): Promise<GenerationJob>;
  remove(id: string): Promise<GenerationJob>;
  restore(id: string): Promise<GenerationJob>;
  /** 回收站内永久删除(仅已软删行合法);桌面同时清理磁盘资产,云端清理对象存储。 */
  purge(id: string): Promise<void>;
  /** 可选 Provider 目录:云端为服务端固定项,桌面为本地 AI 连接。 */
  listProviders(): Promise<ProviderOption[]>;
  /**
   * 参考图上传(ui-parity 03 §7 P0):宿主嗅探魔数、校验尺寸后落存储
   * (桌面 staging 目录 / 云端对象存储),返回可展示、可随 create 提交的引用。
   */
  uploadReferenceImage(input: UploadReferenceImageInput): Promise<GenerationReferenceImage>;
  /**
   * 保存资产到本地(ui-parity 03/05 §7 P1):桌面走系统保存对话框(可取消),
   * Web 触发浏览器下载(fetch → blob → a[download],跨域受限时降级新窗口打开)。
   */
  saveAsset(input: SaveAssetInput): Promise<SaveAssetResult>;
  /**
   * 批量清理(ui-parity 05 §7 P2):前两种范围软删入回收站并保留资产,
   * empty-trash 按 purge 语义永久删除回收站全部记录与其资产。返回受影响条数。
   */
  cleanup(input: GenerationCleanupInput): Promise<GenerationCleanupResult>;
  /**
   * 桌面专属:生成图片目录的聚合占用(承旧 HistoryDiskUsage)。
   * Web 宿主不提供(资产在云端对象存储),UI 以 capabilities.canRevealLocalFile 判断。
   */
  getStorageUsage?(): Promise<GenerationStorageUsage>;
  /**
   * 桌面专属:在系统文件管理器中定位受管资产。只收资产 id,
   * 路径解析与受管根校验全在主进程;Web 宿主不提供。
   */
  revealAsset?(assetId: string): Promise<void>;
  /** 桌面专属:把受管资产图片写入系统剪贴板;Web 宿主不提供。 */
  copyAssetToClipboard?(assetId: string): Promise<void>;
}
