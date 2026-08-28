import { z } from 'zod';
import { entityIdSchema, isoDateTimeSchema } from './common';

export const mcpScopeSchema = z.enum(['account:read', 'prompts:read', 'skills:read']);

export const mcpConnectionSchema = z.object({
  id: entityIdSchema,
  clientName: z.string().trim().min(1).max(160),
  scopes: z.array(mcpScopeSchema),
  mode: z.enum(['ask_each_time', 'auto_with_limits']),
  maxPointsPerGeneration: z.number().int().nonnegative(),
  maxPointsPerDay: z.number().int().nonnegative(),
  spentPointsToday: z.number().int().nonnegative(),
  reservedPointsToday: z.number().int().nonnegative(),
  status: z.enum(['active', 'suspended', 'revoked']),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
});

export const mcpConnectionPageSchema = z.object({
  items: z.array(mcpConnectionSchema),
});

export const updateMcpConnectionSchema = z.object({
  mode: mcpConnectionSchema.shape.mode.optional(),
  maxPointsPerGeneration: z.number().int().min(0).max(10_000_000).optional(),
  maxPointsPerDay: z.number().int().min(0).max(100_000_000).optional(),
  // v2：连接能力可编辑；扩大（新集合含旧集合没有的 scope）需 reauthPassword。
  scopes: z.array(mcpScopeSchema).min(1).optional(),
  suspended: z.boolean().optional(),
  reauthPassword: z.string().min(8).max(128).optional(),
});

export type McpConnection = z.infer<typeof mcpConnectionSchema>;
export type McpConnectionPage = z.infer<typeof mcpConnectionPageSchema>;
export type UpdateMcpConnection = z.infer<typeof updateMcpConnectionSchema>;

// ── 桌面 AI 连接(生图 Provider 管理)──────────────────────────────
// 桌面本地关切:元数据存 SQLite providers 表,密钥只进主进程系统安全存储。
// 契约刻意没有「读取密钥」的形状——渲染层只能看到 hasKey / keySuffix 状态。

export const aiProviderSchema = z.object({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(80),
  /** 现存数据可能含历史类型(如 doubao-web);v2.5 新建一律 openai-compatible。 */
  type: z.string().min(1).max(40),
  baseUrl: z.string().trim().url().max(400),
  model: z.string().trim().min(1).max(200),
  hasKey: z.boolean(),
  /** 密钥尾号(展示用,如「…a1b2」),无密钥为 null。 */
  keySuffix: z.string().max(12).nullable(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createAiProviderSchema = z.object({
  name: aiProviderSchema.shape.name,
  baseUrl: aiProviderSchema.shape.baseUrl,
  model: aiProviderSchema.shape.model,
  /** write-only:只在入参出现,落地即转系统安全存储。 */
  apiKey: z.string().trim().min(1).max(512).optional(),
  activate: z.boolean().default(false),
});

export const updateAiProviderSchema = z.object({
  name: aiProviderSchema.shape.name.optional(),
  baseUrl: aiProviderSchema.shape.baseUrl.optional(),
  model: aiProviderSchema.shape.model.optional(),
  /** string=替换密钥;null=删除密钥;undefined=不动。 */
  apiKey: z.string().trim().min(1).max(512).nullable().optional(),
});

export type AiProvider = z.infer<typeof aiProviderSchema>;
export type CreateAiProvider = z.infer<typeof createAiProviderSchema>;
export type UpdateAiProvider = z.infer<typeof updateAiProviderSchema>;
