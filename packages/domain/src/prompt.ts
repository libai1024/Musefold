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
  tags?: string[];
  modelId?: string | null;
  params?: Record<string, unknown> | null;
  isPinned?: boolean;
}

export function normalizePromptDraft(input: PromptDraftInput): NewPromptDocument {
  const seenTags = new Set<string>();
  const tags = (input.tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLocaleLowerCase();
      if (seenTags.has(key)) return false;
      seenTags.add(key);
      return true;
    });

  return newPromptDocumentSchema.parse({
    title: input.title.trim().replace(/\s+/g, ' '),
    description: input.description?.trim() || null,
    content: input.content.trim(),
    negative: input.negative?.trim() || null,
    folderId: input.folderId ?? null,
    tags,
    modelId: input.modelId ?? null,
    params: input.params ?? null,
    isPinned: input.isPinned ?? false,
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
