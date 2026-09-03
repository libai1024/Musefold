import { z } from 'zod';

import { isoDateTimeSchema, paginationCursorSchema, queryIntegerSchema } from './common';
import {
  generationAspectRatioSchema,
  generationQualitySchema,
  generationSizeSchema,
  MAX_REFERENCE_IMAGES,
  promptReferenceSelectionsSchema,
} from './generation';

/** The first path-free shared design-scheme document version. */
export const DESIGN_SCHEME_DOCUMENT_VERSION = 1 as const;
export const DESIGN_SCHEME_SCHEMA_VERSION = DESIGN_SCHEME_DOCUMENT_VERSION;
/** Package evolution is independent from the immutable revision document schema. */
export const LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION = 1 as const;
export const DESIGN_SCHEME_PACKAGE_FORMAT_VERSION = 2 as const;
export const designSchemePackageFormatVersionSchema = z.union([
  z.literal(LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION),
  z.literal(DESIGN_SCHEME_PACKAGE_FORMAT_VERSION),
]);
export const canonicalDesignSchemePackageFormatVersionSchema = z.literal(
  DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
);

const MAX_TEXT_LENGTH = 12_000;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_SAFE_TIMESTAMP = 9_007_199_254_740_991;
const MAX_SAFE_DEFAULT_DEPTH = 32;
const MAX_SAFE_DEFAULT_NODES = 4_096;

/** IDs are references only; they never encode a path, URL, or storage key. */
export const opaqueIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'Expected an opaque identifier');

export const designSchemeVersionSchema = z.number().int().positive().max(1_000_000);
const designSchemeEpochDateSchema = z.number().int().nonnegative().max(MAX_SAFE_TIMESTAMP);
export const designSchemeDateTimeSchema = z.union([
  isoDateTimeSchema.max(64),
  designSchemeEpochDateSchema,
]);
export const designSchemeHashSchema = z
  .string()
  .trim()
  .regex(/^(?:sha256:)?[0-9a-f]{64}$/i, 'Expected a SHA-256 content hash');
export const sourceCommitSchema = z
  .string()
  .trim()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i, 'Expected a resolved commit hash');
export const resolvedRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !isForbiddenLocalPath(value), 'Expected a safe resolved ref')
  .refine((value) => !value.includes('\\'), 'Resolved refs must use forward slashes')
  .refine(
    (value) => !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value),
    'Resolved refs must not be URIs',
  );
export const sourceRefSchema = resolvedRefSchema;

const unsafeFieldNames = new Set([
  'apikey',
  'authorization',
  'bearer',
  'bearertoken',
  'credential',
  'credentials',
  'oauth',
  'oauthtoken',
  'ownerid',
  'password',
  'passwd',
  'path',
  'privatekey',
  'secret',
  'secrets',
  'signingkey',
  'signature',
  'storekey',
  'token',
  'workspaceid',
  'filepath',
  'imagepath',
  'coverimagepath',
  'targetpath',
  'absolutepath',
  'accesskey',
  'accesskeyid',
  'openaikey',
  'sessionkey',
  'sessionpartition',
  'sessionpartitionid',
  'constructor',
  'prototype',
  'proto',
]);

function normalizedFieldName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isUnsafeFieldName(value: string): boolean {
  const normalized = normalizedFieldName(value);
  // OpenAI-style generation parameters are safe; ordinary token-bearing keys are not.
  if (normalized === 'maxtokens') return false;
  if (unsafeFieldNames.has(normalized)) return true;
  return (
    normalized.includes('authorization') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('privatekey') ||
    normalized.includes('secret') ||
    normalized.includes('ownerid') ||
    normalized.includes('workspaceid') ||
    normalized.includes('sessionpartition') ||
    normalized.includes('signature') ||
    normalized.includes('accesskey') ||
    normalized === 'sig' ||
    normalized.includes('token') ||
    (normalized.startsWith('api') && normalized.includes('key'))
  );
}

function hasUnsafeUriParameter(parsed: URL): boolean {
  for (const key of parsed.searchParams.keys()) {
    if (isUnsafeFieldName(key)) return true;
  }
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  for (const key of new URLSearchParams(fragment).keys()) {
    if (isUnsafeFieldName(key)) return true;
  }
  return false;
}

/** Reject Unix, Windows, UNC, URI and traversal forms of local paths. */
export function isForbiddenLocalPath(value: string): boolean {
  if (value.includes('\0')) return true;
  const candidates = [value];
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) candidates.push(decoded);
  } catch {
    return true;
  }
  return candidates.some((candidate) => {
    if (/^(?:file|media):\/\//i.test(candidate)) return true;
    if (candidate.startsWith('/') || candidate.startsWith('\\')) return true;
    if (/^[A-Za-z]:/.test(candidate)) return true;
    if (/^~(?:[\\/]|$)/.test(candidate)) return true;
    return candidate.split(/[\\/]/).some((segment) => segment === '..');
  });
}

export const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine((value) => !isForbiddenLocalPath(value), 'Expected a safe relative path')
  .refine((value) => !value.includes('\\'), 'Relative paths must use forward slashes')
  .refine(
    (value) => value.split('/').every((segment) => segment.length > 0 && segment !== '.'),
    'Relative paths cannot contain empty or dot segments',
  );
export const evidencePathSchema = relativePathSchema;

export const httpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === 'https:' &&
        parsed.username === '' &&
        parsed.password === '' &&
        !hasUnsafeUriParameter(parsed)
      );
    } catch {
      return false;
    }
  }, 'URI must use HTTPS and must not contain credentials');

export const httpsRepositoryUriSchema = httpsUriSchema.refine((value) => {
  const parsed = new URL(value);
  return parsed.search === '' && parsed.hash === '' && parsed.pathname !== '/';
}, 'Repository URI must not contain query parameters or fragments');

export const designSchemeMimeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/);

const safeTextSchema = z
  .string()
  .trim()
  .max(MAX_TEXT_LENGTH)
  .refine((value) => !isForbiddenLocalPath(value), 'Text must not contain a local path');
const safeMetadataTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !isForbiddenLocalPath(value), 'Metadata must not contain a local path');
const nonNegativeIntegerSchema = z.number().int().nonnegative().max(MAX_SAFE_TIMESTAMP);
const positiveIntegerSchema = z.number().int().positive().max(MAX_SAFE_TIMESTAMP);

function inspectSecureTree(
  value: unknown,
  path: (string | number)[],
  addIssue: (path: (string | number)[], message: string) => void,
): void {
  const stack: Array<{ value: unknown; path: (string | number)[]; depth: number }> = [
    { value, path, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    nodes += 1;
    if (nodes > MAX_SAFE_DEFAULT_NODES) {
      addIssue(current.path, 'Parameter defaults contain too many values');
      return;
    }
    if (current.depth > MAX_SAFE_DEFAULT_DEPTH) {
      addIssue(current.path, 'Parameter defaults are nested too deeply');
      continue;
    }

    if (current.value === null || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value) || Math.abs(current.value) > MAX_SAFE_TIMESTAMP) {
        addIssue(current.path, 'Parameter defaults contain an unsafe number');
      }
      continue;
    }
    if (typeof current.value === 'string') {
      if (current.value.length > 8_000) {
        addIssue(current.path, 'Parameter default strings are too long');
      }
      if (isForbiddenLocalPath(current.value)) {
        addIssue(current.path, 'Local paths and file URLs are not allowed');
      }
      continue;
    }
    if (typeof current.value !== 'object') {
      addIssue(current.path, 'Parameter defaults only support JSON values');
      continue;
    }
    if (seen.has(current.value)) {
      addIssue(current.path, 'Parameter defaults must not contain cycles');
      continue;
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.value.length > 64) {
        addIssue(current.path, 'Parameter default arrays are too large');
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          path: [...current.path, index],
          depth: current.depth + 1,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      addIssue(current.path, 'Parameter defaults only support JSON objects');
      continue;
    }
    const entries = Object.entries(current.value);
    if (entries.length > 64) {
      addIssue(current.path, 'Parameter default objects are too large');
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      const childPath = [...current.path, key];
      if (key.trim() !== key || key.length < 1 || key.length > 80) {
        addIssue(childPath, 'Parameter default keys must be bounded and trimmed');
      }
      if (isUnsafeFieldName(key)) addIssue(childPath, 'Sensitive fields are not allowed');
      stack.push({ value: child, path: childPath, depth: current.depth + 1 });
    }
  }
}

