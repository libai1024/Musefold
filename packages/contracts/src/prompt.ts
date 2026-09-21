import { z } from 'zod';
import {
  entityIdSchema,
  isoDateTimeSchema,
  paginationCursorSchema,
  queryBooleanSchema,
  queryIntegerSchema,
} from './common';

export const promptTagNameSchema = z.string().trim().min(1).max(40);
export const promptParamsSchema = z.record(z.string(), z.unknown());
export const promptSourceSchema = z.enum(['manual', 'import', 'share', 'slip', 'generation']);

export const promptTagSchema = z.object({
  id: entityIdSchema,
  name: promptTagNameSchema,
  group: z.string().trim().min(1).max(40).nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const promptFolderSchema = z.object({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(80),
  parentId: entityIdSchema.nullable(),
  sortOrder: z.number().int(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

/**
 * 封面展示地址 —— **path-free**:桌面由主进程解析为 `media://` 受管 URL,
 * 云端为对象存储签名/公开 URL。本地绝对路径不进契约(`z.url()` 天然拒绝裸路径),
 * 渲染层拿到即可直接 `<img src>`。
 */
export const promptCoverImageUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    // zod 的 check 链不 abort:.url() 失败时本 refine 仍会执行,自己兜住解析异常。
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        // 桌面本地封面走主进程 media:// 读盘协议(media-protocol.ts);
        // data: 允许内嵌小图(离线导出、测试替身)。
        url.protocol === 'media:' ||
        url.protocol === 'data:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'coverImageUrl must use https, media://, data: or a loopback origin')
  .max(4_096);

export const promptDocumentSchema = z.object({
  id: entityIdSchema,
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
  content: z.string().trim().min(1).max(12_000),
  negative: z.string().trim().max(4_000).nullable(),
  folderId: entityIdSchema.nullable(),
  tags: z.array(promptTagSchema).max(20),
  modelId: z.string().trim().min(1).max(128).nullable(),
  params: promptParamsSchema.nullable(),
  rating: z.number().int().min(0).max(5),
  isPinned: z.boolean(),
  pinOrder: z.number().int().nullable(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  source: promptSourceSchema,
  sourceUrl: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    }, 'sourceUrl must use http or https')
    .max(2_048)
    .nullable(),
  /**
   * 封面缩略(列表行 44px + 详情头部):`null` = 明确无封面,渲染层落 FileText 占位。
   * 宿主未实现封面解析时可整键缺省(与 null 等价)——避免旧宿主/旧快照被判为脏数据。
   */
  coverImageUrl: promptCoverImageUrlSchema.nullish(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const newPromptDocumentSchema = z.object({
  title: promptDocumentSchema.shape.title,
  description: promptDocumentSchema.shape.description,
  content: promptDocumentSchema.shape.content,
  negative: promptDocumentSchema.shape.negative,
  folderId: promptDocumentSchema.shape.folderId,
  tagIds: z.array(entityIdSchema).max(20).default([]),
  modelId: promptDocumentSchema.shape.modelId,
  params: promptDocumentSchema.shape.params,
  rating: promptDocumentSchema.shape.rating.default(0),
  isPinned: promptDocumentSchema.shape.isPinned.default(false),
  pinOrder: promptDocumentSchema.shape.pinOrder.optional(),
  source: promptSourceSchema.default('manual'),
  sourceUrl: promptDocumentSchema.shape.sourceUrl.default(null),
  /** 「存为提示词」把本次首张成功图写成封面;手工新建不带。 */
  coverImageUrl: promptCoverImageUrlSchema.nullish(),
});

export const updatePromptDocumentSchema = z.object({
  title: promptDocumentSchema.shape.title.optional(),
  description: promptDocumentSchema.shape.description.optional(),
  content: promptDocumentSchema.shape.content.optional(),
  negative: promptDocumentSchema.shape.negative.optional(),
  folderId: promptDocumentSchema.shape.folderId.optional(),
  tagIds: z.array(entityIdSchema).max(20).optional(),
  modelId: promptDocumentSchema.shape.modelId.optional(),
  params: promptDocumentSchema.shape.params.optional(),
  rating: promptDocumentSchema.shape.rating.optional(),
  isPinned: promptDocumentSchema.shape.isPinned.optional(),
  pinOrder: promptDocumentSchema.shape.pinOrder.optional(),
  source: promptSourceSchema.optional(),
  sourceUrl: promptDocumentSchema.shape.sourceUrl.optional(),
  /** 缺省 = 不改封面;显式 null = 清除封面。 */
  coverImageUrl: promptCoverImageUrlSchema.nullish(),
  expectedVersion: z.number().int().positive(),
});

export const newPromptFolderSchema = promptFolderSchema.pick({
  name: true,
  parentId: true,
  sortOrder: true,
});

export const updatePromptFolderSchema = newPromptFolderSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});

export const newPromptTagSchema = promptTagSchema.pick({
  name: true,
  group: true,
  color: true,
});

export const updatePromptTagSchema = newPromptTagSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});

export const promptListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: paginationCursorSchema.optional(),
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  /** GET 查询串无法承载 null,wire 约定字面量 'null' 表示「根目录(无文件夹)过滤」。 */
  folderId: z
    .union([z.literal('null').transform(() => null), entityIdSchema.nullable()])
    .optional(),
  tagIds: z
    .union([z.array(entityIdSchema).max(20), entityIdSchema.transform((value) => [value])])
    .optional(),
  pinnedOnly: queryBooleanSchema.optional(),
  includeDeleted: queryBooleanSchema.default(false),
  /** 仅回收站记录；true 优先于 includeDeleted，筛选必须在分页前由宿主执行。 */
  deletedOnly: queryBooleanSchema.optional(),
  sort: z.enum(['updated-desc', 'created-desc', 'usage-desc', 'title-asc']).default('updated-desc'),
});

export const promptPageSchema = z.object({
  items: z.array(promptDocumentSchema),
  nextCursor: paginationCursorSchema.nullable(),
});

export const promptUseInputSchema = z.object({
  action: z.enum(['copy', 'apply', 'generate']),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const promptUseResultSchema = z.object({
  prompt: promptDocumentSchema,
  recorded: z.boolean(),
});

/** 「清空回收站」出参:本次永久删除条数(回收站已空时为 0,动作幂等)。 */
export const promptEmptyTrashResultSchema = z.object({
  purged: z.number().int().nonnegative(),
});

export type PromptDocument = z.infer<typeof promptDocumentSchema>;
export type PromptFolder = z.infer<typeof promptFolderSchema>;
export type PromptTag = z.infer<typeof promptTagSchema>;
export type NewPromptDocument = z.infer<typeof newPromptDocumentSchema>;
export type UpdatePromptDocument = z.infer<typeof updatePromptDocumentSchema>;
export type NewPromptFolder = z.infer<typeof newPromptFolderSchema>;
export type UpdatePromptFolder = z.infer<typeof updatePromptFolderSchema>;
export type NewPromptTag = z.infer<typeof newPromptTagSchema>;
export type UpdatePromptTag = z.infer<typeof updatePromptTagSchema>;
export type PromptListQuery = z.input<typeof promptListQuerySchema>;
export type ParsedPromptListQuery = z.output<typeof promptListQuerySchema>;
export type PromptPage = z.infer<typeof promptPageSchema>;
export type PromptUseInput = z.infer<typeof promptUseInputSchema>;
export type PromptUseResult = z.infer<typeof promptUseResultSchema>;
export type PromptEmptyTrashResult = z.infer<typeof promptEmptyTrashResultSchema>;
