import { z } from 'zod';
import { apiErrorCodeSchema, entityIdSchema, isoDateTimeSchema } from './common';

export const generationSizeSchema = z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']);

export const generationQualitySchema = z.enum(['low', 'medium', 'high', 'auto']);
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
  aspectRatio: z
    .string()
    .regex(/^\d{1,2}:\d{1,2}$/)
    .optional(),
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

export const createGenerationInputSchema = cloudGenerationRequestSchema.extend({
  sessionId: entityIdSchema.optional(),
  parentRunId: entityIdSchema.optional(),
  runKind: z.enum(['free_generation', 'refinement', 'retry']).default('free_generation'),
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
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type GenerationActorType = z.infer<typeof generationActorTypeSchema>;
export type GenerationApprovalStatus = z.infer<typeof generationApprovalStatusSchema>;
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