/* This is intentionally the only open recursive value in the module: parameter defaults. */
export type SafeParameterDefault =
  | null
  | boolean
  | number
  | string
  | SafeParameterDefault[]
  | { [key: string]: SafeParameterDefault };
const safeDefaultValueSchema: z.ZodType<SafeParameterDefault> = z
  .any()
  .superRefine((value, ctx) => {
    inspectSecureTree(value, [], (path, message) =>
      ctx.addIssue({ code: 'custom', path, message }),
    );
  }) as z.ZodType<SafeParameterDefault>;
export const safeParameterDefaultSchema = safeDefaultValueSchema;

export const fidelitySchema = z.enum(['verified', 'faithful', 'adapted', 'unsupported']);
export const schemeStatusSchema = z.enum(['draft', 'formal']);
export const sourceKindSchema = z.enum([
  'github-skill',
  'github-prompt-repo',
  'github-readme',
  'history-image',
  'conversation-turn',
  'user-brief',
  'reference-image',
]);
export const sourceRoleSchema = z.enum(['normative', 'reference', 'example', 'context']);
export const sourcePackageKindSchema = z.enum(['github', 'history', 'user-brief', 'share-import']);
export const inputKindSchema = z.enum(['text', 'image', 'image-set', 'article', 'choice']);
export const imageRoleSchema = z.enum([
  'edit-target',
  'subject-reference',
  'style-reference',
  'layout-reference',
  'content-reference',
]);
export const constraintDomainSchema = z.enum([
  'composition',
  'color',
  'typography',
  'texture',
  'subject',
  'output',
  'safety',
]);
export const constraintModeSchema = z.enum(['required', 'preferred', 'avoid']);
export const promptModuleKindSchema = z.enum([
  'system-rule',
  'input-template',
  'style-rule',
  'negative-rule',
  'quality-rule',
]);

/** `ref` is always the resolved, immutable source ref, never a moving branch request. */
export const sourceBindingSchema = z
  .object({
    id: opaqueIdSchema,
    kind: sourceKindSchema,
    role: sourceRoleSchema,
    uri: httpsUriSchema.optional(),
    repositoryUrl: httpsRepositoryUriSchema.optional(),
    packageId: opaqueIdSchema.optional(),
    snapshotId: opaqueIdSchema.optional(),
    /** Canonical shared names. */
    resolvedRef: resolvedRefSchema.optional(),
    commitHash: sourceCommitSchema.nullable().optional(),
    contentHash: designSchemeHashSchema.nullable().optional(),
    hash: designSchemeHashSchema.nullable().optional(),
    /** Legacy safe aliases retained only for semantic migration. */
    ref: sourceRefSchema.optional(),
    commit: sourceCommitSchema.nullable().optional(),
    relativePath: relativePathSchema.optional(),
    evidencePath: evidencePathSchema.optional(),
    license: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.resolvedRef !== undefined &&
      value.ref !== undefined &&
      value.resolvedRef !== value.ref
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ref'],
        message: 'Resolved ref aliases must agree',
      });
    }
    if (
      value.commitHash !== undefined &&
      value.commit !== undefined &&
      value.commitHash !== value.commit
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['commit'],
        message: 'Commit aliases must agree',
      });
    }
  });
export const designSchemeSourceBindingSchema = sourceBindingSchema;

export const sourcePackageSchema = z
  .object({
    id: opaqueIdSchema,
    kind: sourcePackageKindSchema,
    uri: httpsRepositoryUriSchema.nullable().optional(),
    repositoryUri: httpsRepositoryUriSchema.nullable().optional(),
    repositoryUrl: httpsRepositoryUriSchema.nullable().optional(),
    resolvedRef: resolvedRefSchema.nullable().optional(),
    ref: sourceRefSchema.nullable().optional(),
    commitHash: sourceCommitSchema.nullable().optional(),
    commit: sourceCommitSchema.nullable().optional(),
    contentHash: designSchemeHashSchema.nullable().optional(),
    hash: designSchemeHashSchema.nullable().optional(),
    license: z.string().trim().min(1).max(256).nullable(),
    createdAt: designSchemeDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const uris = [value.uri, value.repositoryUri, value.repositoryUrl].filter(
      (uri): uri is string | null => uri !== undefined,
    );
    if (new Set(uris).size > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['repositoryUrl'],
        message: 'Source URI aliases must agree',
      });
    }
    if (
      value.resolvedRef !== undefined &&
      value.ref !== undefined &&
      value.resolvedRef !== value.ref
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ref'],
        message: 'Resolved ref aliases must agree',
      });
    }
    if (
      value.commitHash !== undefined &&
      value.commit !== undefined &&
      value.commitHash !== value.commit
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['commit'],
        message: 'Commit aliases must agree',
      });
    }
  });
export const sourcePackageMetadataSchema = sourcePackageSchema;

/** Installation confirmation contains metadata only; file names are repository-relative. */
export const sourceConfirmationSchema = z
  .object({
    repositoryUrl: httpsUriSchema,
    name: z.string().trim().min(1).max(160),
    description: safeTextSchema.max(1_000),
    resolvedRef: resolvedRefSchema,
    commitHash: sourceCommitSchema.nullable(),
    textFileCount: nonNegativeIntegerSchema,
    textNames: z.array(relativePathSchema).max(100),
    imageFileCount: nonNegativeIntegerSchema,
    license: z.string().trim().min(1).max(256).nullable(),
  })
  .strict();

export const sourceFileMetadataSchema = z
  .object({
    relativePath: relativePathSchema,
    kind: z.enum(['text', 'image', 'other']),
    mimeType: designSchemeMimeSchema.nullable(),
    sizeBytes: nonNegativeIntegerSchema,
    contentHash: designSchemeHashSchema,
    evidencePath: evidencePathSchema.nullable(),
    textExcerpt: safeTextSchema.max(2_000).nullable(),
  })
  .strict();
export const designSchemeSourceFileSchema = sourceFileMetadataSchema;

export const sourceSnapshotSchema = z
  .object({
    id: opaqueIdSchema,
    packageId: opaqueIdSchema,
    kind: sourcePackageKindSchema,
    uri: httpsUriSchema.nullable().optional(),
    repositoryUri: httpsUriSchema.nullable().optional(),
    repositoryUrl: httpsUriSchema.nullable().optional(),
    resolvedRef: resolvedRefSchema.optional(),
    ref: sourceRefSchema.optional(),
    commitHash: sourceCommitSchema.nullable().optional(),
    commit: sourceCommitSchema.nullable().optional(),
    contentHash: designSchemeHashSchema.nullable().optional(),
    totalBytes: nonNegativeIntegerSchema,
    files: z.array(sourceFileMetadataSchema).max(500),
    createdAt: designSchemeDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const uris = [value.uri, value.repositoryUri, value.repositoryUrl].filter(
      (uri): uri is string | null => uri !== undefined,
    );
    if (new Set(uris).size > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['repositoryUrl'],
        message: 'Source URI aliases must agree',
      });
    }
    if (
      value.resolvedRef !== undefined &&
      value.ref !== undefined &&
      value.resolvedRef !== value.ref
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ref'],
        message: 'Resolved ref aliases must agree',
      });
    }
    if (
      value.commitHash !== undefined &&
      value.commit !== undefined &&
      value.commitHash !== value.commit
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['commit'],
        message: 'Commit aliases must agree',
      });
    }
    if (value.resolvedRef === undefined && value.ref === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolvedRef'],
        message: 'A source snapshot needs a resolved ref',
      });
    }
  });
export const designSchemeSourceSnapshotSchema = sourceSnapshotSchema;
export const sourceSnapshotMetadataSchema = sourceSnapshotSchema;

export const inputSlotSchema = z
  .object({
    id: opaqueIdSchema,
    label: z.string().trim().min(1).max(80),
    kind: inputKindSchema,
    required: z.boolean(),
    minItems: z.number().int().min(0).max(64).optional(),
    maxItems: z.number().int().min(1).max(64).optional(),
    imageRole: imageRoleSchema.optional(),
    preserve: z.enum(['high', 'medium', 'low']).optional(),
    description: safeTextSchema.max(300).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.minItems !== undefined &&
      value.maxItems !== undefined &&
      value.minItems > value.maxItems
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['minItems'],
        message: 'minItems must not exceed maxItems',
      });
    }
    if (value.kind !== 'image' && value.kind !== 'image-set' && value.imageRole !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['imageRole'],
        message: 'imageRole requires an image slot',
      });
    }
  });

