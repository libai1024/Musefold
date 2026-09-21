/** Desktop compatibility entry point; legacy document shapes live in shared contracts. */
import { z } from 'zod';
import {
  legacyFidelitySchema as fidelitySchema,
  legacySchemeStatusSchema as schemeStatusSchema,
  legacyDesignSchemeRevisionDocumentSchema as designSchemeRevisionDocumentSchema,
  type LegacyDesignSchemeRevisionDocument as DesignSchemeRevisionDocument,
} from '@musefold/contracts';
export {
  LEGACY_DESIGN_SCHEME_DOCUMENT_VERSION as DESIGN_SCHEME_DOCUMENT_VERSION,
  legacyFidelitySchema as fidelitySchema,
  legacySchemeStatusSchema as schemeStatusSchema,
  legacySourceKindSchema as sourceKindSchema,
  legacySourceRoleSchema as sourceRoleSchema,
  legacyInputKindSchema as inputKindSchema,
  legacyImageRoleSchema as imageRoleSchema,
  legacyConstraintDomainSchema as constraintDomainSchema,
  legacyConstraintModeSchema as constraintModeSchema,
  legacyPromptModuleKindSchema as promptModuleKindSchema,
  legacySourceBindingSchema as sourceBindingSchema,
  legacyInputSlotSchema as inputSlotSchema,
  legacyParameterDefinitionSchema as parameterDefinitionSchema,
  legacyDesignConstraintSchema as designConstraintSchema,
  legacyPromptModuleSchema as promptModuleSchema,
  legacyCompilationTraceItemSchema as compilationTraceItemSchema,
  legacyCompilationRecordSchema as compilationRecordSchema,
  legacyDesignSchemeRevisionDocumentSchema as designSchemeRevisionDocumentSchema,
  type LegacyFidelity as Fidelity,
  type LegacySchemeStatus as SchemeStatus,
  type LegacySourceKind as SourceKind,
  type LegacySourceRole as SourceRole,
  type LegacyInputKind as InputKind,
  type LegacyImageRole as ImageRole,
  type LegacyConstraintDomain as ConstraintDomain,
  type LegacyConstraintMode as ConstraintMode,
  type LegacyPromptModuleKind as PromptModuleKind,
  type LegacySourceBinding as SourceBinding,
  type LegacyInputSlot as InputSlot,
  type LegacyParameterDefinition as ParameterDefinition,
  type LegacyDesignConstraint as DesignConstraint,
  type LegacyPromptModule as PromptModule,
  type LegacyCompilationTraceItem as CompilationTraceItem,
  type LegacyCompilationRecord as CompilationRecord,
  type LegacyDesignSchemeRevisionDocument as DesignSchemeRevisionDocument,
} from '@musefold/contracts';

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

export function parseDesignSchemeRevisionDocument(
  candidate: unknown,
): DomainParseResult<DesignSchemeRevisionDocument> {
  return toParseResult(designSchemeRevisionDocumentSchema, candidate);
}

export function parseDesignScheme(candidate: unknown): DomainParseResult<DesignScheme> {
  return toParseResult(designSchemeSchema, candidate);
}
