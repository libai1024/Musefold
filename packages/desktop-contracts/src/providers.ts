// shared/types/providers.ts
// 生图 Provider 抽象 —— 主进程实现，渲染进程通过 IPC 调用

import type {
  ProviderType,
  ImageSize,
  ImageQuality,
  ImageBackground,
  ModerationLevel,
} from './enums';
import type {
  CostUnit,
  PromptReference,
  SkillRuntimeSnapshot,
} from './generation-snapshots';

export type { PromptReference, PromptReferenceScope } from './generation-snapshots';

export interface WorkbenchRunContext {
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  turnIndex: number;
  resultIndex: number;
  userPrompt: string;
}

/** 模型信息 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  maxSize?: string;
}

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';
export const MAX_REFERENCE_IMAGES = 16;

/** 主进程校验后的本地参考图。path 只允许来自系统选择或已知历史资源。 */
export interface LocalImageReference {
  path: string;
  source: 'upload' | 'history';
  /** 多图 Provider 的单张资源 id；同一 history 下选择第 2 张及后续图片时用于精确授权。 */
  assetId?: string;
  name?: string;
  mimeType?: SupportedImageMimeType;
  sizeBytes?: number;
  historyId?: string;
}

export type PickLocalImagesResult =
  | { ok: true; images: LocalImageReference[] }
  | { ok: false; error: { code: string; message: string } };

/** 从剪贴板或拖拽区域暂存到应用受管目录的图片。 */
export interface StageLocalImageInput {
  bytes: Uint8Array;
  name?: string;
  mimeType?: string;
}

/** 生图请求 */
export interface GenerateImageRequest {
  providerId: string;
  /** 渲染进程生成的任务 id —— 用作取消句柄（image.cancel(jobId)），
   *  也是本地图片文件名/历史 id。不传则主进程自动生成。 */
  jobId?: string;
  model?: string; // 覆盖 Provider 默认
  prompt: string;
  negative?: string;
  size: ImageSize;
  /** 输出比例（如 "1:1" / "16:9"）——异步创作台类 Provider（悟空生图组）用它，
   *  OpenAI 兼容 Provider 忽略此字段、只用 size。 */
  aspectRatio?: string;
  quality: ImageQuality;
  n: number;
  background?: ImageBackground;
  moderation?: ModerationLevel;
  /** v0.3 有序参考图；数组顺序对应 multipart image[] 与提示词中的图 1、图 2。 */
  referenceImages?: LocalImageReference[];
  promptId?: string; // 来源提示词（写历史用）
  /** 历史回填或继续生成时的父级历史记录。 */
  parentHistoryId?: string;
  /** 基于某个已生成资源继续微调时的来源 Asset。 */
  sourceAssetId?: string;
  /** 本次微调的用户说明；主进程写入 GenerationRun 快照。 */
  refinementInstruction?: string;
  /** 提示词引用快照；主进程会随 history 在同一事务中持久化。 */
  promptReferences?: PromptReference[];
  /** v0.2.2 对话归组快照；首个请求落地时创建会话。 */
  workbench?: WorkbenchRunContext;
  /** Skill Agent 执行快照；属于对话消息，不属于 Composer 附件。 */
  skillRuntime?: SkillRuntimeSnapshot;
}

/** 单张已落盘的生图产物。imagePath 是应用可直接读取的本地路径。 */
export interface GeneratedImageOutput {
  imagePath: string;
  /** v0.2.1 资源账本 id；Provider 返回前可省略，由 GenerationService 统一分配。 */
  assetId?: string;
  actualSize?: { width: number; height: number };
}

/** 豆包网页一次回复的附带信息。图片和文字属于同一个网页回复。 */
export interface DoubaoWebResponseSummary {
  kind: 'doubao-web';
  message?: string;
  expectedImageCount: number;
  receivedImageCount: number;
}

export type ImageProviderResponseSummary = DoubaoWebResponseSummary;

/** 生图结果 */
export interface GenerateImageResult {
  historyId: string;
  status: 'success' | 'failed' | 'cancelled';
  /** 首张图片的兼容路径。多图 Provider 同时返回 images。 */
  imagePath?: string;
  images?: GeneratedImageOutput[];
  providerResponse?: ImageProviderResponseSummary;
  error?: { code: string; message: string };
  /** 实际成本（积分）。 */
  cost?: number;
  /** 成本单位，固定为 point。 */
  costUnit?: CostUnit;
  /** 实际成本（积分）；与 cost 同义，供自动化契约使用。 */
  costPoints?: number;
  durationMs?: number;
  actualSize?: { width: number; height: number };
  sizeMismatch?: { expected: ImageSize; actual: string };
}

/** 主进程在 Provider 自动重试前发给当前创作台的进度。 */
export interface ImageGenerationProgress {
  jobId: string;
  phase: 'retrying';
  attempt: number;
  maxRetries: number;
  delayMs: number;
  status?: number;
}

export type ImageProgressHandler = (progress: Omit<ImageGenerationProgress, 'jobId'>) => void;

/** 连接验证结果 */
export interface ValidationResult {
  ok: boolean;
  message: string;
  /** 归一化错误码（失败时），供 UI 错误分类引导（TASK-GEN-03） */
  code?: string;
  models?: ModelInfo[];
}

/** 豆包网页桥接的本地自然日用量。 */
export interface DoubaoWebUsageStatus {
  date: string;
  limit: number;
  used: number;
  remaining: number;
}

/** 豆包专用浏览器分区中的只读账号状态。 */
export interface DoubaoWebAccountStatus {
  loggedIn: boolean;
  accountName: string | null;
  avatarDataUrl: string | null;
  verificationRequired: boolean;
  usage: DoubaoWebUsageStatus;
  loginState?: 'logged-out' | 'loading' | 'qr-ready' | 'scanned' | 'logged-in' | 'verification-required' | 'error';
  qrCodeDataUrl?: string | null;
  qrExpiresAt?: number | null;
  errorMessage?: string | null;
}

/** ImageProvider 抽象接口 —— 主进程侧实现 */
export interface ImageProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;
  listModels(): Promise<ModelInfo[]>;
  /** signal：来自主进程的取消信号；Provider 应把它并入自身的超时控制。 */
  generateImage(req: GenerateImageRequest, signal?: AbortSignal, onProgress?: ImageProgressHandler): Promise<GenerateImageResult>;
  validateConnection(): Promise<ValidationResult>;
}

/** Provider 成本估算配置（electron-store: pricing.{providerId}） */
export type ProviderPricingMode = 'per-image' | 'per-1k-token';

export interface ProviderPricingConfig {
  mode: ProviderPricingMode;
  /**
   * 单位价格（积分）。per-image=每张；per-1k-token=每千 token。
   */
  unitPoints: number;
}

export interface ProviderPricingSetRequest extends ProviderPricingConfig {
  providerId: string;
}

/**
 * Provider 配置（providers 表，不含明文 key）。
 * V13-ENT-04：从 models 迁出，渲染层可安全引用；SQLite 行与 IPC 形状相同，无需二次映射。
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keySuffix: string | null;
  isActive: boolean;
  managedBy: 'account' | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewProviderConfig {
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  isActive?: boolean;
}