export const parameterDefinitionSchema = z
  .object({
    id: opaqueIdSchema,
    label: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'select', 'multi-select', 'boolean', 'color', 'ratio', 'number']),
    defaultValue: safeDefaultValueSchema.optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
    userEditable: z.boolean(),
  })
  .strict();

export const designConstraintSchema = z
  .object({
    id: opaqueIdSchema,
    domain: constraintDomainSchema,
    statement: safeTextSchema.max(600),
    mode: constraintModeSchema,
    sourceIds: z.array(opaqueIdSchema).max(32),
    evidencePath: evidencePathSchema.optional(),
    userOverridable: z.boolean(),
  })
  .strict();
export const constraintsSchema = z.array(designConstraintSchema).max(60);

export const promptModuleSchema = z
  .object({
    id: opaqueIdSchema,
    order: z.number().int().min(0).max(1_000),
    kind: promptModuleKindSchema,
    template: z.string().trim().min(1).max(4_000),
    variables: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
      )
      .max(32),
    sourceIds: z.array(opaqueIdSchema).max(32),
  })
  .strict();
export const promptProgramSchema = z.array(promptModuleSchema).min(1).max(40);
export const promptProgramModuleSchema = promptModuleSchema;

export const compilationTraceItemSchema = z
  .object({
    id: opaqueIdSchema,
    kind: z.enum(['tool', 'assistant', 'system']).default('system'),
    title: z.string().trim().min(1).max(120),
    detail: safeTextSchema.max(600).optional(),
    output: safeTextSchema.max(4_000).optional(),
    status: z.enum(['running', 'success', 'warning', 'error']),
    durationMs: nonNegativeIntegerSchema.optional(),
  })
  .strict();
export const designSchemeCreationTraceItemSchema = compilationTraceItemSchema;
export const compilationTraceSchema = z.array(compilationTraceItemSchema).max(60);
export const compileTraceSchema = compilationTraceSchema;

export const compilationRecordSchema = z
  .object({
    compiledAt: designSchemeDateTimeSchema,
    compilerVersion: z.string().trim().min(1).max(80).optional(),
    model: z
      .object({
        model: z.string().trim().min(1).max(200),
        connectionName: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    adopted: z.array(safeTextSchema.max(300)).max(40),
    omitted: z.array(safeTextSchema.max(300)).max(40),
    warnings: z.array(safeTextSchema.max(300)).max(40),
    briefExcerpt: safeTextSchema.max(600).optional(),
    trace: z.array(compilationTraceItemSchema).max(60),
  })
  .strict();

/** Immutable revision document. The optional additions default cleanly for old documents. */
export const designSchemeRevisionDocumentSchema = z
  .object({
    schemaVersion: z.literal(DESIGN_SCHEME_DOCUMENT_VERSION),
    revisionId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    name: z.string().trim().min(1).max(120),
    summary: safeTextSchema.max(500),
    fidelity: fidelitySchema,
    sources: z.array(sourceBindingSchema).max(32),
    sourceSnapshotIds: z.array(opaqueIdSchema).max(32).default([]),
    inputs: z.array(inputSlotSchema).max(24),
    parameters: z.array(parameterDefinitionSchema).max(24),
    constraints: constraintsSchema,
    promptProgram: promptProgramSchema,
    assetIds: z.array(opaqueIdSchema).max(128).default([]),
    compilation: compilationRecordSchema,
    /** Revision rows are append-only; a non-null parent records the revision it supersedes. */
    parentRevisionId: opaqueIdSchema.nullable().optional(),
    createdBy: z.enum(['agent', 'user', 'import']).default('agent'),
    createdAt: designSchemeDateTimeSchema.optional(),
  })
  .strict();
export const designSchemeDocumentSchema = designSchemeRevisionDocumentSchema;
export const schemeRevisionDocumentSchema = designSchemeRevisionDocumentSchema;
export const designSchemeRevisionSchema = designSchemeRevisionDocumentSchema;

export const designSchemeSummarySchema = z
  .object({
    id: opaqueIdSchema,
    name: z.string().trim().min(1).max(120),
    summary: safeTextSchema.max(500),
    status: schemeStatusSchema,
    sourcePresentation: z.enum(['skill', 'musefold-created']),
    sourceLabel: z.string().trim().min(1).max(160).default(''),
    currentRevisionId: opaqueIdSchema,
    version: designSchemeVersionSchema.default(1),
    workingDraftRevisionId: opaqueIdSchema.nullable().default(null),
    coverAssetId: opaqueIdSchema.nullable().default(null),
    fidelity: fidelitySchema,
    inputLabels: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
    hasSuccessfulTrial: z.boolean().default(false),
    lastRunAt: designSchemeDateTimeSchema.nullable().default(null),
    createdAt: designSchemeDateTimeSchema,
    updatedAt: designSchemeDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'formal' && (!value.coverAssetId || !value.hasSuccessfulTrial)) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'A formal scheme needs a successful trial and a cover asset',
      });
    }
  });

export const schemeSummarySchema = designSchemeSummarySchema;
export const designSchemeSchema = designSchemeSummarySchema;

export const assetOriginSchema = z.enum(['repository', 'local-run']);
export const assetRoleSchema = z.enum(['cover', 'example', 'reference', 'output']);
export const outputRoleSchema = z.enum(['primary', 'variant']);
const assetMetadataFields = {
  id: opaqueIdSchema,
  origin: assetOriginSchema,
  mimeType: designSchemeMimeSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
  byteSize: nonNegativeIntegerSchema,
  contentHash: designSchemeHashSchema,
  role: assetRoleSchema,
  license: z.string().trim().min(1).max(256).nullable(),
  createdAt: designSchemeDateTimeSchema,
};

export const designSchemeAssetSchema = z.object(assetMetadataFields).strict();
export const assetMetadataSchema = designSchemeAssetSchema;
export const designSchemeAssetMetadataSchema = assetMetadataSchema;
export const referenceAssetMetadataSchema = z.object(assetMetadataFields).strict();
export const runOutputMetadataSchema = z
  .object({ ...assetMetadataFields, role: outputRoleSchema, runId: opaqueIdSchema })
  .strict()
  .refine((value) => value.origin === 'local-run', {
    path: ['origin'],
    message: 'Run outputs must be local-run assets',
  });
export const outputMetadataSchema = runOutputMetadataSchema;

export const designSchemeDetailRevisionSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current') }).strict(),
  z
    .object({
      kind: z.literal('working-draft'),
      revisionId: opaqueIdSchema,
    })
    .strict(),
]);
export const designSchemeDetailInputSchema = z
  .object({
    id: opaqueIdSchema,
    revision: designSchemeDetailRevisionSelectorSchema.default({ kind: 'current' }),
  })
  .strict();

export const designSchemeDetailSchema = z
  .object({
    summary: designSchemeSummarySchema,
    document: designSchemeRevisionDocumentSchema,
    assets: z.array(designSchemeAssetSchema).max(128),
    sourceSnapshots: z.array(sourceSnapshotSchema).max(32),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.document.schemeId !== value.summary.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'schemeId'],
        message: 'Detail document scheme mismatch',
      });
    }
    const visibleRevisionIds = new Set([
      value.summary.currentRevisionId,
      value.summary.workingDraftRevisionId,
    ]);
    if (!visibleRevisionIds.has(value.document.revisionId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'revisionId'],
        message: 'Detail document must be the current revision or working draft',
      });
    }
  });
export const schemeDetailSchema = designSchemeDetailSchema;

/** Package entries describe archive content without exposing host file locations. */
export const sharePackageContentEntrySchema = z
  .object({
    relativePath: relativePathSchema,
    kind: z.enum(['revision-document', 'source-file', 'asset']),
    contentHash: designSchemeHashSchema,
    sizeBytes: nonNegativeIntegerSchema.max(MAX_PACKAGE_ENTRY_BYTES),
    mimeType: designSchemeMimeSchema.nullable(),
    sourceId: opaqueIdSchema.nullable().optional(),
    assetId: opaqueIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'source-file' && !value.sourceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceId'],
        message: 'Source-file entries need a source identifier',
      });
    }
    if (value.kind === 'asset' && !value.assetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'Asset entries need an asset identifier',
      });
    }
  });

