import {
  cloudGenerationRequestSchema,
  newPromptDocumentSchema,
  type CloudGenerationRequest,
  type GenerationQuality,
  type GenerationSize,
  type NewPromptDocument,
  type PromptDocument,
} from '@musefold/contracts';

export interface PromptDraftInput {
  title: string;
  description?: string | null;
  content: string;
  negative?: string | null;
  folderId?: string | null;
  tagIds?: string[];
  modelId?: string | null;
  params?: Record<string, unknown> | null;
  isPinned?: boolean;
}

export function normalizePromptDraft(input: PromptDraftInput): NewPromptDocument {
  const tagIds = [...new Set((input.tagIds ?? []).map((tagId) => tagId.trim()).filter(Boolean))];

  return newPromptDocumentSchema.parse({
    title: input.title.trim().replace(/\s+/g, ' '),
    description: input.description?.trim() || null,
    content: input.content.trim(),
    negative: input.negative?.trim() || null,
    folderId: input.folderId ?? null,
    tagIds,
    modelId: input.modelId ?? null,
    params: input.params ?? null,
    isPinned: input.isPinned ?? false,
    rating: 0,
    source: 'manual',
    sourceUrl: null,
  });
}

export interface ApplyPromptOptions {
  size?: GenerationSize;
  aspectRatio?: string;
  quality?: GenerationQuality;
}

export function applyPromptToGeneration(
  prompt: PromptDocument,
  options: ApplyPromptOptions = {},
): CloudGenerationRequest {
  return cloudGenerationRequestSchema.parse({
    prompt: prompt.content,
    negative: prompt.negative ?? undefined,
    promptId: prompt.id,
    size: options.size ?? 'auto',
    aspectRatio: options.aspectRatio,
    quality: options.quality ?? 'auto',
    count: 1,
  });
}

export interface ComposerGenerationRequestInput {
  prompt: string;
  promptId?: string | null;
  size: GenerationSize;
  aspectRatio: string;
  quality: GenerationQuality;
}

/** 工作台 composer 字段装配为云端生图请求。product-ui 不直接依赖 contracts schema。 */
export function composerToGenerationRequest(
  input: ComposerGenerationRequestInput,
): CloudGenerationRequest {
  return cloudGenerationRequestSchema.parse({
    prompt: input.prompt,
    promptId: input.promptId ?? undefined,
    size: input.size,
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    count: 1,
  });
}

export function titleFromPromptContent(
  content: string,
  fallback = '生成提示词',
): string {
  const compact = content.trim().replace(/\s+/g, ' ');
  return Array.from(compact).slice(0, 40).join('') || fallback;
}

export function generationRequestToPromptDraft(
  request: CloudGenerationRequest,
): NewPromptDocument {
  const parsed = cloudGenerationRequestSchema.parse(request);
  return newPromptDocumentSchema.parse({
    title: titleFromPromptContent(parsed.prompt),
    description: null,
    content: parsed.prompt,
    negative: parsed.negative ?? null,
    folderId: null,
    tagIds: [],
    modelId: null,
    params: {
      size: parsed.size,
      quality: parsed.quality,
      count: parsed.count,
      ...(parsed.aspectRatio ? { aspectRatio: parsed.aspectRatio } : {}),
    },
    rating: 0,
    isPinned: false,
    source: 'generation',
    sourceUrl: null,
  });
}
