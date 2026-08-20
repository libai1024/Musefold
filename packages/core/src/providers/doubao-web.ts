import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProvider,
  ModelInfo,
  ValidationResult,
} from '@musefold/desktop-contracts/providers';
import { getDoubaoWebRuntime } from '../runtime';

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
    return [
      { id: selected, name: selected, description: '当前配置模型' },
      ...DOUBAO_IMAGE_MODELS,
    ];
  }

  async validateConnection(): Promise<ValidationResult> {
    try {
      return await getDoubaoWebRuntime().validate();
    } catch (error) {
      return {
        ok: false,
        code: (error as { code?: string }).code ?? 'UNKNOWN',
        message: error instanceof Error ? error.message : '豆包网页连接失败',
      };
    }
  }

  generateImage(req: GenerateImageRequest, signal?: AbortSignal): Promise<GenerateImageResult> {
    return getDoubaoWebRuntime().generateImage(
      { ...req, model: req.model ?? this.model },
      signal,
    );
  }
}
