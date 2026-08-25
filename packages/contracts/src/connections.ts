import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema } from "./common.js";

export const mcpScopeSchema = z.enum([
  "account:read",
  "prompts:read",
  "prompts:write",
  "skills:read",
  "generations:read",
  "generations:write",
]);

export const mcpConnectionSchema = z.object({
  id: entityIdSchema,
  clientName: z.string().trim().min(1).max(160),
  scopes: z.array(mcpScopeSchema),
  mode: z.enum(["ask_each_time", "auto_with_limits"]),
  maxPointsPerGeneration: z.number().int().nonnegative(),
  maxPointsPerDay: z.number().int().nonnegative(),
  spentPointsToday: z.number().int().nonnegative(),
  reservedPointsToday: z.number().int().nonnegative(),
  status: z.enum(["active", "suspended", "revoked"]),
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
