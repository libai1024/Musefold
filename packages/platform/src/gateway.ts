import type {
  AccountSummary,
  AiProvider,
  AiProviderTestResult,
  AppPreferences,
  AppPreferencesPatch,
  CreateAiProvider,
  CreateGenerationInput,
  CreateWorkbenchSession,
  DesktopSyncConsent,
  DesktopSyncStatus,
  DoubaoAccountStatus,
  SyncConflictResolution,
  SyncConflictSummary,
  GenerationHistoryPage,
  GenerationHistoryQuery,
  GenerationIdempotencyKey,
  GenerationJob,
  GenerationReferenceImage,
  LoginRequest,
  NewPromptDocument,
  NewPromptFolder,
  NewPromptTag,
  PromptDocument,
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
  /** 主进程真发探测请求(GET /models),验证 Base URL 可达与密钥有效。 */
  test(id: string): Promise<AiProviderTestResult>;
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
}
