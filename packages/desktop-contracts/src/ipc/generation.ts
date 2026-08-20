// packages/desktop-contracts/src/ipc/generation.ts
// aiConnection / provider / settings(pricing) / image 域：Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type {
  ProviderConfig,
  NewProviderConfig,
  ProviderPricingConfig,
  ProviderPricingSetRequest,
} from "../models";
import type {
  DoubaoWebAccountStatus,
  DoubaoWebUsageStatus,
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  ModelInfo,
  PickLocalImagesResult,
  StageLocalImageInput,
  ValidationResult,
} from "../providers";
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionValidationResult,
  AiTextModelInfo,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from "../ai";

export interface AiConnectionApi {
  listPresets: () => Promise<AiConnectionPreset[]>;
  list: () => Promise<AiConnectionProfile[]>;
  create: (input: CreateAiConnectionInput) => Promise<AiConnectionProfile>;
  update: (id: string, patch: UpdateAiConnectionInput) => Promise<AiConnectionProfile>;
  delete: (id: string) => Promise<{ ok: true }>;
  saveKey: (id: string, apiKey: string) => Promise<AiConnectionProfile>;
  deleteKey: (id: string) => Promise<AiConnectionProfile>;
  hasKey: (id: string) => Promise<{ hasKey: boolean; suffix: string | null }>;
  setActive: (id: string) => Promise<AiConnectionProfile>;
  listModels: (id: string) => Promise<AiTextModelInfo[]>;
  validate: (id: string) => Promise<AiConnectionValidationResult>;
}

export interface ProviderApi {
  list: () => Promise<ProviderConfig[]>;
  create: (p: NewProviderConfig) => Promise<ProviderConfig>;
  update: (id: string, patch: Partial<NewProviderConfig>) => Promise<ProviderConfig>;
  delete: (id: string) => Promise<{ ok: true }>;
  saveKey: (id: string, apiKey: string) => Promise<{ ok: true }>;
  hasKey: (id: string) => Promise<{ hasKey: boolean; suffix: string | null }>;
  openWebLogin: () => Promise<{ opened: true }>;
  webLoginStart: () => Promise<DoubaoWebAccountStatus>;
  webLoginRefresh: () => Promise<DoubaoWebAccountStatus>;
  webLogout: () => Promise<DoubaoWebAccountStatus>;
  webLoginState: () => Promise<DoubaoWebAccountStatus>;
  setWebDeveloperVisible: (visible: boolean) => Promise<{ ok: true }>;
  onWebLoginChanged: (cb: (status: DoubaoWebAccountStatus) => void) => () => void;
  webUsage: () => Promise<DoubaoWebUsageStatus>;
  webStatus: () => Promise<DoubaoWebAccountStatus>;
  validate: (id: string) => Promise<ValidationResult>;
  listModels: (id: string) => Promise<ModelInfo[]>;
  setActive: (id: string) => Promise<{ ok: true }>;
}

export interface SettingsApi {
  pricing: {
    get: (providerId: string) => Promise<ProviderPricingConfig | null>;
    set: (req: ProviderPricingSetRequest) => Promise<{ ok: true; pricing: ProviderPricingConfig }>;
    delete: (providerId: string) => Promise<{ ok: true }>;
  };
}

export interface ImageApi {
  pickLocal: () => Promise<PickLocalImagesResult>;
  stageLocal: (input: StageLocalImageInput) => Promise<PickLocalImagesResult>;
  generate: (req: GenerateImageRequest) => Promise<GenerateImageResult>;
  cancel: (jobId: string) => Promise<{ ok: true }>;
  /** jobId：渲染进程给这次重试的取消句柄（不传则主进程自生成，此时无法取消） */
  retry: (historyId: string, jobId?: string) => Promise<GenerateImageResult>;
  /** 订阅 Provider 自动重试状态，返回取消订阅函数。 */
  onProgress: (cb: (progress: ImageGenerationProgress) => void) => () => void;
}