export const sharePackageContentMetadataSchema = z
  .object({
    contentHash: designSchemeHashSchema,
    sizeBytes: positiveIntegerSchema,
    entries: z.array(sharePackageContentEntrySchema).max(1_024),
  })
  .strict();

/** Formal exports contain a frozen revision and path-free metadata only. */
export const sharePackageManifestSchema = z
  .object({
    packageId: opaqueIdSchema,
    format: z.literal('musefold.design'),
    formatVersion: canonicalDesignSchemePackageFormatVersionSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    status: z.literal('formal'),
    document: designSchemeRevisionDocumentSchema,
    sourceSnapshots: z.array(sourceSnapshotSchema).max(32),
    assets: z.array(designSchemeAssetSchema).max(128),
    content: sharePackageContentMetadataSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.document.schemeId !== value.schemeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'schemeId'],
        message: 'Manifest document scheme mismatch',
      });
    }
    if (value.document.revisionId !== value.revisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'revisionId'],
        message: 'Manifest document revision mismatch',
      });
    }
    if (value.status !== 'formal' || value.document.fidelity === 'unsupported') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Only supported formal revisions can be exported',
      });
    }
  });
export const designSchemeSharePackageManifestSchema = sharePackageManifestSchema;
export const designSchemeSharePackageContentSchema = sharePackageContentMetadataSchema;

export const creationStateSchema = z.enum([
  'created',
  'source_resolving',
  'awaiting_install_confirmation',
  'source_snapshotting',
  'analyzing',
  'compiling_scheme',
  'draft_ready',
  'awaiting_user_trial',
  'planning_run',
  'executing',
  'evaluating',
  'repairing',
  'trial_completed',
  'completed',
  'blocked',
  'failed',
  'cancelled',
]);
export const designSchemeCreationStateSchema = creationStateSchema;
export const runModeSchema = z.enum(['trial', 'formal']);
export const designSchemeRunModeSchema = runModeSchema;
export const runStatusSchema = z.enum([
  'planning',
  'executing',
  'evaluating',
  'completed',
  'blocked',
  'failed',
  'cancelled',
]);
export const runStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const priorityModeSchema = z.enum(['user_first', 'scheme_first', 'agent_mediated']);
export const schemePriorityModeSchema = priorityModeSchema;

export const structuredDesignSchemeErrorSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_.-]{1,79}$/),
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean().default(false),
    recoveryAction: z
      .enum(['retry', 'edit-input', 'choose-source', 'choose-provider', 'configure-ai', 'none'])
      .default('none'),
  })
  .strict();
export const designSchemeErrorSchema = structuredDesignSchemeErrorSchema;

export const runPolicySnapshotSchema = z
  .object({
    priorityMode: priorityModeSchema,
    schemeRevisionId: opaqueIdSchema,
    policyVersion: safeTextSchema.min(1).max(80),
    appliedAt: designSchemeDateTimeSchema,
    summary: safeTextSchema.max(600).optional(),
  })
  .strict();

export const providerSnapshotSchema = z
  .object({
    providerId: opaqueIdSchema,
    providerName: safeMetadataTextSchema.min(1).max(160),
    model: safeMetadataTextSchema.min(1).max(200),
    providerVersion: safeMetadataTextSchema.min(1).max(80).nullable(),
    capabilities: z
      .object({
        text: z.boolean(),
        vision: z.boolean(),
        image: z.boolean(),
        multiImage: z.boolean(),
        editing: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** Host-neutral user execution choices; prompt compilation and credential lookup remain host-owned. */
export const designSchemeRunExecutionSettingsSchema = z
  .object({
    providerId: opaqueIdSchema,
    size: generationSizeSchema,
    aspectRatio: generationAspectRatioSchema.optional(),
    quality: generationQualitySchema,
    negativePrompt: safeTextSchema.max(4_000).optional(),
    outputCount: z.number().int().min(1).max(32),
    referenceAssetIds: z.array(opaqueIdSchema).max(MAX_REFERENCE_IMAGES),
    promptReferenceSelections: promptReferenceSelectionsSchema.superRefine((selections, ctx) => {
      for (const [index, selection] of selections.entries()) {
        const parsed = opaqueIdSchema.safeParse(selection.promptId);
        if (!parsed.success) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'promptId'],
            message: 'Prompt references require opaque identifiers',
          });
        }
      }
    }),
    workbenchSessionId: opaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fixedSizeRatio: Partial<Record<z.infer<typeof generationSizeSchema>, string>> = {
      '1024x1024': '1:1',
      '1536x1024': '3:2',
      '1024x1536': '2:3',
    };
    const expectedRatio = fixedSizeRatio[value.size];
    if (expectedRatio && value.aspectRatio && value.aspectRatio !== expectedRatio) {
      ctx.addIssue({
        code: 'custom',
        path: ['aspectRatio'],
        message: 'Aspect ratio contradicts the selected fixed size',
      });
    }
    if (new Set(value.referenceAssetIds).size !== value.referenceAssetIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: 'Reference asset identifiers must be unique while preserving order',
      });
    }
  });

export const designSchemeRunInputValuesSchema = z
  .record(opaqueIdSchema, safeTextSchema.max(8_000))
  .default({})
  .superRefine((value, ctx) => {
    inspectSecureTree(value, [], (path, message) =>
      ctx.addIssue({ code: 'custom', path, message }),
    );
  });

/** Renderer choices accepted before the host freezes a canonical run plan. */
export const prepareDesignSchemeRunInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    mode: runModeSchema,
    priorityMode: priorityModeSchema.default('scheme_first'),
    brief: safeTextSchema.max(8_000),
    inputValues: designSchemeRunInputValuesSchema,
    executionSettings: designSchemeRunExecutionSettingsSchema,
  })
  .strict();

export const plannedInputSchema = z
  .object({
    slotId: opaqueIdSchema,
    kind: inputKindSchema,
    valueIds: z.array(opaqueIdSchema).max(64),
    text: safeTextSchema.max(8_000).nullable(),
  })
  .strict();

export const workflowStepKindSchema = z.enum([
  'inspect-input',
  'extract-content',
  'select-assets',
  'compile-prompt',
  'generate-image',
  'evaluate-image',
  'repair-image',
  'composite-image',
  'batch',
  'save-output',
]);

export const runStepSchema = z
  .object({
    id: opaqueIdSchema,
    kind: workflowStepKindSchema,
    dependsOn: z.array(opaqueIdSchema).max(32),
    inputRefs: z.array(opaqueIdSchema).max(64),
    outputRefs: z.array(opaqueIdSchema).max(64),
    timeoutMs: positiveIntegerSchema.max(86_400_000),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
        backoffMs: z.number().int().nonnegative().max(86_400_000),
      })
      .strict()
      .optional(),
    status: runStepStatusSchema.default('pending'),
    startedAt: designSchemeDateTimeSchema.nullable().default(null),
    completedAt: designSchemeDateTimeSchema.nullable().default(null),
    error: structuredDesignSchemeErrorSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.maxAttempts && !value.retry) {
      ctx.addIssue({ code: 'custom', path: ['retry'], message: 'A step needs retry settings' });
    }
    if (value.maxAttempts && value.retry && value.maxAttempts !== value.retry.maxAttempts) {
      ctx.addIssue({
        code: 'custom',
        path: ['retry', 'maxAttempts'],
        message: 'Retry aliases must agree',
      });
    }
  });

export const runBudgetSchema = z
  .object({
    maxSteps: z.number().int().positive().max(200),
    maxOutputs: z.number().int().positive().max(32),
    maxRepairRuns: z.number().int().min(0).max(1),
    /** Optional host-neutral cost ceiling; never contains account or credential data. */
    maxCostUnits: z.number().finite().nonnegative().max(MAX_SAFE_TIMESTAMP).optional(),
    currency: z.enum(['points', 'credits', 'usd-micros']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.maxCostUnits === undefined) !== (value.currency === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Cost amount and currency must be provided together',
      });
    }
  });

export const evaluationProfileSchema = z
  .object({
    ratio: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]?:[1-9][0-9]?$/)
      .nullable(),
    requiredChecks: z.array(opaqueIdSchema).max(32),
  })
  .strict();

