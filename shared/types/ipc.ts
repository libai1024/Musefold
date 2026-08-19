// shared/types/ipc.ts
// IPC 通道契约 —— 通道名 + 请求/响应类型。preload 与渲染进程都依赖它。
// 详见 docs/07-ipc-contracts.md

import type {
  Prompt,
  NewPrompt,
  Folder,
  NewFolder,
  Tag,
  NewTag,
  HistoryRecord,
  HistoryStats,
  HistoryStatsQuery,
  LibraryQuerySnapshot,
  SmartSet,
  NewSmartSet,
  SearchHistoryItem,
  ProviderConfig,
  NewProviderConfig,
  ProviderPricingConfig,
  ProviderPricingSetRequest,
} from "./models";
import type { PetFrame, PetInteraction } from "./pet";
import type { PromptSource } from "./enums";
import type { UpdateStatus } from "./updater";
import type {
  EnsureWorkbenchSessionCommand,
  WorkbenchSession,
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from "./workbench";
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  ModelInfo,
  ValidationResult,
} from "./providers";
import type { HistoryStatus } from "./enums";
import type { SharePayload } from "../share";
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionValidationResult,
  AiTextModelInfo,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from "./ai";
import type { DiagnosticReport } from "../diagnostics";
import type { SkillRuntimeApi } from "./skill-runtime";
import type { DesignSchemeApi } from "./design-scheme";
import type {
  AccountCredentialsInput,
  AccountRedeemResult,
  AccountStatus,
} from "./account";
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from "./cloud-sync";
import type {
  McpConnectionPage,
  UpdateMcpConnection,
} from "@musefold/contracts";

