import { z } from 'zod';
import { apiErrorCodeSchema, entityIdSchema, isoDateTimeSchema } from './common';
import { promptDocumentSchema } from './prompt';

export const generationSizeSchema = z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']);

export const generationQualitySchema = z.enum(['low', 'medium', 'high', 'auto']);

/** 单次生图写意图的幂等键;沿用云 API Idempotency-Key 可见 ASCII 线协议。 */
export const generationIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x20-\x7e]+$/);

/** 图片宽高比:两边均为 1–99 的整数,且几何比值限制在 1:4–4:1。解析输出会约分为稳定的逻辑比例 id。 */
export const generationAspectRatioSchema = z
  .string()
  .regex(/^[1-9]\d?:[1-9]\d?$/)
  .refine((value) => {
    const [width, height] = value.split(':').map(Number);
    const ratio = width / height;
    return ratio >= 1 / 4 && ratio <= 4;
  }, 'Aspect ratio must be between 1:4 and 4:1')
  .transform((value) => {
    const [width, height] = value.split(':').map(Number);
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
  });

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/**
 * Persisted/provider/history compatibility: old rows used only /^\d{1,2}:\d{1,2}$/.
 * Keep this broad schema for reading and replaying old requests; new client creates use
 * generationAspectRatioSchema below instead.
 */
export const persistedGenerationAspectRatioSchema = z.string().regex(/^\d{1,2}:\d{1,2}$/);

/** Backward-compatible alias for callers that need to identify the stored ratio grammar. */
export const legacyGenerationAspectRatioSchema = persistedGenerationAspectRatioSchema;

/** 客户端最多可以选择六条提示词引用;选择意图不包含任何客户端文本。 */
export const MAX_PROMPT_REFERENCE_SELECTIONS = 6;

/**
 * 片段坐标使用 JavaScript 字符串的 UTF-16 code unit 语义,而不是 Unicode code point。
 * start 包含、end 不包含;坐标只表达客户端选择意图,不会成为历史快照的一部分。
 */
export const promptReferenceSelectionRangeSchema = z
  .object({
    start: z.number().int().min(0).max(12_000),
    end: z.number().int().min(1).max(12_000),
  })
  .strict()
  .refine((range) => range.start < range.end, {
    message: 'Range start must be less than end',
  });

export const promptReferenceScopeSchema = z.enum(['full', 'excerpt']);

