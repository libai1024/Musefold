/**
 * v0.3.2 设计方案领域模型（Domain 层唯一事实源）。
 *
 * 约束（见 docs/v0.3.2/V03.2-AGENT-RUNTIME-DEVELOPMENT.md §2.1）：
 * - 本模块只依赖 zod，不依赖 Electron、React、Provider 或网络客户端。
 * - Agent 输出必须经过这里的 schema 校验后才允许写入数据库。
 */
import { z } from 'zod';

export const DESIGN_SCHEME_DOCUMENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

/** 还原度是事实声明，不是排序装饰（规范 §2.3）。 */
export const fidelitySchema = z.enum(['verified', 'faithful', 'adapted', 'unsupported']);
export type Fidelity = z.infer<typeof fidelitySchema>;

/** 用户只看到草稿/正式两个状态；试运行是运行模式（规范 §2.2）。 */
export const schemeStatusSchema = z.enum(['draft', 'formal']);
export type SchemeStatus = z.infer<typeof schemeStatusSchema>;

export const sourceKindSchema = z.enum([
  'github-skill',
  'github-prompt-repo',
  'github-readme',
  'history-image',
  'conversation-turn',
  'user-brief',
  'reference-image',
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

/** normative 影响编译；reference 仅视觉参考；example 帮助抽取变量；context 只提供背景（规范 §5.2）。 */
export const sourceRoleSchema = z.enum(['normative', 'reference', 'example', 'context']);
export type SourceRole = z.infer<typeof sourceRoleSchema>;

export const inputKindSchema = z.enum(['text', 'image', 'image-set', 'article', 'choice']);
export type InputKind = z.infer<typeof inputKindSchema>;

export const imageRoleSchema = z.enum([
  'edit-target',
  'subject-reference',
  'style-reference',
  'layout-reference',
  'content-reference',
]);
export type ImageRole = z.infer<typeof imageRoleSchema>;

export const constraintDomainSchema = z.enum([
  'composition',
  'color',
  'typography',
  'texture',
  'subject',
  'output',
  'safety',
]);
export type ConstraintDomain = z.infer<typeof constraintDomainSchema>;

export const constraintModeSchema = z.enum(['required', 'preferred', 'avoid']);
export type ConstraintMode = z.infer<typeof constraintModeSchema>;

export const promptModuleKindSchema = z.enum([
  'system-rule',
  'input-template',
  'style-rule',
  'negative-rule',
  'quality-rule',
]);
export type PromptModuleKind = z.infer<typeof promptModuleKindSchema>;

// ---------------------------------------------------------------------------
// 结构化组成
// ---------------------------------------------------------------------------

export const sourceBindingSchema = z.object({
  id: z.string().min(1),
  kind: sourceKindSchema,
  role: sourceRoleSchema,
  uri: z.string().max(2048).optional(),
  ref: z.string().max(256).optional(),
  commit: z.string().max(128).optional(),
  filePath: z.string().max(1024).optional(),
  contentHash: z.string().max(128).optional(),
  license: z.string().max(256).optional(),
});
export type SourceBinding = z.infer<typeof sourceBindingSchema>;

export const inputSlotSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  kind: inputKindSchema,
  required: z.boolean(),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().min(1).optional(),
  imageRole: imageRoleSchema.optional(),
  preserve: z.enum(['high', 'medium', 'low']).optional(),
  description: z.string().max(300).optional(),
});
export type InputSlot = z.infer<typeof inputSlotSchema>;

export const parameterDefinitionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'select', 'multi-select', 'boolean', 'color', 'ratio', 'number']),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string().max(120)).max(32).optional(),
  userEditable: z.boolean(),
});
export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;

export const designConstraintSchema = z.object({
  id: z.string().min(1).max(64),
  domain: constraintDomainSchema,
  statement: z.string().min(1).max(600),
  mode: constraintModeSchema,
  sourceIds: z.array(z.string()).max(16),
  userOverridable: z.boolean(),
});
export type DesignConstraint = z.infer<typeof designConstraintSchema>;

export const promptModuleSchema = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0),
  kind: promptModuleKindSchema,
  template: z.string().min(1).max(4000),
  variables: z.array(z.string().max(64)).max(32),
  sourceIds: z.array(z.string()).max(16),
});
export type PromptModule = z.infer<typeof promptModuleSchema>;

/** 创建轨迹的精简条目：只保留步骤与结论，不含全文（用户决策：save-light）。 */
export const compilationTraceItemSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  detail: z.string().max(600).optional(),
  status: z.enum(['success', 'warning', 'error']),
  durationMs: z.number().int().min(0).optional(),
});
export type CompilationTraceItem = z.infer<typeof compilationTraceItemSchema>;

/** 编译记录必须写明采用了什么、舍弃了什么、为什么不能还原（规范 §6.1）。 */
export const compilationRecordSchema = z.object({
  compiledAt: z.number().int().min(0),
  model: z.object({
    model: z.string().max(200),
    connectionName: z.string().max(120).optional(),
  }),
  adopted: z.array(z.string().max(300)).max(40),
  omitted: z.array(z.string().max(300)).max(40),
  warnings: z.array(z.string().max(300)).max(40),
  briefExcerpt: z.string().max(600).optional(),
  trace: z.array(compilationTraceItemSchema).max(60),
});
export type CompilationRecord = z.infer<typeof compilationRecordSchema>;

// ---------------------------------------------------------------------------
// 版本文档与顶层对象
// ---------------------------------------------------------------------------

export const designSchemeRevisionDocumentSchema = z.object({
  schemaVersion: z.literal(DESIGN_SCHEME_DOCUMENT_VERSION),
  revisionId: z.string().min(1),
  schemeId: z.string().min(1),
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  fidelity: fidelitySchema,
  sources: z.array(sourceBindingSchema).max(32),
  inputs: z.array(inputSlotSchema).max(24),
  parameters: z.array(parameterDefinitionSchema).max(24),
  constraints: z.array(designConstraintSchema).max(60),
  promptProgram: z.array(promptModuleSchema).min(1).max(40),
  compilation: compilationRecordSchema,
});
export type DesignSchemeRevisionDocument = z.infer<typeof designSchemeRevisionDocumentSchema>;

export const designSchemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  summary: z.string().max(500),
  status: schemeStatusSchema,
  sourcePresentation: z.enum(['skill', 'musefold-created']),
  currentRevisionId: z.string().min(1),
  workingDraftRevisionId: z.string().optional(),
  coverAssetId: z.string().optional(),
  fidelity: fidelitySchema,
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});
export type DesignScheme = z.infer<typeof designSchemeSchema>;

// ---------------------------------------------------------------------------
// 校验入口
// ---------------------------------------------------------------------------

export interface DomainParseIssue {
  path: string;
  message: string;
}

export type DomainParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: DomainParseIssue[] };

function toParseResult<T>(schema: z.ZodType<T>, candidate: unknown): DomainParseResult<T> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}

export function parseDesignSchemeRevisionDocument(candidate: unknown): DomainParseResult<DesignSchemeRevisionDocument> {
  return toParseResult(designSchemeRevisionDocumentSchema, candidate);
}

export function parseDesignScheme(candidate: unknown): DomainParseResult<DesignScheme> {
  return toParseResult(designSchemeSchema, candidate);
}
