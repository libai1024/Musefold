import {
  analystReportSchema,
  compilerOutputSchema,
  designSchemeRevisionDocumentSchema,
  type AnalystReport,
  type SourceSnapshot,
  type CompilerOutput,
} from '@musefold/contracts';

export class CloudCompilerValidationError extends Error {
  constructor() {
    super('Invalid design scheme model output or source evidence');
  }
}
function fail(): never {
  throw new CloudCompilerValidationError();
}

/** A model can cite only files in the exact confirmed snapshot, never an invented filesystem path. */
export function validateCloudAnalystReport(
  value: unknown,
  snapshot: SourceSnapshot,
): AnalystReport {
  const report = analystReportSchema.parse(value);
  const text = new Set(
    snapshot.files.filter((file) => file.kind === 'text').map((file) => file.relativePath),
  );
  const images = new Set(
    snapshot.files.filter((file) => file.kind === 'image').map((file) => file.relativePath),
  );
  if (
    report.rules.some(
      (rule) =>
        rule.evidencePaths.length === 0 || rule.evidencePaths.some((path) => !text.has(path)),
    )
  )
    fail();
  if (report.referenceImages.some((image) => !images.has(image.path))) fail();
  return report;
}

/** Assign runtime IDs and validate a runnable template; model output alone is not a saved revision. */
export function buildCloudCompiledDocument(
  raw: unknown,
  sources: SourceSnapshot[],
  identity: { schemeId: string; revisionId: string; now: string; model: string; brief: string },
) {
  const output: CompilerOutput = compilerOutputSchema.parse(raw);
  if (output.fidelity === 'verified' || (!sources.length && output.fidelity === 'faithful')) fail();
  const variables = new Set<string>();
  for (const input of output.inputs) {
    if (['text', 'article', 'choice'].includes(input.kind)) {
      if (
        !input.variable ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(input.variable) ||
        variables.has(input.variable)
      )
        fail();
      variables.add(input.variable);
      if (input.imageRole) fail();
    } else if (!input.imageRole || input.variable) fail();
  }
  const used = new Set(variables);
  const inputs = output.inputs.map((input, index) => {
    let id = input.variable;
    if (!id) {
      id = `image_${index + 1}`;
      while (used.has(id)) id += '_i';
      used.add(id);
    }
    return {
      id,
      label: input.label,
      kind: input.kind,
      required: input.required,
      ...(input.imageRole ? { imageRole: input.imageRole } : {}),
      ...(input.preserve ? { preserve: input.preserve } : {}),
      ...(input.description ? { description: input.description } : {}),
    };
  });
  const kinds = new Set(output.promptProgram.map((module) => module.kind));
  if (!kinds.has('input-template') || !kinds.has('style-rule')) fail();
  for (const module of output.promptProgram) {
    const matches = [...module.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(
      (match) => match[1],
    );
    const actual = [...new Set(matches)].sort();
    if (
      matches.some((variable) => !variables.has(variable)) ||
      new Set(module.variables).size !== module.variables.length ||
      JSON.stringify([...module.variables].sort()) !== JSON.stringify(actual)
    )
      fail();
    // Reject unmatched/nested placeholders instead of silently compiling unresolved input.
    if (/[{}]{2}/.test(module.template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ''))) fail();
  }
  const referenced = new Set(output.promptProgram.flatMap((module) => module.variables));
  if ([...variables].some((variable) => !referenced.has(variable))) fail();
  const bindings = sources.map((snapshot, index) => ({
    id: `source_${index + 1}`,
    kind:
      snapshot.kind === 'github'
        ? ('github-skill' as const)
        : snapshot.kind === 'history'
          ? ('history-image' as const)
          : ('user-brief' as const),
    role:
      snapshot.kind === 'github'
        ? ('normative' as const)
        : snapshot.kind === 'history'
          ? ('example' as const)
          : ('context' as const),
    uri: snapshot.repositoryUrl ?? snapshot.repositoryUri ?? snapshot.uri ?? undefined,
    ref: snapshot.resolvedRef ?? snapshot.ref ?? undefined,
    commit: snapshot.commitHash ?? snapshot.commit ?? undefined,
    contentHash: snapshot.contentHash ?? undefined,
    packageId: snapshot.packageId,
    snapshotId: snapshot.id,
  }));
  const constraints = output.constraints.map((constraint, index) => {
    const matched = bindings.filter((_, sourceIndex) =>
      constraint.evidencePaths.some((path) =>
        sources[sourceIndex].files.some(
          (file) => file.kind === 'text' && file.relativePath === path,
        ),
      ),
    );
    if (
      constraint.evidencePaths.some(
        (path) =>
          !sources.some((source) =>
            source.files.some((file) => file.kind === 'text' && file.relativePath === path),
          ),
      )
    )
      fail();
    return {
      id: `constraint_${index + 1}`,
      domain: constraint.domain,
      statement: constraint.statement,
      mode: constraint.mode,
      userOverridable: constraint.userOverridable,
      sourceIds: matched.map((source) => source.id),
    };
  });
  return designSchemeRevisionDocumentSchema.parse({
    schemaVersion: 1,
    schemeId: identity.schemeId,
    revisionId: identity.revisionId,
    name: output.name,
    summary: output.summary,
    fidelity: output.fidelity,
    sources: [
      ...bindings,
      ...(identity.brief.trim()
        ? [{ id: 'source_brief', kind: 'user-brief', role: 'context' }]
        : []),
    ],
    sourceSnapshotIds: sources.map((source) => source.id),
    assetIds: [],
    inputs,
    parameters: [],
    constraints,
    promptProgram: output.promptProgram.map((module, index) => ({
      ...module,
      id: `module_${index + 1}`,
      order: index,
      sourceIds: bindings.map((source) => source.id),
    })),
    compilation: {
      compiledAt: identity.now,
      model: { model: identity.model },
      adopted: output.adopted,
      omitted: output.omitted,
      warnings: output.warnings,
      briefExcerpt: identity.brief.slice(0, 600),
      trace: [],
    },
    createdAt: identity.now,
    createdBy: 'agent',
    parentRevisionId: null,
  });
}
