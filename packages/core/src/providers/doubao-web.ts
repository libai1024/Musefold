import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProvider,
  ModelInfo,
  ValidationResult,
} from '@musefold/desktop-contracts/providers';
import { getDoubaoWebRuntime } from '../runtime';
import { sanitizeProviderErrorMessage } from './sanitize-error';

const DOUBAO_IMAGE_MODELS: ModelInfo[] = [
  {
    id: 'seedream-4.5',
    name: 'Seedream 4.5',
    description: '豆包网页版当前生图入口',
  },
];

export class DoubaoWebProvider implements ImageProvider {
  readonly type = 'doubao-web' as const;

  constructor(
    readonly id: string,
    _baseUrl: string,
    private readonly model: string,
    readonly name: string,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const selected = this.model.trim();
    if (!selected || DOUBAO_IMAGE_MODELS.some((model) => model.id === selected)) {
      return DOUBAO_IMAGE_MODELS;
    }
    return [{ id: selected, name: selected, description: '当前配置模型' }, ...DOUBAO_IMAGE_MODELS];
  }

  async validateConnection(): Promise<ValidationResult> {
    try {
      return await getDoubaoWebRuntime().validate();
    } catch (error) {
      // 网页桥接的错误可能带签名 URL / 页面路径，跨出 core 前先脱敏。
      return {
        ok: false,
        code: (error as { code?: string }).code ?? 'UNKNOWN',
        message: sanitizeProviderErrorMessage(
          error instanceof Error ? error.message : '',
          '豆包网页连接失败',
        ),
      };
    }
  }

  async generateImage(
    req: GenerateImageRequest,
    signal?: AbortSignal,
  ): Promise<GenerateImageResult> {
    // Core has already composed the canonical ratio constraint into the prompt and
    // persisted aspectRatio in the ledger snapshot. The frozen web runtime also
    // appends aspectRatio as text, so omit only the provider-facing duplicate.
    const { aspectRatio: _ledgerAspectRatio, ...providerRequest } = req;
    const result = await getDoubaoWebRuntime().generateImage(
      { ...providerRequest, model: req.model ?? this.model },
      signal,
    );
    // 冻结面 runtime 产生的失败文案（可能包含签名图片 URL 等页面细节）在 Provider
    // 边界收敛为用户安全文本；GenerationService 还会再兜底一次（幂等）。
    if (result.status !== 'success' && result.error?.message) {
      return {
        ...result,
        error: { ...result.error, message: sanitizeProviderErrorMessage(result.error.message) },
      };
    }
    return result;
  }
}
