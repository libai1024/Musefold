/**
 * v0.3.2 设计方案领域模型（Domain 层唯一事实源）。
 *
 * 约束（见 docs/v0.3.2/V03.2-AGENT-RUNTIME-DEVELOPMENT.md §2.1）：
 * - 本模块依赖 zod 与共享 contracts，不依赖 Electron、React、Provider 或网络客户端。
 * - Agent 输出必须经过这里的 schema 校验后才允许写入数据库。
 */
import { z } from 'zod';
import {
  designSchemeRepositoryImagesSchema,
  designSchemeRevisionDocumentSchema as canonicalDocumentSchema,
  compilationTraceItemSchema as canonicalTraceSchema,
  compilationRecordSchema as canonicalCompilationSchema,
  designConstraintSchema as canonicalConstraintSchema,
} from './design-scheme';

export const LEGACY_DESIGN_SCHEME_DOCUMENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

/** 还原度是事实声明，不是排序装饰（规范 §2.3）。 */
export const legacyFidelitySchema = z.enum(['verified', 'faithful', 'adapted', 'unsupported']);
export type LegacyFidelity = z.infer<typeof legacyFidelitySchema>;

/** 用户只看到草稿/正式两个状态；试运行是运行模式（规范 §2.2）。 */
export const legacySchemeStatusSchema = z.enum(['draft', 'formal']);
export type LegacySchemeStatus = z.infer<typeof legacySchemeStatusSchema>;

export const legacySourceKindSchema = z.enum([
  'github-skill',
  'github-prompt-repo',
  'github-readme',
  'history-image',
  'conversation-turn',
  'user-brief',
  'reference-image',
]);
export type LegacySourceKind = z.infer<typeof legacySourceKindSchema>;

/** normative 影响编译；reference 仅视觉参考；example 帮助抽取变量；context 只提供背景（规范 §5.2）。 */
export const legacySourceRoleSchema = z.enum(['normative', 'reference', 'example', 'context']);
export type LegacySourceRole = z.infer<typeof legacySourceRoleSchema>;

export const legacyInputKindSchema = z.enum(['text', 'image', 'image-set', 'article', 'choice']);
export type LegacyInputKind = z.infer<typeof legacyInputKindSchema>;

export const legacyImageRoleSchema = z.enum([
  'edit-target',
  'subject-reference',
  'style-reference',
  'layout-reference',
  'content-reference',
]);
export type LegacyImageRole = z.infer<typeof legacyImageRoleSchema>;

export const legacyConstraintDomainSchema = z.enum([
  'composition',
  'color',
  'typography',
  'texture',
  'subject',
  'output',
  'safety',
]);
export type LegacyConstraintDomain = z.infer<typeof legacyConstraintDomainSchema>;

export const legacyConstraintModeSchema = z.enum(['required', 'preferred', 'avoid']);
export type LegacyConstraintMode = z.infer<typeof legacyConstraintModeSchema>;

export const legacyPromptModuleKindSchema = z.enum([
  'system-rule',
  'input-template',
  'style-rule',
  'negative-rule',
  'quality-rule',
]);
export type LegacyPromptModuleKind = z.infer<typeof legacyPromptModuleKindSchema>;

// ---------------------------------------------------------------------------
// 结构化组成
// ---------------------------------------------------------------------------

export const legacySourceBindingSchema = z.object({
  id: z.string().min(1),
  kind: legacySourceKindSchema,
  role: legacySourceRoleSchema,
  uri: z.string().max(2048).optional(),
  ref: z.string().max(256).optional(),
  commit: z.string().max(128).optional(),
  filePath: z.string().max(1024).optional(),
  contentHash: z.string().max(128).optional(),
  license: z.string().max(256).optional(),
  /** Canonical source snapshot identities retained across the legacy document bridge. */
  packageId: z.string().min(1).max(128).optional(),
  snapshotId: z.string().min(1).max(128).optional(),
});
export type LegacySourceBinding = z.infer<typeof legacySourceBindingSchema>;

