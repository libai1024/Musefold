import { z } from 'zod';
import { cloudGenerationRequestSchema, generationJobSchema } from './generation';
import {
  entityIdSchema,
  isoDateTimeSchema,
  paginationCursorSchema,
  queryBooleanSchema,
  queryIntegerSchema,
} from './common';

export const workbenchDraftSchema = z.object({
  prompt: z.string().max(12_000),
  negative: z.string().max(4_000),
  params: cloudGenerationRequestSchema
    .pick({ size: true, aspectRatio: true, quality: true })
    .partial(),
  promptReferenceIds: z.array(entityIdSchema).max(20),
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
  draft: workbenchDraftSchema.partial().default({}),
});

export const updateWorkbenchSessionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  draft: workbenchDraftSchema.optional(),
  archived: z.boolean().optional(),
});

export const workbenchSessionPageSchema = z.object({
  items: z.array(workbenchSessionSchema),
  nextCursor: paginationCursorSchema.nullable(),
});

export const workbenchSessionListQuerySchema = z.object({
  cursor: paginationCursorSchema.optional(),
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  includeArchived: queryBooleanSchema.default(false),
  includeDeleted: queryBooleanSchema.default(false),
});

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
  includeDeleted: queryBooleanSchema.default(false),
  /** 回收站视图:只返回已软删的记录(true 时忽略 includeDeleted)。 */
  deletedOnly: queryBooleanSchema.default(false),
});

export const generationHistoryPageSchema = z.object({
  items: z.array(generationJobSchema),
  nextCursor: paginationCursorSchema.nullable(),
});

export type WorkbenchDraft = z.infer<typeof workbenchDraftSchema>;
export type WorkbenchSession = z.infer<typeof workbenchSessionSchema>;
export type CreateWorkbenchSession = z.input<typeof createWorkbenchSessionSchema>;
export type UpdateWorkbenchSession = z.infer<typeof updateWorkbenchSessionSchema>;
export type WorkbenchSessionPage = z.infer<typeof workbenchSessionPageSchema>;
export type GenerationHistoryPage = z.infer<typeof generationHistoryPageSchema>;
export type WorkbenchSessionListQuery = z.input<typeof workbenchSessionListQuerySchema>;
export type ParsedWorkbenchSessionListQuery = z.output<typeof workbenchSessionListQuerySchema>;
export type GenerationHistoryQuery = z.input<typeof generationHistoryQuerySchema>;
export type ParsedGenerationHistoryQuery = z.output<typeof generationHistoryQuerySchema>;