// ---------- 通道名常量 ----------
export const IPC = {
  // prompts
  PROMPTS_LIST: "db:prompts:list",
  PROMPTS_GET: "db:prompts:get",
  PROMPTS_CREATE: "db:prompts:create",
  PROMPTS_UPDATE: "db:prompts:update",
  PROMPTS_DELETE: "db:prompts:delete",
  PROMPTS_BATCH_ADD_TAGS: "db:prompts:batchAddTags",
  PROMPTS_BATCH_MOVE: "db:prompts:batchMove",
  PROMPTS_BATCH_SET_PIN: "db:prompts:batchSetPin",
  PROMPTS_BATCH_DELETE: "db:prompts:batchDelete",
  PROMPTS_TOGGLE_PIN: "db:prompts:togglePin",
  PROMPTS_REORDER_PINS: "db:prompts:reorderPins",
  PROMPTS_INCREMENT_USAGE: "db:prompts:incrementUsage",
  // 回收站（docs/product/10 TASK-LIB-12）
  PROMPTS_LIST_DELETED: "db:prompts:listDeleted",
  PROMPTS_RESTORE: "db:prompts:restore",
  PROMPTS_PURGE: "db:prompts:purge",
  PROMPTS_PURGE_ALL: "db:prompts:purgeAll",
  PROMPTS_STATS: "db:prompts:stats",
  // smart sets / search history（docs/product/15 TASK-DIF-06）
  SMART_SETS_LIST: "db:smartSets:list",
  SMART_SETS_CREATE: "db:smartSets:create",
  SMART_SETS_UPDATE: "db:smartSets:update",
  SMART_SETS_DELETE: "db:smartSets:delete",
  SEARCH_HISTORY_LIST: "db:searchHistory:list",
  SEARCH_HISTORY_ADD: "db:searchHistory:add",
  SEARCH_HISTORY_CLEAR: "db:searchHistory:clear",
  // folders
  FOLDERS_LIST: "db:folders:list",
  FOLDERS_CREATE: "db:folders:create",
  FOLDERS_UPDATE: "db:folders:update",
  FOLDERS_DELETE: "db:folders:delete",
  FOLDERS_REORDER: "db:folders:reorder",
  // tags
  TAGS_LIST: "db:tags:list",
  TAGS_CREATE: "db:tags:create",
  TAGS_UPDATE: "db:tags:update",
  TAGS_DELETE: "db:tags:delete",
  TAGS_ASSIGN: "db:tags:assignToPrompt",
  WORKBENCH_SESSION_ENSURE: "workbenchSession:ensure",
  WORKBENCH_SESSION_LIST: "workbenchSession:list",
  WORKBENCH_SESSION_GET: "workbenchSession:get",
  WORKBENCH_SESSION_RENAME: "workbenchSession:rename",
  WORKBENCH_SESSION_ARCHIVE: "workbenchSession:archive",
  WORKBENCH_SESSION_DELETE: "workbenchSession:delete",
  SKILL_RUNTIME_PREPARE_GITHUB: "skillRuntime:prepareGithub",
  SKILL_RUNTIME_EXECUTE: "skillRuntime:execute",
  SKILL_RUNTIME_CANCEL: "skillRuntime:cancel",
  SKILL_RUNTIME_RELEASE: "skillRuntime:release",
  /** 主进程 → 渲染进程的 Skill 执行事件（流式文本 / 工具调用 / 生图结果） */
  SKILL_RUNTIME_EVENT: "skillRuntime:event",
  // v0.3.2 设计方案 Runtime（创建切片）
  DESIGN_SCHEME_CREATE_START: "designScheme:create:start",
  DESIGN_SCHEME_CREATE_CONFIRM_INSTALL: "designScheme:create:confirmInstall",
  DESIGN_SCHEME_CREATE_CANCEL: "designScheme:create:cancel",
  DESIGN_SCHEME_LIST: "designScheme:list",
  DESIGN_SCHEME_GET_REVISION: "designScheme:getRevision",
  DESIGN_SCHEME_LIST_ASSETS: "designScheme:listAssets",
  DESIGN_SCHEME_UPDATE_INPUTS: "designScheme:updateInputs",
  DESIGN_SCHEME_RUN_START: "designScheme:run:start",
  DESIGN_SCHEME_RUN_CANCEL: "designScheme:run:cancel",
  DESIGN_SCHEME_SELECT_COVER: "designScheme:selectCover",
  DESIGN_SCHEME_FORMALIZE: "designScheme:formalize",
  DESIGN_SCHEME_RENAME: "designScheme:rename",
  DESIGN_SCHEME_REMOVE: "designScheme:remove",
  DESIGN_SCHEME_LIST_SOURCE_FILES: "designScheme:listSourceFiles",
  DESIGN_SCHEME_MODIFY_START: "designScheme:modify:start",
  DESIGN_SCHEME_MODIFY_CANCEL: "designScheme:modify:cancel",
  DESIGN_SCHEME_PROMOTE_DRAFT: "designScheme:promoteDraft",
  DESIGN_SCHEME_CHECK_UPDATE: "designScheme:checkUpdate",
  DESIGN_SCHEME_MARKET_SEARCH: "designScheme:marketSearch",
  DESIGN_SCHEME_EXPORT: "designScheme:export",
  DESIGN_SCHEME_IMPORT: "designScheme:import",
  /** 主进程 → 渲染进程的方案创建事件（状态机 / 轨迹 / 安装确认 / 草稿就绪） */
  DESIGN_SCHEME_EVENT: "designScheme:event",
  // BYOK text AI connections and design assistants
  AI_CONNECTION_LIST_PRESETS: "aiConnection:listPresets",
  AI_CONNECTION_LIST: "aiConnection:list",
  AI_CONNECTION_CREATE: "aiConnection:create",
  AI_CONNECTION_UPDATE: "aiConnection:update",
  AI_CONNECTION_DELETE: "aiConnection:delete",
  AI_CONNECTION_SAVE_KEY: "aiConnection:saveKey",
  AI_CONNECTION_DELETE_KEY: "aiConnection:deleteKey",
  AI_CONNECTION_HAS_KEY: "aiConnection:hasKey",
  AI_CONNECTION_SET_ACTIVE: "aiConnection:setActive",
  AI_CONNECTION_LIST_MODELS: "aiConnection:listModels",
  AI_CONNECTION_VALIDATE: "aiConnection:validate",
  // providers
  PROVIDER_LIST: "provider:list",
  PROVIDER_CREATE: "provider:create",
  PROVIDER_UPDATE: "provider:update",
  PROVIDER_DELETE: "provider:delete",
  PROVIDER_SAVE_KEY: "provider:saveKey",
  PROVIDER_HAS_KEY: "provider:hasKey",
  PROVIDER_OPEN_WEB_LOGIN: "provider:openWebLogin",
  PROVIDER_WEB_LOGIN_START: "provider:webLoginStart",
  PROVIDER_WEB_LOGIN_REFRESH: "provider:webLoginRefresh",
  PROVIDER_WEB_LOGOUT: "provider:webLogout",
  PROVIDER_WEB_LOGIN_STATE: "provider:webLoginState",
  PROVIDER_WEB_LOGIN_CHANGED: "provider:webLoginChanged",
  PROVIDER_WEB_DEVELOPER_VISIBLE: "provider:setWebDeveloperVisible",
  PROVIDER_WEB_USAGE: "provider:webUsage",
  PROVIDER_WEB_STATUS: "provider:webStatus",
  PROVIDER_VALIDATE: "provider:validate",
  PROVIDER_LIST_MODELS: "provider:listModels",
  PROVIDER_SET_ACTIVE: "provider:setActive",
  // settings
  SETTINGS_PRICING_GET: "settings:pricing:get",
  SETTINGS_PRICING_SET: "settings:pricing:set",
  SETTINGS_PRICING_DELETE: "settings:pricing:delete",
  // images
  IMAGE_GENERATE: "image:generate",
  IMAGE_PICK_LOCAL: "image:pickLocal",
  IMAGE_STAGE_LOCAL: "image:stageLocal",
  IMAGE_CANCEL: "image:cancel",
  IMAGE_RETRY: "image:retry",
  IMAGE_PROGRESS: "image:progress",
  // history
  HISTORY_LIST: "db:history:list",
  HISTORY_RELATED: "db:history:related",
  HISTORY_LINK_PROMPT: "db:history:linkPrompt",
  HISTORY_GET: "db:history:get",
  HISTORY_DELETE: "db:history:delete",
  HISTORY_CLEAR: "db:history:clear",
  HISTORY_STATS: "db:history:stats",
  // system
  SYSTEM_GET_PATHS: "system:getPaths",
  SYSTEM_GET_VERSION: "system:getVersion",
  SYSTEM_OPEN_ABOUT_RESOURCE: "system:openAboutResource",
  SYSTEM_OPEN_IN_FOLDER: "system:openInFolder",
  SYSTEM_SAVE_IMAGE: "system:saveImage",
  SYSTEM_SAVE_IMAGES: "system:saveImages",
  SYSTEM_COPY_IMAGE: "system:copyImage",
  SYSTEM_READ_CLIPBOARD_TEXT: "system:readClipboardText",
  SYSTEM_READ_CLIPBOARD_IMAGE: "system:readClipboardImage",
  AUTOMATION_STATUS: "automation:status",
  AUTOMATION_SET_ENABLED: "automation:setEnabled",
  AUTOMATION_ROTATE_TOKEN: "automation:rotateToken",
  AUTOMATION_AUDIT_LIST: "automation:auditList",
  // v0.5 账号与云通道（V05-ACC-05；docs/v0.5/V05-ARCHITECTURE.md §7）
  ACCOUNT_STATUS: "account:status",
  ACCOUNT_REGISTER: "account:register",
  ACCOUNT_LOGIN: "account:login",
  ACCOUNT_LOGOUT: "account:logout",
  ACCOUNT_REDEEM: "account:redeem",
  ACCOUNT_REFRESH_QUOTA: "account:refreshQuota",
  ACCOUNT_SET_SERVER_URL: "account:setServerUrl",
  /** 主进程 → 渲染进程：登录/登出/额度/健康度/公告变化 */
  ACCOUNT_CHANGED: "account:changed",
  CLOUD_SYNC_STATUS: "cloudSync:status",
  CLOUD_SYNC_SET_ENABLED: "cloudSync:setEnabled",
  CLOUD_SYNC_NOW: "cloudSync:now",
  CLOUD_SYNC_CONFLICTS: "cloudSync:conflicts",
  CLOUD_SYNC_RESOLVE: "cloudSync:resolve",
  CLOUD_SYNC_CHANGED: "cloudSync:changed",
  CLOUD_CONNECTIONS_LIST: "cloudConnections:list",
  CLOUD_CONNECTIONS_UPDATE: "cloudConnections:update",
  CLOUD_CONNECTIONS_REVOKE: "cloudConnections:revoke",
  AUTOMATION_CONFIRM: "automation:confirm",
  AUTOMATION_BUDGET_GET: "automation:budgetGet",
  AUTOMATION_BUDGET_SET: "automation:budgetSet",
  AUTOMATION_CONFIRMATION_REQUIRED: "automation:confirmationRequired",
  AUTOMATION_CONFIRMATION_RESOLVED: "automation:confirmationResolved",
  AUTOMATION_ACTIVITY: "automation:activity",
  /** 控制面只负责唤起原生配置页；凭据仍由用户在渲染层输入。 */
  AUTOMATION_SETUP_REQUESTED: "automation:setupRequested",
  AUTOMATION_PROVIDER_CHANGED: "automation:providerChanged",
  AUTOMATION_INTEGRATION_INFO: "automation:integrationInfo",
  AUTOMATION_INTEGRATION_ACTION: "automation:integrationAction",
  SYSTEM_DISK_USAGE: "system:diskUsage",
  SYSTEM_EXPORT: "system:export",
  SYSTEM_IMPORT: "system:import",
  SYSTEM_LIST_BACKUPS: "system:listBackups",
  SYSTEM_BACKUP_NOW: "system:backupNow",
  SYSTEM_RESTORE_BACKUP: "system:restoreBackup",
  SYSTEM_RELAUNCH: "system:relaunch",
  SYSTEM_RESET_DATA: "system:resetData",
  // application updates
  UPDATER_GET_STATE: "updater:getState",
  UPDATER_CHECK: "updater:check",
  UPDATER_DOWNLOAD: "updater:download",
  UPDATER_INSTALL: "updater:install",
  UPDATER_STATE_CHANGED: "updater:stateChanged",
  // share / deeplink（docs/product/15 TASK-DIF-05）
  SHARE_RENDER_CARD: "share:renderCard",
  SHARE_BUILD_DEEPLINK: "share:buildDeeplink",
  SHARE_PARSE_DEEPLINK: "share:parseDeeplink",
  SHARE_IMPORT: "share:import",
  SHARE_CONSUME_PENDING: "share:consumePending",
  SHARE_INCOMING: "share:incoming",
  // logs
  LOG_TAIL: "log:tail",
  LOG_OPEN_DIR: "log:openDir",
  // 桌宠（悬浮伴侣）：纯表现层，只消费生图活动快照
  PET_SET_ENABLED: "pet:setEnabled",
  PET_IS_ENABLED: "pet:isEnabled",
  PET_GET_FRAME: "pet:getFrame",
  PET_FRAME: "pet:frame",
  PET_READY: "pet:ready",
  PET_INTERACT: "pet:interact",
  PET_MOVE_BY: "pet:moveBy",
  PET_RUN_TO_COMPOSER: "pet:runToComposer",
  PET_RETURN_HOME: "pet:returnHome",
  PET_MENU: "pet:menu",
  // global diagnostics event (main/preload -> renderer)
  DIAGNOSTICS_ERROR: "diagnostics:error",
} as const;