export const legacyInputSlotSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  kind: legacyInputKindSchema,
  required: z.boolean(),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().min(1).optional(),
  imageRole: legacyImageRoleSchema.optional(),
  preserve: z.enum(['high', 'medium', 'low']).optional(),
  description: z.string().max(300).optional(),
});
export type LegacyInputSlot = z.infer<typeof legacyInputSlotSchema>;

export const legacyParameterDefinitionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'select', 'multi-select', 'boolean', 'color', 'ratio', 'number']),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string().max(120)).max(32).optional(),
  userEditable: z.boolean(),
});
export type LegacyParameterDefinition = z.infer<typeof legacyParameterDefinitionSchema>;

export const legacyDesignConstraintSchema = z.object({
  id: z.string().min(1).max(64),
  domain: legacyConstraintDomainSchema,
  statement: z.string().min(1).max(600),
  mode: legacyConstraintModeSchema,
  sourceIds: z.array(z.string()).max(32),
  evidencePath: canonicalConstraintSchema.shape.evidencePath,
  userOverridable: z.boolean(),
});
export type LegacyDesignConstraint = z.infer<typeof legacyDesignConstraintSchema>;

export const legacyPromptModuleSchema = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0),
  kind: legacyPromptModuleKindSchema,
  template: z.string().min(1).max(4000),
  variables: z.array(z.string().max(64)).max(32),
  sourceIds: z.array(z.string()).max(32),
});
export type LegacyPromptModule = z.infer<typeof legacyPromptModuleSchema>;

/** 创建轨迹的精简条目：只保留步骤与结论，不含全文（用户决策：save-light）。 */
export const legacyCompilationTraceItemSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  detail: z.string().max(600).optional(),
  kind: canonicalTraceSchema.shape.kind.optional(),
  output: canonicalTraceSchema.shape.output,
  status: canonicalTraceSchema.shape.status,
  durationMs: z.number().int().min(0).optional(),
});
export type LegacyCompilationTraceItem = z.infer<typeof legacyCompilationTraceItemSchema>;

/** 编译记录必须写明采用了什么、舍弃了什么、为什么不能还原（规范 §6.1）。 */
export const legacyCompilationRecordSchema = z.object({
  compiledAt: z.number().int().min(0),
  compilerVersion: canonicalCompilationSchema.shape.compilerVersion,
  model: z.object({
    model: z.string().max(200),
    connectionName: z.string().max(120).optional(),
  }),
  adopted: z.array(z.string().max(300)).max(40),
  omitted: z.array(z.string().max(300)).max(40),
  warnings: z.array(z.string().max(300)).max(40),
  briefExcerpt: z.string().max(600).optional(),
  trace: z.array(legacyCompilationTraceItemSchema).max(60),
});
export type LegacyCompilationRecord = z.infer<typeof legacyCompilationRecordSchema>;

// ---------------------------------------------------------------------------
// 版本文档与顶层对象
// ---------------------------------------------------------------------------

export const legacyDesignSchemeRevisionDocumentSchema = z.object({
  schemaVersion: z.literal(LEGACY_DESIGN_SCHEME_DOCUMENT_VERSION),
  revisionId: z.string().min(1),
  schemeId: z.string().min(1),
  name: z.string().min(1).max(120),
  summary: z.string().max(500),
  fidelity: legacyFidelitySchema,
  sources: z.array(legacySourceBindingSchema).max(32),
  sourceSnapshotIds: z.array(z.string().min(1).max(128)).max(32).optional(),
  assetIds: z.array(z.string().min(1).max(128)).max(128).optional(),
  repositoryImages: designSchemeRepositoryImagesSchema.optional(),
  inputs: z.array(legacyInputSlotSchema).max(24),
  parameters: z.array(legacyParameterDefinitionSchema).max(24),
  constraints: z.array(legacyDesignConstraintSchema).max(60),
  promptProgram: z.array(legacyPromptModuleSchema).min(1).max(40),
  compilation: legacyCompilationRecordSchema,
  createdBy: canonicalDocumentSchema.shape.createdBy.optional(),
  createdAt: canonicalDocumentSchema.shape.createdAt,
  parentRevisionId: canonicalDocumentSchema.shape.parentRevisionId,
});
export type LegacyDesignSchemeRevisionDocument = z.infer<
  typeof legacyDesignSchemeRevisionDocumentSchema
>;
