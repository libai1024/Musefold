import { z } from 'zod';
import {
  cloudGenerationRequestSchema,
  generationAspectRatioSchema,
  generationJobSchema,
  persistedGenerationAspectRatioSchema,
  promptReferenceSelectionsSchema,
} from './generation';
import {
  entityIdSchema,
  isoDateTimeSchema,
  paginationCursorSchema,
  queryBooleanSchema,
  queryIntegerSchema,
} from './common';

const workbenchDraftBaseSchema = z.object({
  /** Legacy persisted drafts retain their historical 12,000-code-unit prompt limit. */
  prompt: z.string().max(12_000),
  negative: z.string().max(4_000),
  params: cloudGenerationRequestSchema
    .pick({ size: true, aspectRatio: true, quality: true })
    .partial(),
  /** New selection intents are authoritative; host resolves them into immutable snapshots. */
  promptReferenceSelections: promptReferenceSelectionsSchema.default([]),
  /** Legacy id-only references retained for old drafts and migration compatibility. */
  promptReferenceIds: z.array(entityIdSchema).max(20).default([]),
});

/** Persisted/response draft shape: old ratio grammar remains readable without rewriting stored rows. */
export const workbenchDraftSchema = workbenchDraftBaseSchema.extend({
  params: workbenchDraftBaseSchema.shape.params.extend({
    aspectRatio: persistedGenerationAspectRatioSchema.optional(),
  }),
});

/** New create/update writes require a canonical ratio and normalize equivalent ratios. */
export const writableWorkbenchDraftSchema = workbenchDraftBaseSchema.extend({
  params: workbenchDraftBaseSchema.shape.params.extend({
    aspectRatio: generationAspectRatioSchema.optional(),
  }),
});

export const workbenchSessionSchema = z.object({
  id: entityIdSchema,
  title: z.string().trim().min(1).max(120),
  draft: workbenchDraftSchema,
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable(),
  deletedAt: isoDateTimeSchema.nullable(),
  /**
   * 会话行状态点(V25-UI-SPEC §3.3)的派生字段:该会话最近一次生成的状态与完成时刻。
   * 服务端/桥在 list/get 时从 runs 推导;default null 使旧响应无损兼容。
   */
  latestJobStatus: generationJobSchema.shape.status.nullable().default(null),
  latestJobFinishedAt: isoDateTimeSchema.nullable().default(null),
});

export const createWorkbenchSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).default('未命名创作'),
  draft: writableWorkbenchDraftSchema.partial().default({}),
});

export const updateWorkbenchSessionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  draft: writableWorkbenchDraftSchema.optional(),
  archived: z.boolean().optional(),
});

export const workbenchSessionPageSchema = z.object({
  items: z.array(workbenchSessionSchema),
  nextCursor: paginationCursorSchema.nullable(),
});

/** Permanently removed Sessions only; generation, assets and cost records are retained. */
export const workbenchSessionCleanupResultSchema = z.object({
  purged: z.number().int().nonnegative(),
});

export const workbenchSessionListQuerySchema = z.object({
  cursor: paginationCursorSchema.optional(),
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  includeArchived: queryBooleanSchema.default(false),
  includeDeleted: queryBooleanSchema.default(false),
  /** 已归档聊天视图:只返回已归档且未软删的会话,优先于其他包含开关。 */
  archivedOnly: queryBooleanSchema.default(false),
  /** 回收站包含普通及已归档的软删会话；优先于所有归档/包含开关。 */
  deletedOnly: queryBooleanSchema.default(false),
});

/** Effective query scope, also bound into opaque cursors to reject filter changes. */
export const workbenchSessionFilterSchema = z.enum([
  'active',
  'live',
  'unarchived',
  'all',
  'archived',
  'trash',
]);

export function getWorkbenchSessionFilter(
  query: z.output<typeof workbenchSessionListQuerySchema>,
): z.infer<typeof workbenchSessionFilterSchema> {
  if (query.deletedOnly) return 'trash';
  if (query.archivedOnly) return 'archived';
  if (query.includeArchived) return query.includeDeleted ? 'all' : 'live';
  return query.includeDeleted ? 'unarchived' : 'active';
}

/** Private paging token shape. Entity timestamps retain the public response grammar. */
export const workbenchSessionCursorSchema = z
  .object({
    version: z.literal(1),
    store: z.enum(['postgres', 'sqlite']),
    filter: workbenchSessionFilterSchema,
    id: entityIdSchema.refine((value) => !value.includes('\0')),
    // PG sorting needs all six fractional digits; SQLite emits its milliseconds padded to six.
    updatedAt: z
      .string()
      .datetime({ precision: 6 })
      .refine((value) => !value.startsWith('0000-')),
  })
  .strict();

export const generationHistoryQuerySchema = z.object({
  cursor: paginationCursorSchema.optional(),
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  sessionId: entityIdSchema.optional(),
  status: generationJobSchema.shape.status.optional(),
  /** ISO bounds are transport-safe equivalents of Desktop's epoch-ms bounds. */
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  providerModel: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().max(200).optional(),
  /** 提示词详情「相关作品」:按来源 promptId 服务端过滤,不再扫最近一页再客户端筛。 */
  promptId: entityIdSchema.optional(),
  includeDeleted: queryBooleanSchema.default(false),
  /** 回收站视图:只返回已软删的记录(true 时忽略 includeDeleted)。 */
  deletedOnly: queryBooleanSchema.default(false),
});

export const generationHistoryPageSchema = z.object({
  items: z.array(generationJobSchema),
  nextCursor: paginationCursorSchema.nullable(),
});

export type WorkbenchDraft = z.infer<typeof workbenchDraftSchema>;
export type WritableWorkbenchDraft = z.infer<typeof writableWorkbenchDraftSchema>;
export type WorkbenchSession = z.infer<typeof workbenchSessionSchema>;
export type CreateWorkbenchSession = z.input<typeof createWorkbenchSessionSchema>;
export type UpdateWorkbenchSession = z.infer<typeof updateWorkbenchSessionSchema>;
export type WorkbenchSessionPage = z.infer<typeof workbenchSessionPageSchema>;
export type WorkbenchSessionCleanupResult = z.infer<typeof workbenchSessionCleanupResultSchema>;
export type GenerationHistoryPage = z.infer<typeof generationHistoryPageSchema>;
export type WorkbenchSessionListQuery = z.input<typeof workbenchSessionListQuerySchema>;
export type ParsedWorkbenchSessionListQuery = z.output<typeof workbenchSessionListQuerySchema>;
export type GenerationHistoryQuery = z.input<typeof generationHistoryQuerySchema>;
export type ParsedGenerationHistoryQuery = z.output<typeof generationHistoryQuerySchema>;
