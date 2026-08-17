import { z } from 'zod';
import { entityIdSchema, isoDateTimeSchema, paginationCursorSchema } from './common';

export const promptTagSchema = z.string().trim().min(1).max(40);
export const promptParamsSchema = z.record(z.string(), z.unknown());

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
  isPinned: z.boolean(),
  usageCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const newPromptDocumentSchema = promptDocumentSchema.pick({
  title: true,
  description: true,
  content: true,
  negative: true,
  folderId: true,
  tags: true,
  modelId: true,
  params: true,
  isPinned: true,
});

export const updatePromptDocumentSchema = newPromptDocumentSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});

export const promptListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: paginationCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  folderId: entityIdSchema.nullable().optional(),
  tags: z.array(promptTagSchema).max(20).optional(),
  pinnedOnly: z.boolean().optional(),
  includeDeleted: z.boolean().default(false),
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

export type PromptDocument = z.infer<typeof promptDocumentSchema>;
export type NewPromptDocument = z.infer<typeof newPromptDocumentSchema>;
export type UpdatePromptDocument = z.infer<typeof updatePromptDocumentSchema>;
export type PromptListQuery = z.input<typeof promptListQuerySchema>;
export type ParsedPromptListQuery = z.output<typeof promptListQuerySchema>;
export type PromptPage = z.infer<typeof promptPageSchema>;
export type PromptUseInput = z.infer<typeof promptUseInputSchema>;
export type PromptUseResult = z.infer<typeof promptUseResultSchema>;