// ---------- 查询/请求类型 ----------

export interface ListPromptsQuery extends LibraryQuerySnapshot {
  /** 排序方向；缺省 desc（title 的 desc 语义为 A→Z，见 repositories/prompts.ts） */
}

export interface UpdateSmartSetPatch {
  name?: string;
  query?: LibraryQuerySnapshot;
  sortOrder?: number;
}

export interface UpdatePromptPatch {
  title?: string;
  description?: string | null;
  content?: string;
  contentNegative?: string | null;
  isPinned?: boolean;
  folderId?: string | null;
  modelId?: string | null;
  params?: Prompt["params"];
  previewImagePath?: string | null;
  rating?: number;
  tagIds?: string[];
  /** 誊清：笺（slip）补全保存后翻转为 manual，离开笺匣（v0.3.3 §8） */
  source?: PromptSource;
}

export interface BatchPromptMutationResult {
  requested: number;
  affected: number;
  skipped: number;
  missingIds: string[];
}

export interface HistoryClearRequest {
  /** 创建时间上界（不含），ms epoch */
  before?: number;
  /** 要清理的历史状态；不传或空数组表示不按状态限制 */
  statuses?: HistoryStatus[];
  /** 是否同时删除 Musefold 管理的输出目录内的图片文件 */
  deleteFiles?: boolean;
}

