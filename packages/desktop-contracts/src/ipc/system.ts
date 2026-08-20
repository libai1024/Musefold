// packages/desktop-contracts/src/ipc/system.ts
// system / updater / log / window 域：请求响应类型 + Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type {
  Channel,
  ContentLayerCheckSnapshot,
  ContentLayerState,
  UpdateChannelInfo,
  UpdateChannelResult,
  UpdateStatus,
} from "../updater";

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

export interface SystemApi {
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
  export: (req?: ExportRequest) => Promise<ExportResult | { cancelled: true }>;
  /** 导入数据。不传 sourcePath 时弹打开对话框；用户取消返回 cancelled */
  import: (req?: ImportRequest) => Promise<ImportResult | { cancelled: true }>;
  listBackups: () => Promise<BackupInfo[]>;
  backupNow: () => Promise<{ path: string }>;
  restoreBackup: (req: RestoreBackupRequest) => Promise<RestoreBackupResult>;
  relaunch: () => Promise<{ ok: true }>;
  resetData: (req: ResetDataRequest) => Promise<ResetDataResult>;
}

export interface UpdaterApi {
  getState: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
  install: () => Promise<UpdateStatus>;
  getChannel: () => Promise<UpdateChannelInfo>;
  setChannel: (channel: Channel) => Promise<UpdateChannelResult>;
  /** 订阅更新状态变化，返回取消订阅函数。 */
  onStateChanged: (cb: (status: UpdateStatus) => void) => () => void;
  /** 内容层启动信标。单向，无返回值。 */
  notifyContentReady: () => void;
  /** 内容层窄状态（版本 / 来源 / 脱敏检查结果）。 */
  getContentState: () => Promise<ContentLayerState>;
  /** 手动触发一次内容层检查，返回与 lastCheck 同构的脱敏快照。 */
  checkContentNow: () => Promise<ContentLayerCheckSnapshot>;
}

export interface LogApi {
  /** 读取日志文件尾部（已脱敏，不含密钥） */
  tail: (maxLines?: number) => Promise<string>;
  /** 在系统文件管理器中打开日志目录 */
  openDir: () => Promise<{ ok: true }>;
}

export interface WindowApi {
  minimize: () => void;
  maximizeToggle: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  platform: () => Promise<NodeJS.Platform>;
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onMaximizeChange: (cb: (isMax: boolean) => void) => () => void;
  /** 订阅全屏状态变化，返回取消订阅函数 */
  onFullscreenChange: (cb: (isFs: boolean) => void) => () => void;
}