/** Deliberately has no requestTemplate or any local provider request DTO. */
export const designSchemeRunPlanSchema = z
  .object({
    id: opaqueIdSchema.optional(),
    runId: opaqueIdSchema.optional(),
    schemaVersion: z.literal(DESIGN_SCHEME_DOCUMENT_VERSION),
    schemeRevisionId: opaqueIdSchema,
    sourceSnapshotIds: z.array(opaqueIdSchema).max(32),
    inputs: z.array(plannedInputSchema).max(24),
    steps: z.array(runStepSchema).min(1).max(200),
    provider: providerSnapshotSchema,
    policy: runPolicySnapshotSchema.optional(),
    prioritySnapshot: runPolicySnapshotSchema.optional(),
    budget: runBudgetSchema.optional(),
    budgets: runBudgetSchema.optional(),
    evaluation: evaluationProfileSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.id && !value.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'A run plan needs a run identifier',
      });
    }
    if (value.id && value.runId && value.id !== value.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Run identifier aliases must agree',
      });
    }
    if (!value.policy && !value.prioritySnapshot) {
      ctx.addIssue({
        code: 'custom',
        path: ['prioritySnapshot'],
        message: 'A run plan needs a policy snapshot',
      });
    }
    if (!value.budget && !value.budgets) {
      ctx.addIssue({
        code: 'custom',
        path: ['budgets'],
        message: 'A run plan needs a budget',
      });
    }
    if (value.policy && value.prioritySnapshot) {
      const samePolicy = JSON.stringify(value.policy) === JSON.stringify(value.prioritySnapshot);
      if (!samePolicy) {
        ctx.addIssue({
          code: 'custom',
          path: ['prioritySnapshot'],
          message: 'Policy aliases must agree',
        });
      }
    }
    const policy = value.policy ?? value.prioritySnapshot;
    if (policy && policy.schemeRevisionId !== value.schemeRevisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['prioritySnapshot', 'schemeRevisionId'],
        message: 'Policy revision mismatch',
      });
    }
    if (value.budget && value.budgets) {
      const sameBudget = JSON.stringify(value.budget) === JSON.stringify(value.budgets);
      if (!sameBudget) {
        ctx.addIssue({
          code: 'custom',
          path: ['budgets'],
          message: 'Budget aliases must agree',
        });
      }
    }
  });
export const runPlanSchema = designSchemeRunPlanSchema;

export const repairLineageSchema = z
  .object({
    repairOfRunId: opaqueIdSchema,
    repairEvaluationId: opaqueIdSchema,
    depth: z.literal(1),
    hint: safeTextSchema.max(1_200),
  })
  .strict();

export const evaluationCheckSchema = z
  .object({
    id: opaqueIdSchema,
    label: z.string().trim().min(1).max(120),
    status: z.enum(['pass', 'warn', 'fail']),
    detail: safeTextSchema.max(600).optional(),
    evidenceOutputIds: z.array(opaqueIdSchema).max(64),
  })
  .strict();
export const schemeRunEvaluationCheckSchema = evaluationCheckSchema;

export const runEvaluationSchema = z
  .object({
    evaluationId: opaqueIdSchema,
    runId: opaqueIdSchema,
    passed: z.boolean(),
    checks: z.array(evaluationCheckSchema).max(64),
    repairHint: safeTextSchema.max(1_200).nullable(),
    repair: repairLineageSchema.nullable(),
    createdAt: designSchemeDateTimeSchema,
  })
  .strict();
export const schemeRunEvaluationSchema = runEvaluationSchema;

export const runRecordSchema = z
  .object({
    runId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    schemeStatus: schemeStatusSchema,
    schemeFidelity: fidelitySchema,
    mode: runModeSchema,
    status: runStatusSchema,
    policy: runPolicySnapshotSchema,
    provider: providerSnapshotSchema,
    createdAt: designSchemeDateTimeSchema,
    completedAt: designSchemeDateTimeSchema.nullable(),
    repair: repairLineageSchema.nullable(),
  })
  .strict();

export const designSchemeRunInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    schemeStatus: schemeStatusSchema,
    schemeFidelity: fidelitySchema,
    mode: runModeSchema,
    priorityMode: priorityModeSchema.default('scheme_first'),
    brief: safeTextSchema.max(8_000),
    inputValues: designSchemeRunInputValuesSchema,
    executionSettings: designSchemeRunExecutionSettingsSchema,
    plan: designSchemeRunPlanSchema,
    repair: repairLineageSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.schemeFidelity === 'unsupported') {
      ctx.addIssue({
        code: 'custom',
        path: ['schemeFidelity'],
        message: 'Unsupported schemes cannot run',
      });
    }
    if (value.mode === 'formal' && value.schemeStatus !== 'formal') {
      ctx.addIssue({
        code: 'custom',
        path: ['schemeStatus'],
        message: 'Formal runs require a formal scheme',
      });
    }
    if (value.plan.schemeRevisionId !== value.revisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['plan', 'schemeRevisionId'],
        message: 'Plan revision mismatch',
      });
    }
    if (value.executionSettings.providerId !== value.plan.provider.providerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionSettings', 'providerId'],
        message: 'Execution provider must match the frozen run plan',
      });
    }
    const planBudget = value.plan.budget ?? value.plan.budgets;
    if (planBudget && value.executionSettings.outputCount > planBudget.maxOutputs) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionSettings', 'outputCount'],
        message: 'Output count exceeds the frozen run budget',
      });
    }
    if (
      value.plan.evaluation.ratio &&
      value.executionSettings.aspectRatio &&
      value.plan.evaluation.ratio !== value.executionSettings.aspectRatio
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionSettings', 'aspectRatio'],
        message: 'Execution aspect ratio must match the frozen evaluation profile',
      });
    }
    const planPolicy = value.plan.policy ?? value.plan.prioritySnapshot;
    if (planPolicy && planPolicy.priorityMode !== value.priorityMode) {
      ctx.addIssue({
        code: 'custom',
        path: ['priorityMode'],
        message: 'Run priority must match the frozen plan policy',
      });
    }
  });
export const startDesignSchemeRunInputSchema = designSchemeRunInputSchema;
/** The preparation result is the complete, host-authored canonical run input. */
export const prepareDesignSchemeRunResultSchema = designSchemeRunInputSchema;

export const runResultSchema = z
  .object({
    runId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    mode: runModeSchema,
    status: runStatusSchema,
    compiledPrompt: safeTextSchema.max(MAX_TEXT_LENGTH).nullable(),
    outputs: z.array(runOutputMetadataSchema).max(32),
    steps: z.array(runStepSchema).max(200),
    evaluation: runEvaluationSchema.nullable(),
    repair: repairLineageSchema.nullable(),
    error: structuredDesignSchemeErrorSchema.nullable(),
    createdAt: designSchemeDateTimeSchema,
    completedAt: designSchemeDateTimeSchema.nullable(),
  })
  .strict();
export const designSchemeRunResultSchema = runResultSchema;

export const designSchemeListQuerySchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    status: schemeStatusSchema.optional(),
    fidelity: fidelitySchema.optional(),
    cursor: paginationCursorSchema.optional(),
    limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  })
  .strict();
export const listDesignSchemesQuerySchema = designSchemeListQuerySchema;
export const designSchemePageSchema = z
  .object({
    items: z.array(designSchemeSummarySchema).max(100),
    nextCursor: paginationCursorSchema.nullable(),
  })
  .strict();
export const designSchemeListPageSchema = designSchemePageSchema;

export const marketSearchQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    cursor: paginationCursorSchema.optional(),
    limit: queryIntegerSchema.pipe(z.number().int().min(1).max(100)).default(20),
  })
  .strict();
export const marketQuerySchema = marketSearchQuerySchema;
export const marketCandidateSchema = z
  .object({
    candidateId: opaqueIdSchema,
    repositoryUrl: httpsUriSchema,
    fullName: z
      .string()
      .trim()
      .regex(/^[^/\s]+\/[^/\s]+$/)
      .max(200),
    description: safeTextSchema.max(1_000).nullable(),
    license: z.string().trim().min(1).max(256).nullable(),
    ref: resolvedRefSchema,
    commit: sourceCommitSchema.nullable(),
    updatedAt: designSchemeDateTimeSchema,
    stars: nonNegativeIntegerSchema,
    topics: z.array(z.string().trim().min(1).max(80)).max(30),
    matchReason: safeTextSchema.max(600),
    riskSummary: safeTextSchema.max(600).nullable(),
  })
  .strict();