export interface HistoryClearResult {
  ok: true;
  deleted: number;
  runsDeleted?: number;
  filesDeleted?: number;
  filesMissing?: number;
  fileErrors?: Array<{ id: string; path: string; message: string }>;
}

export interface RelatedHistoryQuery {
  promptId: string;
  status?: HistoryStatus;
  limit?: number;
  offset?: number;
}

export interface RelatedHistoryResult {
  items: HistoryRecord[];
  total: number;
}

export interface HistoryLinkPromptRequest {
  promptId: string;
  historyIds: string[];
}

export interface HistoryLinkPromptResult {
  linked: number;
  alreadyLinked: number;
  conflicts: string[];
  missing: string[];
}

export interface HistoryDeleteRequest {
  id: string;
  deleteFile?: boolean;
}

export interface HistoryDeleteResult {
  ok: true;
  deleted: number;
  imagePath?: string | null;
  runDeleted?: boolean;
  assetsMarked?: number;
  fileDeleted?: boolean;
  fileMissing?: boolean;
  fileError?: string;
}

export interface DiskUsageResult {
  imagesBytes: number;
  imagesCount: number;
  dir: string;
}

export interface BackupInfo {
  file: string;
  path: string;
  size: number;
  createdAt: number;
  kind: "auto" | "manual";
}

export interface RestoreBackupRequest {
  file: string;
}

export interface RestoreBackupResult {
  ok: true;
  needsRestart: true;
  safetyBackupPath: string;
}

export interface ResetDataRequest {
  confirm: "RESET";
}

/** Fixed packaged resources exposed by the About page; never accepts renderer paths. */
export type AboutResourceId = "product-docs";

export interface ResetDataResult {
  ok: true;
  backupPath: string;
}

/**
 * 侧栏计数徽标数据（docs/product/10 TASK-LIB-03/06）。
 * 渲染进程不能用 prompts.length 现算：list() 有 LIMIT 且被筛选收敛过。
 */
export interface PromptStats {
  /** 未删除总数 */
  total: number;
  /** 未归档（folder_id IS NULL）条数 */
  unfiled: number;
  /** 回收站条数 */
  trashed: number;
  /** 收藏条数 */
  pinned: number;
  /** folderId → 条数（仅有值的 key） */
  byFolder: Record<string, number>;
  /** tagId → 条数（仅有值的 key） */
  byTag: Record<string, number>;
}

// ---------- 导出 / 导入（docs/product/16 §4.7）----------

/**
 * `db-only` → 单个 JSON；`db-with-images` → zip（JSON + 被引用的预览图）。
 * 两种模式都**不含** data.db、API Key（明文或密文）、logs/。
 */
export type ExportMode = "db-only" | "db-with-images";

export interface ExportRequest {
  /** 缺省 db-only */
  mode?: ExportMode;
  /** 缺省 false —— 历史含提示词快照与成本，属隐私 */
  includeHistory?: boolean;
  /** 缺省 false —— 回收站内容不跟着备份 */
  includeDeleted?: boolean;
  /** 直接指定落盘路径（测试用）；不传则弹保存对话框 */
  targetPath?: string;
  /**
   * true 时只统计不落盘，也**不弹文件对话框** —— 供导出对话框展示
   * 「预计包含 312 提示词 · 48 标签…」。与真正导出共用同一段聚合代码，
   * 所以预览数字和实际产物不会对不上。
   */
  dryRun?: boolean;
}

export interface ExportCounts {
  prompts: number;
  folders: number;
  tags: number;
  smartSets: number;
  providers: number;
  history?: number;
}

/**
 * 导出信封。顶层元数据先行，让导入端在解析 data 之前就能判断"这文件我认不认"。
 *
 * providers 段刻意只有连接信息：既无 apiKey，也无 hasKey/keySuffix ——
 * 后者会暗示"这个站配过密钥、末四位是 xxxx"，是白送的信息面。
 */
export interface ExportEnvelope {
  format: "musefold-export";
  schemaVersion: number;
  /** 导出时的 PRAGMA user_version，供导入端做迁移判断 */
  dbUserVersion: number;
  appVersion: string;
  exportedAt: number;
  mode: ExportMode;
  counts: ExportCounts;
  data: {
    prompts: unknown[];
    folders: unknown[];
    tags: unknown[];
    smartSets: unknown[];
    providers: unknown[];
    history?: unknown[];
  };
}

export interface ExportResult {
  /** dryRun 时为空串（没有落盘） */
  path: string;
  counts: ExportCounts;
  /** 自由文本里被 redact 命中的字段数（用户把密钥粘进正文时非 0） */
  redactedFields: number;
  /** zip 模式下实际打包的图片数；dryRun 时为待打包的候选数 */
  images?: number;
  dryRun: boolean;
}

/**
 * 冲突策略（docs/product/16 TASK-SET-02）：
 * - `merge`：按 id 比对 `updatedAt`，导入方更新则覆盖，否则保留本地（缺省）
 * - `replace`：清空同类表后全量插入 —— 破坏性，**强制**先备份
 * - `skip`：只插本地不存在的 id，已存在一律跳过
 */
export type ImportStrategy = "merge" | "replace" | "skip";

export interface ImportRequest {
  /** 直接指定源文件（测试用，或预览后确认时回传）；不传则弹打开对话框 */
  sourcePath?: string;
  strategy?: ImportStrategy;
  /** true 时在事务内跑完再整体回滚，用于导入前预览真实计数 */
  dryRun?: boolean;
  /**
   * 导入前自动备份。缺省 true。
   * 注意 `replace` **无视此项一律备份**（doc 16 TASK-SET-02 验收标准）。
   */
  autoBackup?: boolean;
}