const fullPromptReferenceSelectionSchema = z
  .object({
    promptId: entityIdSchema,
    scope: z.literal('full'),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const excerptPromptReferenceSelectionSchema = z
  .object({
    promptId: entityIdSchema,
    scope: z.literal('excerpt'),
    expectedVersion: z.number().int().positive(),
    range: promptReferenceSelectionRangeSchema,
  })
  .strict();

/**
 * 客户端只提交提示词 id、范围与版本;title/text/content 等渲染层字段会被 strict object 拒绝。
 * full 不允许 range,excerpt 必须带 range。
 */
export const promptReferenceSelectionSchema = z.discriminatedUnion('scope', [
  fullPromptReferenceSelectionSchema,
  excerptPromptReferenceSelectionSchema,
]);

/** 有序客户端选择意图;selection intents 是工作台的权威引用字段。 */
export const promptReferenceSelectionsSchema = z
  .array(promptReferenceSelectionSchema)
  .max(MAX_PROMPT_REFERENCE_SELECTIONS);

/**
 * 主机解析后的不可变提示词快照。promptId 为 null 仅表示源提示词已被历史硬删除;
 * title、text、scope 保留生成发生时的内容,不随源记录后续编辑漂移。
 */
export const resolvedPromptReferenceSnapshotSchema = z
  .object({
    promptId: entityIdSchema.nullable(),
    title: promptDocumentSchema.shape.title,
    text: z.string().trim().min(1).max(4_000),
    scope: promptReferenceScopeSchema,
    sourceVersion: z.number().int().positive(),
  })
  .strict();

/** 常用简称,与 resolvedPromptReferenceSnapshotSchema 是同一份契约。 */
export const promptReferenceSnapshotSchema = resolvedPromptReferenceSnapshotSchema;

export const generationStatusSchema = z.enum([
  'pending_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'rejected',
  'expired',
]);

export const generationActorTypeSchema = z.enum(['web', 'cloud_mcp', 'desktop_local']);
export const generationApprovalStatusSchema = z.enum([
  'not_required',
  'pending_approval',
  'approved',
  'rejected',
  'expired',
]);

export const generationAssetUrlSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => {
    if (value.startsWith('/') && !value.startsWith('//')) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        // 桌面本地资产走主进程 media:// 读盘协议(media-protocol.ts);
        // data: 允许内嵌小图(缩略占位、离线导出、测试替身)。
        url.protocol === 'media:' ||
        url.protocol === 'data:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'Asset URL must be HTTPS, media://, data: or an origin-relative path');

/** 参考图上限:与桌面 Provider(desktop-contracts MAX_REFERENCE_IMAGES)对齐。 */
export const MAX_REFERENCE_IMAGES = 16;
/** 单张参考图字节上限:与桌面 staging(core MAX_LOCAL_IMAGE_BYTES)对齐。 */
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * 已上传参考图的宿主内引用(ui-parity 03 §7 P0)。
 * id 是宿主内部定位符:云端 = 对象键尾段(users/{userId}/references/{id});
 * 桌面 = staging 文件名主干(previews/uploads/{id}.{ext})。
 * url 是稳定展示地址(云端 302 重定向路由 / 桌面 media://),mimeType 由宿主嗅探魔数得出。
 */
export const generationReferenceImageSchema = z.object({
  id: z.string().regex(/^[0-9A-Za-z_-]{8,64}$/),
  url: generationAssetUrlSchema,
  name: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteSize: z.number().int().nonnegative(),
});

/** 参考图上传入参(GenerationGateway.uploadReferenceImage):字节由宿主校验魔数并落存储。 */
export const uploadReferenceImageInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bytes: z
    .instanceof(Uint8Array)
    .refine(
      (value) => value.byteLength > 0 && value.byteLength <= MAX_REFERENCE_IMAGE_BYTES,
      '图片不能超过 20 MiB',
    ),
});

/** 保存资产入参(GenerationGateway.saveAsset,ui-parity 03/05 §7):url 即资产契约地址。 */
export const saveAssetInputSchema = z.object({
  url: generationAssetUrlSchema,
  /** 建议文件名(含扩展名);桌面作保存对话框默认名,Web 作 a[download] 名。 */
  name: z.string().trim().min(1).max(200),
});

/** 保存结果:cancelled = 用户取消系统对话框(桌面),不视为错误。 */
export const saveAssetResultSchema = z.enum(['saved', 'cancelled']);

export const cloudGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  negative: z.string().trim().max(4_000).optional(),
  promptId: entityIdSchema.optional(),
  size: generationSizeSchema.default('auto'),
  aspectRatio: persistedGenerationAspectRatioSchema.optional(),
  quality: generationQualitySchema.default('auto'),
  count: z.literal(1).default(1),
  /** 目标 provider(ProviderOption.id)。云端当前忽略(服务端定模型);桌面用于本地 Provider 选择。 */
  providerId: z.string().trim().min(1).max(128).optional(),
  /** 有序参考图(图 1、图 2…):非空时上游走图片编辑通道(/images/edits)。 */
  referenceImages: z.array(generationReferenceImageSchema).max(MAX_REFERENCE_IMAGES).default([]),
});

/** 生图 Provider 选项:云端由服务端给固定项,桌面来自本地 AI 连接。 */
export const providerOptionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(120),
  model: z.string().trim().max(128).nullable(),
  kind: z.enum(['cloud', 'local']),
  available: z.boolean(),
});

