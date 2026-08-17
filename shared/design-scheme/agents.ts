/**
 * 角色 Agent 的结构化返回契约（模型侧输出，经 zod 校验后由 Runtime 落域）。
 *
 * 说明：
 * - 模型返回不携带 id/order/sourceIds；这些由确定性 Runtime 统一分配，
 *   避免让自然语言直接驱动数据写入（开发规范 §3.2）。
 * - 校验失败只允许重试一次，仍失败进入可解释错误态。
 */
import { z } from 'zod';
import {
  constraintDomainSchema,
  constraintModeSchema,
  fidelitySchema,
  imageRoleSchema,
  inputKindSchema,
  promptModuleKindSchema,
} from './schema';

// ---------------------------------------------------------------------------
// Repository Analyst
// ---------------------------------------------------------------------------

/** 仓库分类（规范 §6.1）。 */
export const repoKindSchema = z.enum([
  'agent-skill',
  'prompt-repo',
  'readme-examples',
  'workflow-config',
  'code-dependent',
  'asset-only',
]);
export type RepoKind = z.infer<typeof repoKindSchema>;

export const analystRuleSchema = z.object({
  domain: constraintDomainSchema,
  statement: z.string().min(1).max(600),
  mode: constraintModeSchema,
  /** 证据文件路径（仓库内相对路径）；没有证据的规则只能进 adapted。 */
  evidencePaths: z.array(z.string().max(1024)).max(8).default([]),
});
export type AnalystRule = z.infer<typeof analystRuleSchema>;

export const analystVariableSchema = z.object({
  label: z.string().min(1).max(80),
  kind: inputKindSchema,
  required: z.boolean(),
  imageRole: imageRoleSchema.optional(),
  description: z.string().max(300).optional(),
});
export type AnalystVariable = z.infer<typeof analystVariableSchema>;

export const analystReportSchema = z.object({
  repoKind: repoKindSchema,
  /** 一句话说明这个仓库能提供什么视觉能力。 */
  capabilitySummary: z.string().min(1).max(500),
  rules: z.array(analystRuleSchema).max(60),
  variables: z.array(analystVariableSchema).max(24),
  /** 参考图相对路径与建议角色。 */
  referenceImages: z.array(z.object({
    path: z.string().max(1024),
    role: imageRoleSchema,
  })).max(24).default([]),
  /** 无法在 Musefold 内还原的能力，必须诚实列出（规范 §1.2-5）。 */
  unsupported: z.array(z.string().max(300)).max(24).default([]),
  license: z.string().max(256).optional(),
});
export type AnalystReport = z.infer<typeof analystReportSchema>;

// ---------------------------------------------------------------------------
// Scheme Compiler
// ---------------------------------------------------------------------------

export const compilerInputSlotSchema = z.object({
  label: z.string().min(1).max(80),
  kind: inputKindSchema,
  required: z.boolean(),
  /** 文本类输入绑定的模板变量名（promptProgram 里 {{variable}} 的 variable）。 */
  variable: z.string().max(64).optional(),
  imageRole: imageRoleSchema.optional(),
  preserve: z.enum(['high', 'medium', 'low']).optional(),
  description: z.string().max(300).optional(),
});

export const compilerConstraintSchema = z.object({
  domain: constraintDomainSchema,
  statement: z.string().min(1).max(600),
  mode: constraintModeSchema,
  userOverridable: z.boolean(),
  evidencePaths: z.array(z.string().max(1024)).max(8).default([]),
});

export const compilerPromptModuleSchema = z.object({
  kind: promptModuleKindSchema,
  template: z.string().min(1).max(4000),
  variables: z.array(z.string().max(64)).max(32).default([]),
});

export const compilerOutputSchema = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  fidelity: fidelitySchema,
  inputs: z.array(compilerInputSlotSchema).min(1).max(24),
  constraints: z.array(compilerConstraintSchema).max(60),
  promptProgram: z.array(compilerPromptModuleSchema).min(1).max(40),
  adopted: z.array(z.string().max(300)).max(40).default([]),
  omitted: z.array(z.string().max(300)).max(40).default([]),
  warnings: z.array(z.string().max(300)).max(40).default([]),
  /** 面向用户的创建说明：采用了什么、需要提供什么、下一步试运行。 */
  creationSummary: z.string().min(1).max(1200),
});
export type CompilerOutput = z.infer<typeof compilerOutputSchema>;