/** 信封头部信息，供导入对话框展示导出来源版本与时间 */
export interface ImportSourceInfo {
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  mode: ExportMode;
  /** 文件自称包含的条数（未经本机校验，仅供展示） */
  counts: ExportCounts;
}

/** 单类型的导入结果 */
export interface ImportTypeStat {
  /** 新插入 */
  imported: number;
  /** 覆盖已有（仅 merge 且导入方更新时） */
  updated: number;
  /** 已存在且未覆盖 */
  skipped: number;
  /** 数据非法或依赖缺失被拒 */
  failed: number;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  /** 逐类统计；key 为表名 */
  byType: Record<string, ImportTypeStat>;
  /** 实际导入的文件路径。预览后确认时回传它，避免二次弹框选文件 */
  sourcePath: string;
  /** 文件头部信息，供对话框展示 */
  source: ImportSourceInfo;
  /** 自动创建的备份路径（replace 必有；merge/skip 视 autoBackup） */
  backupPath?: string;
  /** 非致命问题（悬空引用、需重填密钥等），已脱敏 */
  warnings: string[];
  dryRun: boolean;
}

// ---------- 分享 / deeplink（docs/product/15 TASK-DIF-05）----------

export interface ShareRenderCardRequest {
  promptId?: string;
  payload?: SharePayload;
  /** 测试或高级入口可直接指定 PNG 落盘位置；不传则写到 userData/shares。 */
  savePath?: string;
}

export interface ShareRenderCardResult {
  pngPath: string;
  deeplink: string;
}

export interface ShareBuildDeeplinkRequest {
  payload: SharePayload;
}

export interface ShareBuildDeeplinkResult {
  deeplink: string;
}

export interface ShareParseDeeplinkRequest {
  url: string;
}

export interface ShareParseDeeplinkResult {
  payload: SharePayload;
}

export interface ShareImportRequest {
  payload: SharePayload;
}

export interface ShareImportResult {
  prompt: Prompt;
}

// ---------- IPC 错误 ----------
export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

// ---------- preload 暴露的 API 形态（window.api） ----------
/** 控制面状态（设置页「自动化」面板；token 仅在本机 UI 展示，用于接入配置） */
export interface AutomationStatus {
  enabled: boolean;
  running: boolean;
  port: number | null;
  token: string | null;
  apiVersion: "v1";
  discoveryPath: string | null;
}

/** 端点级请求日志条目（NDJSON 骨架，内部诊断用） */
export interface AutomationAuditEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string;
}

/** 花钱动作审计（SEC-01 完整落库；Q5：提示词全文仅本机，列表 UI 截断展示） */
export interface AutomationSpendAudit {
  id: number;
  at: number;
  action: "generate_image" | "run_scheme" | "run_github_skill";
  promptText: string | null;
  approvedVia:
    | "budget"
    | "confirmation"
    | "consent"
    | "idempotent-replay"
    | "denied"
    | "timeout";
  status: "success" | "failed" | "cancelled" | "denied" | "timeout";
  estimatedPoints: number | null;
  actualPoints: number | null;
  jobId: string | null;
}

/** 花钱动作确认卡（策略闸门分支 c，V04-ARCHITECTURE §5.4） */
export interface AutomationConfirmationSummary {
  confirmationId: string;
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  promptPreview: string;
}

/** 自动化预算（Q1 拍板：默认 0，一切花钱须确认） */
export interface AutomationBudget {
  monthlyLimitPoints: number;
  usedPoints: number;
  month: string;
}

export interface AutomationProviderDraft {
  name?: string;
  type?: import("./enums").ProviderType;
  baseUrl?: string;
  model?: string;
}

/** 主进程通知渲染层打开原生安全配置表单；永不包含密钥或账号凭据。 */
export interface AutomationSetupRequest {
  requestId: string;
  kind: "account" | "provider";
  mode?: "login" | "register";
  draft?: AutomationProviderDraft;
}

/** 客户端接入信息（设置 → 自动化 → 接入向导；私下分发零依赖方案） */
export interface IntegrationInfo {
  /** 内置 MCP/CLI 产物是否就位（开发态需先 node scripts/build-cli.mjs） */
  bundledReady: boolean;
  /** MCP 服务器启动规格（配置里不含任何密钥，发现链自读 automation.json） */
  launch: { command: string; args: string[]; env: Record<string, string> };
  snippets: {
    cursorJson: string;
    cursorDeeplink: string;
    claudeCommand: string;
    codexToml: string;
    /** 公开 Skill 地址，用户可直接粘贴给能够读取网页的 Agent。 */
    skillUrl: string;
    /** 兼容旧版地安装动作的 Skill 正文；设置页不再直接展示。 */
    skillMarkdown: string;
  };
  skills: {
    targets: Record<"claude" | "codex" | "cursor", string>;
    installed: Record<"claude" | "codex" | "cursor", boolean>;
    installedVersions: Record<"claude" | "codex" | "cursor", string | null>;
    bundledVersion: string;
    availableVersion: string;
    updateAvailable: boolean;
    checkedAt: string | null;
    checkError: string | null;
    autoUpdate: boolean;
  };
  clients: {
    cursor: { configPath: string; registered: boolean };
    claudeCode: { cliDetected: boolean; registered: boolean };
    codex: { configPath: string; configExists: boolean; registered: boolean };
  };
  cli: {
    installed: boolean;
    upToDate: boolean;
    /** shim 所在目录是否出现在当前进程或 Windows 用户 PATH 中。 */
    onPath: boolean;
    path: string | null;
    installDirs: string[];
  };
}