/**
 * 客户端创建入参:prompt 是原始用户文本,上限 8000;只有引用选择时才可为空。
 * promptReferenceSelections 是唯一客户端引用意图,解析与快照由宿主完成。
 */
export const createGenerationInputSchema = cloudGenerationRequestSchema
  .omit({ prompt: true })
  .extend({
    prompt: z.string().trim().max(8_000),
    aspectRatio: generationAspectRatioSchema.optional(),
    promptReferenceSelections: promptReferenceSelectionsSchema.default([]),
    sessionId: entityIdSchema.optional(),
    parentRunId: entityIdSchema.optional(),
    runKind: z.enum(['free_generation', 'refinement', 'retry']).default('free_generation'),
  })
  .refine((input) => input.prompt.length > 0 || input.promptReferenceSelections.length > 0, {
    path: ['prompt'],
    message: 'Prompt or at least one prompt reference selection is required',
  });

export const generationAssetSchema = z.object({
  id: entityIdSchema,
  url: generationAssetUrlSchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  expiresAt: isoDateTimeSchema,
});

export const generationJobSchema = z.object({
  id: entityIdSchema,
  sessionId: entityIdSchema.nullable(),
  parentRunId: entityIdSchema.nullable(),
  promptId: entityIdSchema.nullable(),
  /** Raw user text captured before host composition; optional for legacy jobs. */
  userPrompt: z.string().trim().max(8_000).optional(),
  /** Immutable host-resolved prompt references used by the timeline/history view. */
  promptReferences: z
    .array(promptReferenceSnapshotSchema)
    .max(MAX_PROMPT_REFERENCE_SELECTIONS)
    .default([]),
  actorType: generationActorTypeSchema,
  approvalStatus: generationApprovalStatusSchema,
  status: generationStatusSchema,
  progress: z.number().int().min(0).max(100),
  request: cloudGenerationRequestSchema,
  providerModel: z.string().trim().min(1).max(128).nullable(),
  costPoints: z.number().int().nonnegative().nullable(),
  assets: z.array(generationAssetSchema),
  error: z
    .object({
      code: apiErrorCodeSchema,
      message: z.string().min(1).max(500),
    })
    .nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable().optional(),
});

export type GenerationSize = z.infer<typeof generationSizeSchema>;
export type GenerationQuality = z.infer<typeof generationQualitySchema>;
export type GenerationIdempotencyKey = z.infer<typeof generationIdempotencyKeySchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type GenerationActorType = z.infer<typeof generationActorTypeSchema>;
export type GenerationApprovalStatus = z.infer<typeof generationApprovalStatusSchema>;
export type PromptReferenceSelectionRange = z.infer<typeof promptReferenceSelectionRangeSchema>;
export type PromptReferenceScope = z.infer<typeof promptReferenceScopeSchema>;
export type PromptReferenceSelection = z.infer<typeof promptReferenceSelectionSchema>;
export type ResolvedPromptReferenceSnapshot = z.infer<typeof resolvedPromptReferenceSnapshotSchema>;
export type PromptReferenceSnapshot = z.infer<typeof promptReferenceSnapshotSchema>;
export type CloudGenerationRequest = z.input<typeof cloudGenerationRequestSchema>;
export type ParsedCloudGenerationRequest = z.output<typeof cloudGenerationRequestSchema>;
export type CreateGenerationInput = z.input<typeof createGenerationInputSchema>;
export type ParsedCreateGenerationInput = z.output<typeof createGenerationInputSchema>;
export type GenerationAsset = z.infer<typeof generationAssetSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type ProviderOption = z.infer<typeof providerOptionSchema>;
export type GenerationReferenceImage = z.infer<typeof generationReferenceImageSchema>;
export type UploadReferenceImageInput = z.infer<typeof uploadReferenceImageInputSchema>;
export type SaveAssetInput = z.infer<typeof saveAssetInputSchema>;
export type SaveAssetResult = z.infer<typeof saveAssetResultSchema>;
