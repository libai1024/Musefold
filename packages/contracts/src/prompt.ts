import { z } from 'zod';
import { entityIdSchema, isoDateTimeSchema, paginationCursorSchema } from './common.js';

export const promptTagNameSchema = z.string().trim().min(1).max(40);
export const promptParamsSchema = z.record(z.string(), z.unknown());
export const promptSourceSchema = z.enum(['manual', 'import', 'share', 'slip', 'generation']);

export const promptTagSchema = z.object({
  id: entityIdSchema,
  name: promptTagNameSchema,
  group: z.string().trim().min(1).max(40).nullable(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
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
  sourceUrl: z.string().url().max(2_048).nullable(),
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
  limit: z.coerce.number().int().min(1).max(100).default(20),
  folderId: entityIdSchema.nullable().optional(),
  tagIds: z.array(entityIdSchema).max(20).optional(),
  pinnedOnly: z.coerce.boolean().optional(),
  includeDeleted: z.coerce.boolean().default(false),
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
