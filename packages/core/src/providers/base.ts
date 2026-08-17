// electron/providers/base.ts
// ImageProvider 抽象基类 —— 详见 docs/05-image-generation.md §2

import type { ImageProvider, GenerateImageRequest, GenerateImageResult, ImageProgressHandler, ModelInfo, ValidationResult } from '@shared/types/providers';
import type { ProviderType } from '@shared/types/enums';
import { loadApiKey } from '../runtime';

export abstract class BaseProvider implements ImageProvider {
  abstract readonly id: string;
  abstract readonly type: ProviderType;
  abstract readonly name: string;
  protected baseUrl: string;
  protected model: string;
  protected providerName: string;

  constructor(baseUrl: string, model: string, providerName: string) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.providerName = providerName;
  }

  protected getApiKey(): string {
    const key = loadApiKey(this.id);
    if (!key) throw new Error(`Provider ${this.providerName} has no API key configured`);
    return key;
  }

  abstract listModels(): Promise<ModelInfo[]>;
  abstract generateImage(req: GenerateImageRequest, signal?: AbortSignal, onProgress?: ImageProgressHandler): Promise<GenerateImageResult>;
  abstract validateConnection(): Promise<ValidationResult>;
}