export type IntegrationAction =
  | "install-cli"
  | "uninstall-cli"
  | "open-skill-url"
  | "open-cursor-deeplink"
  | "register-claude-code"
  | "check-skill-update"
  | "enable-skill-auto-update"
  | "disable-skill-auto-update"
  | "install-skill-claude"
  | "install-skill-codex"
  | "install-skill-cursor"
  | "install-skill-all";

export interface IntegrationActionResult {
  ok: boolean;
  message: string;
}

export interface Api {
  prompt: {
    list: (q?: ListPromptsQuery) => Promise<Prompt[]>;
    get: (id: string) => Promise<Prompt | null>;
    create: (p: NewPrompt) => Promise<Prompt>;
    update: (id: string, patch: UpdatePromptPatch) => Promise<Prompt>;
    delete: (id: string) => Promise<{ ok: true }>;
    batchAddTags: (
      ids: string[],
      tagIds: string[],
    ) => Promise<BatchPromptMutationResult>;
    batchMove: (
      ids: string[],
      folderId: string | null,
    ) => Promise<BatchPromptMutationResult>;
    batchSetPin: (
      ids: string[],
      pinned: boolean,
    ) => Promise<BatchPromptMutationResult>;
    batchDelete: (ids: string[]) => Promise<BatchPromptMutationResult>;
    togglePin: (id: string, pinned: boolean) => Promise<Prompt>;
    reorderPins: (ids: string[]) => Promise<{ ok: true }>;
    incrementUsage: (id: string) => Promise<{ ok: true }>;
    /** 回收站：已软删除条目 */
    listDeleted: () => Promise<Prompt[]>;
    /** 回收站：恢复 */
    restore: (id: string) => Promise<Prompt>;
    /** 回收站：彻底删除（不可恢复） */
    purge: (id: string) => Promise<{ ok: true }>;
    /** 回收站：清空，返回清理条数 */
    purgeAll: () => Promise<{ purged: number }>;
    /** 侧栏计数（文件夹/标签/回收站徽标） */
    stats: () => Promise<PromptStats>;
  };
  smartSet: {
    list: () => Promise<SmartSet[]>;
    create: (s: NewSmartSet) => Promise<SmartSet>;
    update: (id: string, patch: UpdateSmartSetPatch) => Promise<SmartSet>;
    delete: (id: string) => Promise<{ ok: true }>;
  };
  searchHistory: {
    list: (limit?: number) => Promise<SearchHistoryItem[]>;
    add: (term: string) => Promise<{ ok: true }>;
    clear: () => Promise<{ ok: true }>;
  };
  folder: {
    list: (parentId?: string) => Promise<Folder[]>;
    create: (f: NewFolder) => Promise<Folder>;
    update: (id: string, patch: Partial<Folder>) => Promise<Folder>;
    delete: (id: string) => Promise<{ ok: true }>;
    reorder: (ids: string[]) => Promise<{ ok: true }>;
  };
  tag: {
    list: (group?: Tag["tagGroup"]) => Promise<Tag[]>;
    create: (t: NewTag) => Promise<Tag>;
    update: (id: string, patch: Partial<Tag>) => Promise<Tag>;
    delete: (id: string) => Promise<{ ok: true }>;
    assignToPrompt: (
      promptId: string,
      tagIds: string[],
    ) => Promise<{ ok: true }>;
  };
  skillRuntime: SkillRuntimeApi;
  designScheme: DesignSchemeApi;
  aiConnection: {
    listPresets: () => Promise<AiConnectionPreset[]>;
    list: () => Promise<AiConnectionProfile[]>;
    create: (input: CreateAiConnectionInput) => Promise<AiConnectionProfile>;
    update: (
      id: string,
      patch: UpdateAiConnectionInput,
    ) => Promise<AiConnectionProfile>;
    delete: (id: string) => Promise<{ ok: true }>;
    saveKey: (id: string, apiKey: string) => Promise<AiConnectionProfile>;
    deleteKey: (id: string) => Promise<AiConnectionProfile>;
    hasKey: (id: string) => Promise<{ hasKey: boolean; suffix: string | null }>;
    setActive: (id: string) => Promise<AiConnectionProfile>;
    listModels: (id: string) => Promise<AiTextModelInfo[]>;
    validate: (id: string) => Promise<AiConnectionValidationResult>;
  };
  provider: {
    list: () => Promise<ProviderConfig[]>;
    create: (p: NewProviderConfig) => Promise<ProviderConfig>;
    update: (
      id: string,
      patch: Partial<NewProviderConfig>,
    ) => Promise<ProviderConfig>;
    delete: (id: string) => Promise<{ ok: true }>;
    saveKey: (id: string, apiKey: string) => Promise<{ ok: true }>;
    hasKey: (id: string) => Promise<{ hasKey: boolean; suffix: string | null }>;
    openWebLogin: () => Promise<{ opened: true }>;
    webLoginStart: () => Promise<import("./providers").DoubaoWebAccountStatus>;
    webLoginRefresh: () => Promise<
      import("./providers").DoubaoWebAccountStatus
    >;
    webLogout: () => Promise<import("./providers").DoubaoWebAccountStatus>;
    webLoginState: () => Promise<import("./providers").DoubaoWebAccountStatus>;
    setWebDeveloperVisible: (visible: boolean) => Promise<{ ok: true }>;
    onWebLoginChanged: (
      cb: (status: import("./providers").DoubaoWebAccountStatus) => void,
    ) => () => void;
    webUsage: () => Promise<import("./providers").DoubaoWebUsageStatus>;
    webStatus: () => Promise<import("./providers").DoubaoWebAccountStatus>;
    validate: (id: string) => Promise<ValidationResult>;
    listModels: (id: string) => Promise<ModelInfo[]>;
    setActive: (id: string) => Promise<{ ok: true }>;
  };
  settings: {
    pricing: {
      get: (providerId: string) => Promise<ProviderPricingConfig | null>;
      set: (
        req: ProviderPricingSetRequest,
      ) => Promise<{ ok: true; pricing: ProviderPricingConfig }>;
      delete: (providerId: string) => Promise<{ ok: true }>;
    };
  };
  image: {
    pickLocal: () => Promise<import("./providers").PickLocalImagesResult>;
    stageLocal: (
      input: import("./providers").StageLocalImageInput,
    ) => Promise<import("./providers").PickLocalImagesResult>;
    generate: (req: GenerateImageRequest) => Promise<GenerateImageResult>;
    cancel: (jobId: string) => Promise<{ ok: true }>;
    /** jobId：渲染进程给这次重试的取消句柄（不传则主进程自生成，此时无法取消） */
    retry: (historyId: string, jobId?: string) => Promise<GenerateImageResult>;
    /** 订阅 Provider 自动重试状态，返回取消订阅函数。 */
    onProgress: (cb: (progress: ImageGenerationProgress) => void) => () => void;
  };
  workbenchSession: {
    ensure: (
      command: EnsureWorkbenchSessionCommand,
    ) => Promise<WorkbenchSession>;
    list: (
      query?: WorkbenchSessionListQuery,
    ) => Promise<WorkbenchSessionListResult>;
    get: (id: string) => Promise<WorkbenchSessionDocument | null>;
    rename: (id: string, title: string) => Promise<WorkbenchSession>;
    archive: (id: string, archived?: boolean) => Promise<WorkbenchSession>;
    delete: (id: string) => Promise<WorkbenchSession>;
  };
  history: {
    list: (q?: {
      status?: HistoryStatus;
      providerId?: string;
      from?: number;
      to?: number;
      limit?: number;
      offset?: number;
    }) => Promise<HistoryRecord[]>;
    related: (q: RelatedHistoryQuery) => Promise<RelatedHistoryResult>;
    linkPrompt: (
      req: HistoryLinkPromptRequest,
    ) => Promise<HistoryLinkPromptResult>;
    get: (id: string) => Promise<HistoryRecord | null>;
    delete: (
      req: string | HistoryDeleteRequest,
    ) => Promise<HistoryDeleteResult>;
    clear: (req?: number | HistoryClearRequest) => Promise<HistoryClearResult>;
    stats: (q: HistoryStatsQuery) => Promise<HistoryStats>;
  };
  share: {
    renderCard: (req: ShareRenderCardRequest) => Promise<ShareRenderCardResult>;
    buildDeeplink: (
      req: ShareBuildDeeplinkRequest,
    ) => Promise<ShareBuildDeeplinkResult>;
    parseDeeplink: (
      req: ShareParseDeeplinkRequest,
    ) => Promise<ShareParseDeeplinkResult>;
    import: (req: ShareImportRequest) => Promise<ShareImportResult>;
    consumePending: () => Promise<{ payloads: SharePayload[] }>;
    /** 订阅 OS deeplink 唤起事件，返回取消订阅函数。 */
    onIncoming: (cb: (payload: SharePayload) => void) => () => void;
  };
  system: {
    getPaths: () => Promise<{
      userData: string;
      pictures: string;
      backups: string;
      logs: string;
    }>;
    getVersion: () => Promise<{ app: string; db: number }>;
    openAboutResource: (resource: AboutResourceId) => Promise<{ ok: true }>;
    openInFolder: (path: string) => Promise<{ ok: true }>;
    /** 另存图片。不传 targetPath 时弹系统保存对话框。 */
    saveImage: (
      sourcePath: string,
      targetPath?: string,
    ) => Promise<{ path: string } | { cancelled: true }>;
    /** 批量另存图片。不传 targetDirectory 时弹系统目录选择框。 */
    saveImages: (
      sourcePaths: string[],
      targetDirectory?: string,
    ) => Promise<{ paths: string[] } | { cancelled: true }>;
    /** 把本地图片以原始像素写入系统剪贴板。 */
    copyImage: (sourcePath: string) => Promise<{ ok: true }>;
    /** 用户主动点击导入动作后，读取当前系统剪贴板中的纯文本。 */
    readClipboardText: () => Promise<string>;
    /** 剪贴板图片（PNG 字节）；无图片时为 null。 */
    readClipboardImage: () => Promise<Uint8Array | null>;
    diskUsage: () => Promise<DiskUsageResult>;
    /** 导出数据。不传 targetPath 时弹保存对话框；用户取消返回 cancelled */
    export: (
      req?: ExportRequest,
    ) => Promise<ExportResult | { cancelled: true }>;
    /** 导入数据。不传 sourcePath 时弹打开对话框；用户取消返回 cancelled */
    import: (
      req?: ImportRequest,
    ) => Promise<ImportResult | { cancelled: true }>;
    listBackups: () => Promise<BackupInfo[]>;
    backupNow: () => Promise<{ path: string }>;
    restoreBackup: (req: RestoreBackupRequest) => Promise<RestoreBackupResult>;
    relaunch: () => Promise<{ ok: true }>;
    resetData: (req: ResetDataRequest) => Promise<ResetDataResult>;
  };
  updater: {
    getState: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    download: () => Promise<UpdateStatus>;
    install: () => Promise<UpdateStatus>;
    /** 订阅更新状态变化，返回取消订阅函数。 */
    onStateChanged: (cb: (status: UpdateStatus) => void) => () => void;
  };
  log: {
    /** 读取日志文件尾部（已脱敏，不含密钥） */
    tail: (maxLines?: number) => Promise<string>;
    /** 在系统文件管理器中打开日志目录 */
    openDir: () => Promise<{ ok: true }>;
  };
  /** 本地控制面（Automation API v1，V04-SET-01/02） */
  automation: {
    status: () => Promise<AutomationStatus>;
    setEnabled: (enabled: boolean) => Promise<AutomationStatus>;
    rotateToken: () => Promise<AutomationStatus>;
    auditList: (limit?: number) => Promise<AutomationSpendAudit[]>;
    /** App 确认卡回执（策略闸门分支 c） */
    confirm: (
      confirmationId: string,
      approved: boolean,
    ) => Promise<{ ok: boolean }>;
    budget: {
      get: () => Promise<AutomationBudget>;
      set: (monthlyLimitPoints: number) => Promise<AutomationBudget>;
    };
    onConfirmationRequired: (
      cb: (summary: AutomationConfirmationSummary) => void,
    ) => () => void;
    onConfirmationResolved: (
      cb: (payload: {
        confirmationId: string;
        outcome: "approved" | "denied" | "timeout";
      }) => void,
    ) => () => void;
    /** 外部任务活动流（朱点忙碌态，SET-02）：jobId + running 快照 */
    onActivity: (
      cb: (payload: { jobId: string; running: boolean }) => void,
    ) => () => void;
    onSetupRequested: (
      cb: (request: AutomationSetupRequest) => void,
    ) => () => void;
    onProviderChanged: (
      cb: (payload: { providerId: string }) => void,
    ) => () => void;
    /** 客户端接入向导（Cursor / ChatGPT 桌面 / Claude Code / CLI） */
    integrationInfo: () => Promise<IntegrationInfo>;
    integrationAction: (
      action: IntegrationAction,
    ) => Promise<IntegrationActionResult>;
  };
  /** v0.5 账号与云通道（V05-ACC-05）；请求/响应永不含密码回显、JWT、refresh、sk- 明文（D12：不暴露给控制面/CLI/MCP） */
  account: {
    status: () => Promise<AccountStatus>;
    /** 注册成功即登录（US-01），返回登录后的完整状态 */
    register: (input: AccountCredentialsInput) => Promise<AccountStatus>;
    login: (input: AccountCredentialsInput) => Promise<AccountStatus>;
    logout: () => Promise<AccountStatus>;
    redeem: (code: string) => Promise<AccountRedeemResult>;
    refreshQuota: () => Promise<AccountStatus>;
    /** 要求未登录态；已登录调用抛 ACCOUNT/MANAGED_READONLY */
    setServerUrl: (url: string) => Promise<AccountStatus>;
    /** 订阅账号状态变化（登录/登出/额度/健康度/公告），返回取消订阅函数 */
    onChanged: (cb: (status: AccountStatus) => void) => () => void;
  };
  cloudSync: {
    status: () => Promise<CloudSyncSummary>;
    setEnabled: (enabled: boolean) => Promise<CloudSyncSummary>;
    syncNow: () => Promise<CloudSyncSummary>;
    conflicts: () => Promise<CloudSyncConflictSummary[]>;
    resolve: (
      conflictId: string,
      resolution: CloudSyncConflictResolution,
    ) => Promise<CloudSyncSummary>;
    onChanged: (cb: (status: CloudSyncSummary) => void) => () => void;
  };
  cloudConnections: {
    list: () => Promise<McpConnectionPage>;
    update: (
      id: string,
      input: UpdateMcpConnection,
    ) => Promise<McpConnectionPage>;
    revoke: (id: string) => Promise<void>;
  };
  diagnostics: {
    /** 订阅 preload、主进程和渲染崩溃产生的异常报告。 */
    onError: (cb: (report: DiagnosticReport) => void) => () => void;
  };
  /** 桌宠（悬浮伴侣）。宠物窗口和主窗口都用这套 API。 */
  pet: {
    /** 开关桌宠，返回开关后的实际状态 */
    setEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
    isEnabled: () => Promise<{ enabled: boolean }>;
    /** 宠物窗口挂载后先拉一帧，避免等到下次状态变化才有画面 */
    getFrame: () => Promise<PetFrame | null>;
    /** 首帧资源解码并提交到 DOM 后通知主进程显示透明窗口。 */
    ready: () => void;
    /** 订阅动画帧推送，返回取消订阅函数 */
    onFrame: (cb: (frame: PetFrame) => void) => () => void;
    /** 上报交互（戳、拖拽、唤醒） */
    interact: (interaction: PetInteraction) => void;
    /** 拖拽时按增量移动宠物窗口；主进程负责屏幕边界钳制 */
    moveBy: (dx: number, dy: number) => void;
    /** 跑到主界面 Composer 右侧；锚点使用主窗口内容区坐标。 */
    runToComposer: (anchor: import("./pet").PetComposerAnchor) => Promise<void>;
    /** 从主界面返回进入前记录的桌面位置。 */
    returnHome: () => Promise<void>;
    /** 右键弹出原生上下文菜单（打开主界面 / 隐藏桌宠 / 退出应用） */
    openMenu: () => void;
  };
  window: {
    minimize: () => void;
    maximizeToggle: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    platform: () => Promise<NodeJS.Platform>;
    /** 订阅最大化状态变化，返回取消订阅函数 */
    onMaximizeChange: (cb: (isMax: boolean) => void) => () => void;
    /** 订阅全屏状态变化，返回取消订阅函数 */
    onFullscreenChange: (cb: (isFs: boolean) => void) => () => void;
  };
}

// window.api 全局类型
declare global {
  interface Window {
    api: Api;
  }
}