export const marketSearchResultSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    fromCache: z.boolean(),
    fetchedAt: designSchemeDateTimeSchema,
    candidates: z.array(marketCandidateSchema).max(100),
    nextCursor: paginationCursorSchema.nullable(),
  })
  .strict();

/** A renderer selects immutable history identities; the host resolves bytes and prompt snapshots. */
export const designSchemeHistorySourceSelectionSchema = z
  .object({
    runId: opaqueIdSchema,
    assetId: opaqueIdSchema,
    includePrompt: z.boolean(),
  })
  .strict();
export const designSchemeHistorySourceSelectionsSchema = z
  .array(designSchemeHistorySourceSelectionSchema)
  .max(64)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = `${item.runId}\0${item.assetId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: 'History source selections must be unique',
        });
      }
      seen.add(key);
    }
  });

export const createDesignSchemeInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    brief: safeTextSchema.max(8_000),
    sourceUris: z.array(httpsRepositoryUriSchema).max(16),
    sourceBindings: z.array(sourceBindingSchema).max(32),
    sourcePackages: z.array(sourcePackageSchema).max(32).default([]),
    sourceSnapshots: z.array(sourceSnapshotSchema).max(32).default([]),
    sourceAssetIds: z.array(opaqueIdSchema).max(64),
    sourceAssets: z.array(referenceAssetMetadataSchema).max(64).default([]),
    historySources: designSchemeHistorySourceSelectionsSchema.default([]),
    document: designSchemeRevisionDocumentSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.document && value.document.parentRevisionId !== undefined) {
      if (value.document.parentRevisionId !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['document', 'parentRevisionId'],
          message: 'A newly created scheme revision cannot have a parent revision',
        });
      }
    }
    const assetIds = new Set(value.sourceAssets.map((asset) => asset.id));
    for (const [index, assetId] of value.sourceAssetIds.entries()) {
      if (value.sourceAssets.length > 0 && !assetIds.has(assetId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceAssetIds', index],
          message: 'Source asset metadata is missing',
        });
      }
    }
    const snapshotIds = new Set(value.sourceSnapshots.map((snapshot) => snapshot.id));
    for (const [index, binding] of value.sourceBindings.entries()) {
      if (binding.snapshotId && !snapshotIds.has(binding.snapshotId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceBindings', index, 'snapshotId'],
          message: 'Source binding snapshot metadata is missing',
        });
      }
    }
  });
export const startDesignSchemeCreationInputSchema = createDesignSchemeInputSchema;

/** User choice for the single installation prompt currently blocking an Agent session. */
export const confirmDesignSchemeInstallInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    decision: z.enum(['install', 'cancel']),
  })
  .strict();
export const confirmDesignSchemeInstallResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      executionId: opaqueIdSchema,
      status: z.literal('accepted'),
    })
    .strict(),
  z
    .object({
      executionId: opaqueIdSchema,
      status: z.literal('cancelled'),
    })
    .strict(),
  z
    .object({
      executionId: opaqueIdSchema,
      status: z.literal('already-terminal'),
    })
    .strict(),
]);

export const createDesignSchemeResultSchema = z
  .object({
    scheme: designSchemeSummarySchema,
    document: designSchemeRevisionDocumentSchema,
    revisionId: opaqueIdSchema.optional(),
    creationSummary: safeTextSchema.max(1_200).optional(),
    trace: compilationTraceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.revisionId !== undefined && value.revisionId !== value.document.revisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionId'],
        message: 'Result revision aliases must agree',
      });
    }
    if (value.scheme.id !== value.document.schemeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'schemeId'],
        message: 'Result document scheme mismatch',
      });
    }
    const visibleRevisionIds = new Set([
      value.scheme.currentRevisionId,
      value.scheme.workingDraftRevisionId,
    ]);
    if (!visibleRevisionIds.has(value.document.revisionId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'revisionId'],
        message: 'Result document must be the current revision or working draft',
      });
    }
  });
export const designSchemeCreationResultSchema = createDesignSchemeResultSchema;

export const updateDesignSchemeInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    baseRevisionId: opaqueIdSchema,
    document: designSchemeRevisionDocumentSchema,
    expectedVersion: designSchemeVersionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.document.schemeId !== value.schemeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'schemeId'],
        message: 'Document scheme mismatch',
      });
    }
    if (value.document.parentRevisionId !== undefined) {
      if (value.document.revisionId === value.baseRevisionId) {
        ctx.addIssue({
          code: 'custom',
          path: ['document', 'revisionId'],
          message: 'Revision documents are immutable; updates require a new revision identifier',
        });
      }
      if (value.document.parentRevisionId !== value.baseRevisionId) {
        ctx.addIssue({
          code: 'custom',
          path: ['document', 'parentRevisionId'],
          message: 'Updated revision must identify its base revision',
        });
      }
    }
  });
export const designSchemeUpdateInputSchema = updateDesignSchemeInputSchema;
export const updateDesignSchemeResultSchema = z
  .object({ scheme: designSchemeSummarySchema, document: designSchemeRevisionDocumentSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (value.document.schemeId !== value.scheme.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'schemeId'],
        message: 'Updated document scheme mismatch',
      });
    }
    const visibleRevisionIds = new Set([
      value.scheme.currentRevisionId,
      value.scheme.workingDraftRevisionId,
    ]);
    if (!visibleRevisionIds.has(value.document.revisionId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'revisionId'],
        message: 'Updated revision must become current or working draft',
      });
    }
  });

export const cancelDesignSchemeInputSchema = z
  .object({ executionId: opaqueIdSchema, runId: opaqueIdSchema.optional() })
  .strict();
export const designSchemeCancelInputSchema = cancelDesignSchemeInputSchema;
export const cancelDesignSchemeResultSchema = z
  .object({ executionId: opaqueIdSchema, status: z.enum(['cancelled', 'already-terminal']) })
  .strict();

export const selectCoverInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    assetId: opaqueIdSchema,
    expectedVersion: designSchemeVersionSchema,
  })
  .strict();
export const selectCoverDesignSchemeInputSchema = selectCoverInputSchema;
export const selectCoverResultSchema = z
  .object({ scheme: designSchemeSummarySchema, selectedAssetId: opaqueIdSchema })
  .strict();
export const selectCoverDesignSchemeResultSchema = selectCoverResultSchema;

export const formalizeDesignSchemeInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    coverAssetId: opaqueIdSchema,
    expectedVersion: designSchemeVersionSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const designSchemeFormalizeInputSchema = formalizeDesignSchemeInputSchema;
export const formalizeDesignSchemeResultSchema = z
  .object({
    scheme: designSchemeSummarySchema,
    revisionId: opaqueIdSchema,
    formalized: z.literal(true),
  })
  .strict()
  .refine((value) => value.scheme.status === 'formal', {
    path: ['scheme', 'status'],
    message: 'Formalize must return a formal scheme',
  })
  .refine((value) => value.scheme.currentRevisionId === value.revisionId, {
    path: ['revisionId'],
    message: 'Formalized revision must be the current revision',
  });

export const promoteWorkingDraftInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    workingDraftRevisionId: opaqueIdSchema,
    expectedVersion: designSchemeVersionSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const designSchemePromoteInputSchema = promoteWorkingDraftInputSchema;
export const promoteWorkingDraftResultSchema = z
  .object({
    scheme: designSchemeSummarySchema,
    promotedRevisionId: opaqueIdSchema,
    promoted: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scheme.status !== 'formal') {
      ctx.addIssue({
        code: 'custom',
        path: ['scheme', 'status'],
        message: 'Promoted scheme must remain formal',
      });
    }
    if (value.scheme.currentRevisionId !== value.promotedRevisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['promotedRevisionId'],
        message: 'Promoted revision must become current',
      });
    }
    if (value.scheme.workingDraftRevisionId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheme', 'workingDraftRevisionId'],
        message: 'Promote must clear the working draft pointer',
      });
    }
  });

export const renameDesignSchemeInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    name: z.string().trim().min(1).max(120),
    expectedVersion: designSchemeVersionSchema,
  })
  .strict();
export const designSchemeRenameInputSchema = renameDesignSchemeInputSchema;
export const renameDesignSchemeResultSchema = z
  .object({ scheme: designSchemeSummarySchema })
  .strict();

export const removeDesignSchemeInputSchema = z
  .object({ schemeId: opaqueIdSchema, expectedVersion: designSchemeVersionSchema })
  .strict();
export const designSchemeRemoveInputSchema = removeDesignSchemeInputSchema;
export const removeDesignSchemeResultSchema = z
  .object({ schemeId: opaqueIdSchema, removed: z.literal(true) })
  .strict();

export const modifyDesignSchemeInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    schemeId: opaqueIdSchema,
    baseRevisionId: opaqueIdSchema,
    instruction: safeTextSchema.min(1).max(8_000),
    baseDocument: designSchemeRevisionDocumentSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.baseDocument && value.baseDocument.schemeId !== value.schemeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseDocument', 'schemeId'],
        message: 'Base document scheme mismatch',
      });
    }
    if (value.baseDocument && value.baseDocument.revisionId !== value.baseRevisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseDocument', 'revisionId'],
        message: 'Base document revision mismatch',
      });
    }
  });
export const startDesignSchemeModifyInputSchema = modifyDesignSchemeInputSchema;
export const modifyDesignSchemeResultSchema = createDesignSchemeResultSchema;

export const checkDesignSchemeUpdateInputSchema = z
  .object({ schemeId: opaqueIdSchema, revisionId: opaqueIdSchema.optional() })
  .strict();
export const designSchemeCheckUpdateInputSchema = checkDesignSchemeUpdateInputSchema;
export const checkDesignSchemeUpdateResultSchema = z
  .object({
    status: z.enum(['up-to-date', 'draft-created', 'no-source']),
    detail: safeTextSchema.max(600),
    scheme: designSchemeSummarySchema.nullable(),
    revisionId: opaqueIdSchema.nullable(),
  })
  .strict();
export const designSchemeCheckUpdateResultSchema = checkDesignSchemeUpdateResultSchema;

export const sharePackageMetadataSchema = z
  .object({
    id: opaqueIdSchema,
    format: z.literal('musefold.design'),
    formatVersion: designSchemePackageFormatVersionSchema,
    contentHash: designSchemeHashSchema,
    sizeBytes: positiveIntegerSchema.max(MAX_PACKAGE_BYTES),
    createdAt: designSchemeDateTimeSchema,
  })
  .strict();

/** Host picker/uploader boundary. The host returns only validated package facts or cancellation. */
export const prepareDesignSchemeImportPackageInputSchema = z
  .object({
    acceptedFormatVersions: z
      .array(designSchemePackageFormatVersionSchema)
      .min(1)
      .max(2)
      .default([LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION, DESIGN_SCHEME_PACKAGE_FORMAT_VERSION]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.acceptedFormatVersions).size !== value.acceptedFormatVersions.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedFormatVersions'],
        message: 'Accepted package format versions must be unique',
      });
    }
  });
export const prepareDesignSchemeImportPackageResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('staged'),
      stagedPackageId: opaqueIdSchema,
      packageHash: designSchemeHashSchema,
      sizeBytes: positiveIntegerSchema.max(MAX_PACKAGE_BYTES),
      formatVersion: designSchemePackageFormatVersionSchema,
    })
    .strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
]);

/** Legacy v1 import input retained while hosts migrate their opaque staging identifiers. */
export const legacyImportDesignSchemeInputSchema = z
  .object({
    packageId: opaqueIdSchema,
    packageHash: designSchemeHashSchema,
    formatVersion: z.literal(LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION),
  })
  .strict();
export const importDesignSchemeInputSchema = z
  .object({
    stagedPackageId: opaqueIdSchema,
    packageHash: designSchemeHashSchema,
    formatVersion: designSchemePackageFormatVersionSchema,
  })
  .strict();
export const designSchemeImportInputSchema = importDesignSchemeInputSchema;
export const importDesignSchemeResultSchema = z
  .object({
    scheme: designSchemeSummarySchema,
    revisionId: opaqueIdSchema,
    status: z.literal('draft'),
  })
  .strict()
  .refine((value) => value.scheme.status === 'draft', {
    path: ['scheme', 'status'],
    message: 'Imported schemes must start as drafts',
  });

export const exportDesignSchemeInputSchema = z
  .object({
    schemeId: opaqueIdSchema,
    revisionId: opaqueIdSchema.optional(),
    formatVersion: canonicalDesignSchemePackageFormatVersionSchema,
  })
  .strict();
export const designSchemeExportInputSchema = exportDesignSchemeInputSchema;
export const canonicalSharePackageMetadataSchema = sharePackageMetadataSchema.extend({
  formatVersion: canonicalDesignSchemePackageFormatVersionSchema,
});
const deliveredExportDesignSchemeResultSchema = z
  .object({
    package: canonicalSharePackageMetadataSchema,
    schemeId: opaqueIdSchema,
    status: z.literal('delivered'),
  })
  .strict();
export const exportDesignSchemeResultSchema = z.discriminatedUnion('status', [
  deliveredExportDesignSchemeResultSchema,
  z
    .object({
      schemeId: opaqueIdSchema,
      status: z.literal('cancelled'),
    })
    .strict(),
]);

/** Legacy result parser retained for old adapters that still spell delivery as exported. */
export const legacyExportDesignSchemeResultSchema = z
  .object({
    package: sharePackageMetadataSchema,
    schemeId: opaqueIdSchema,
    status: z.literal('exported'),
  })
  .strict()
  .transform((value) => ({ ...value, status: 'delivered' as const }));

const creationEventByKind = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('state'), executionId: opaqueIdSchema, state: creationStateSchema })
    .strict(),
  z
    .object({
      kind: z.literal('trace'),
      executionId: opaqueIdSchema,
      item: compilationTraceItemSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('confirmation-required'),
      executionId: opaqueIdSchema,
      source: sourceConfirmationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('draft-ready'),
      executionId: opaqueIdSchema,
      result: createDesignSchemeResultSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('failed'),
      executionId: opaqueIdSchema,
      error: structuredDesignSchemeErrorSchema,
    })
    .strict(),
  z.object({ kind: z.literal('cancelled'), executionId: opaqueIdSchema }).strict(),
]);
export const designSchemeCreationEventSchema = creationEventByKind;
export const creationEventSchema = creationEventByKind;

const runEventByKind = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('run-created'), executionId: opaqueIdSchema, run: runRecordSchema })
    .strict(),
  z
    .object({
      kind: z.literal('run-planned'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      plan: designSchemeRunPlanSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('step-started'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      stepId: opaqueIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('step-completed'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      stepId: opaqueIdSchema,
      outputIds: z.array(opaqueIdSchema).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal('evaluation-completed'),
      executionId: opaqueIdSchema,
      evaluation: runEvaluationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('blocked'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      error: structuredDesignSchemeErrorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('completed'),
      executionId: opaqueIdSchema,
      result: runResultSchema.refine((result) => result.status === 'completed', {
        path: ['status'],
        message: 'Completed events require a completed run result',
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('failed'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      error: structuredDesignSchemeErrorSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('cancelled'), executionId: opaqueIdSchema, runId: opaqueIdSchema })
    .strict(),
]);
export const designSchemeRunEventSchema = runEventByKind;
export const runEventSchema = runEventByKind;

/** Union of path-free creation and run lifecycle events. */
export const designSchemeEventSchema = z.union([creationEventByKind, runEventByKind]);
export const designSchemeTraceEventSchema = z.union([
  z
    .object({
      kind: z.literal('trace'),
      executionId: opaqueIdSchema,
      item: compilationTraceItemSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('step-completed'),
      executionId: opaqueIdSchema,
      runId: opaqueIdSchema,
      stepId: opaqueIdSchema,
      outputIds: z.array(opaqueIdSchema).max(64),
    })
    .strict(),
]);

export type Fidelity = z.infer<typeof fidelitySchema>;
export type SchemeStatus = z.infer<typeof schemeStatusSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourceRole = z.infer<typeof sourceRoleSchema>;
export type SourcePackageKind = z.infer<typeof sourcePackageKindSchema>;
export type SourceBinding = z.infer<typeof sourceBindingSchema>;
export type SourcePackage = z.infer<typeof sourcePackageSchema>;
export type SourceConfirmation = z.infer<typeof sourceConfirmationSchema>;
export type SourceFileMetadata = z.infer<typeof sourceFileMetadataSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type InputKind = z.infer<typeof inputKindSchema>;
export type ImageRole = z.infer<typeof imageRoleSchema>;
export type ConstraintDomain = z.infer<typeof constraintDomainSchema>;
export type ConstraintMode = z.infer<typeof constraintModeSchema>;
export type PromptModuleKind = z.infer<typeof promptModuleKindSchema>;
export type InputSlot = z.infer<typeof inputSlotSchema>;
export type ParameterDefault = z.infer<typeof safeParameterDefaultSchema>;
export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;
export type DesignConstraint = z.infer<typeof designConstraintSchema>;
export type PromptModule = z.infer<typeof promptModuleSchema>;
export type CompilationTraceItem = z.infer<typeof compilationTraceItemSchema>;
export type CompilationRecord = z.infer<typeof compilationRecordSchema>;
export type DesignSchemeRevisionDocument = z.output<typeof designSchemeRevisionDocumentSchema>;
export type DesignSchemeDocument = DesignSchemeRevisionDocument;
export type DesignScheme = z.output<typeof designSchemeSchema>;
export type DesignSchemeSummary = z.output<typeof designSchemeSummarySchema>;
export type DesignSchemeDetailRevisionSelector = z.infer<
  typeof designSchemeDetailRevisionSelectorSchema
>;
export type DesignSchemeDetailInput = z.input<typeof designSchemeDetailInputSchema>;
export type ParsedDesignSchemeDetailInput = z.output<typeof designSchemeDetailInputSchema>;
export type DesignSchemeDetail = z.output<typeof designSchemeDetailSchema>;
export type DesignSchemeAsset = z.infer<typeof designSchemeAssetSchema>;
export type AssetMetadata = z.infer<typeof assetMetadataSchema>;
export type ReferenceAssetMetadata = z.infer<typeof referenceAssetMetadataSchema>;
export type RunOutputMetadata = z.infer<typeof runOutputMetadataSchema>;
export type CreationState = z.infer<typeof creationStateSchema>;
export type DesignSchemeCreationState = z.infer<typeof designSchemeCreationStateSchema>;
export type RunMode = z.infer<typeof runModeSchema>;
export type DesignSchemeRunMode = z.infer<typeof designSchemeRunModeSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStepStatus = z.infer<typeof runStepStatusSchema>;
export type PriorityMode = z.infer<typeof priorityModeSchema>;
export type SchemePriorityMode = z.infer<typeof schemePriorityModeSchema>;
export type StructuredDesignSchemeError = z.infer<typeof structuredDesignSchemeErrorSchema>;
export type RunPolicySnapshot = z.infer<typeof runPolicySnapshotSchema>;
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;
export type DesignSchemeRunExecutionSettings = z.input<
  typeof designSchemeRunExecutionSettingsSchema
>;
export type ParsedDesignSchemeRunExecutionSettings = z.output<
  typeof designSchemeRunExecutionSettingsSchema
>;
export type PrepareDesignSchemeRunInput = z.input<typeof prepareDesignSchemeRunInputSchema>;
export type ParsedPrepareDesignSchemeRunInput = z.output<typeof prepareDesignSchemeRunInputSchema>;
export type PlannedInput = z.infer<typeof plannedInputSchema>;
export type WorkflowStepKind = z.infer<typeof workflowStepKindSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type RunBudget = z.infer<typeof runBudgetSchema>;
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;
export type DesignSchemeRunPlan = z.infer<typeof designSchemeRunPlanSchema>;
export type RunPlan = DesignSchemeRunPlan;
export type RepairLineage = z.infer<typeof repairLineageSchema>;
export type EvaluationCheck = z.infer<typeof evaluationCheckSchema>;
export type RunEvaluation = z.infer<typeof runEvaluationSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type DesignSchemeRunInput = z.input<typeof designSchemeRunInputSchema>;
export type ParsedDesignSchemeRunInput = z.output<typeof designSchemeRunInputSchema>;
export type PrepareDesignSchemeRunResult = z.output<typeof prepareDesignSchemeRunResultSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
export type DesignSchemeRunResult = z.infer<typeof designSchemeRunResultSchema>;
export type DesignSchemeListQuery = z.input<typeof designSchemeListQuerySchema>;
export type ParsedDesignSchemeListQuery = z.output<typeof designSchemeListQuerySchema>;
export type DesignSchemePage = z.infer<typeof designSchemePageSchema>;
export type MarketSearchQuery = z.input<typeof marketSearchQuerySchema>;
export type ParsedMarketSearchQuery = z.output<typeof marketSearchQuerySchema>;
export type MarketCandidate = z.infer<typeof marketCandidateSchema>;
export type MarketSearchResult = z.infer<typeof marketSearchResultSchema>;
export type DesignSchemeHistorySourceSelection = z.infer<
  typeof designSchemeHistorySourceSelectionSchema
>;
export type CreateDesignSchemeInput = z.infer<typeof createDesignSchemeInputSchema>;
export type ConfirmDesignSchemeInstallInput = z.infer<typeof confirmDesignSchemeInstallInputSchema>;
export type ConfirmDesignSchemeInstallResult = z.infer<
  typeof confirmDesignSchemeInstallResultSchema
>;
export type CreateDesignSchemeResult = z.infer<typeof createDesignSchemeResultSchema>;
export type UpdateDesignSchemeInput = z.infer<typeof updateDesignSchemeInputSchema>;
export type UpdateDesignSchemeResult = z.infer<typeof updateDesignSchemeResultSchema>;
export type CancelDesignSchemeInput = z.infer<typeof cancelDesignSchemeInputSchema>;
export type CancelDesignSchemeResult = z.infer<typeof cancelDesignSchemeResultSchema>;
export type SelectCoverInput = z.infer<typeof selectCoverInputSchema>;
export type SelectCoverResult = z.infer<typeof selectCoverResultSchema>;
export type FormalizeDesignSchemeInput = z.infer<typeof formalizeDesignSchemeInputSchema>;
export type FormalizeDesignSchemeResult = z.infer<typeof formalizeDesignSchemeResultSchema>;
export type PromoteWorkingDraftInput = z.infer<typeof promoteWorkingDraftInputSchema>;
export type PromoteWorkingDraftResult = z.infer<typeof promoteWorkingDraftResultSchema>;
export type RenameDesignSchemeInput = z.infer<typeof renameDesignSchemeInputSchema>;
export type RenameDesignSchemeResult = z.infer<typeof renameDesignSchemeResultSchema>;
export type RemoveDesignSchemeInput = z.infer<typeof removeDesignSchemeInputSchema>;
export type RemoveDesignSchemeResult = z.infer<typeof removeDesignSchemeResultSchema>;
export type ModifyDesignSchemeInput = z.infer<typeof modifyDesignSchemeInputSchema>;
export type ModifyDesignSchemeResult = z.infer<typeof modifyDesignSchemeResultSchema>;
export type CheckDesignSchemeUpdateInput = z.infer<typeof checkDesignSchemeUpdateInputSchema>;
export type CheckDesignSchemeUpdateResult = z.infer<typeof checkDesignSchemeUpdateResultSchema>;
export type SharePackageMetadata = z.infer<typeof sharePackageMetadataSchema>;
export type CanonicalSharePackageMetadata = z.infer<typeof canonicalSharePackageMetadataSchema>;
export type DesignSchemePackageFormatVersion = z.infer<
  typeof designSchemePackageFormatVersionSchema
>;
export type PrepareDesignSchemeImportPackageInput = z.input<
  typeof prepareDesignSchemeImportPackageInputSchema
>;
export type PrepareDesignSchemeImportPackageResult = z.infer<
  typeof prepareDesignSchemeImportPackageResultSchema
>;
export type LegacyImportDesignSchemeInput = z.infer<typeof legacyImportDesignSchemeInputSchema>;
export type ImportDesignSchemeInput = z.infer<typeof importDesignSchemeInputSchema>;
export type ImportDesignSchemeResult = z.infer<typeof importDesignSchemeResultSchema>;
export type ExportDesignSchemeInput = z.infer<typeof exportDesignSchemeInputSchema>;
export type ExportDesignSchemeResult = z.infer<typeof exportDesignSchemeResultSchema>;
export type DesignSchemeCreationEvent = z.infer<typeof designSchemeCreationEventSchema>;
export type DesignSchemeRunEvent = z.infer<typeof designSchemeRunEventSchema>;
export type DesignSchemeEvent = z.infer<typeof designSchemeEventSchema>;
