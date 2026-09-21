import type { z } from 'zod';
import {
  designSchemeRevisionDocumentSchema,
  designSchemeHashSchema,
  httpsUriSchema,
  relativePathSchema,
  resolvedRefSchema,
  sourceCommitSchema,
} from './design-scheme';
import { legacyDesignSchemeRevisionDocumentSchema } from './design-scheme-legacy';

type CanonicalDocument = z.infer<typeof designSchemeRevisionDocumentSchema>;
type LegacyDocument = z.infer<typeof legacyDesignSchemeRevisionDocumentSchema>;
function safeOptional<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Preserve shared facts while omitting legacy host-only/unsafe source locators. */
export function legacyDesignSchemeDocumentToCanonical(document: LegacyDocument): CanonicalDocument {
  return designSchemeRevisionDocumentSchema.parse({
    ...document,
    sources: document.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      role: source.role,
      uri: safeOptional(httpsUriSchema, source.uri),
      packageId: source.packageId,
      snapshotId: source.snapshotId,
      resolvedRef: safeOptional(resolvedRefSchema, source.ref),
      commitHash: safeOptional(sourceCommitSchema, source.commit),
      relativePath: safeOptional(relativePathSchema, source.filePath),
      contentHash: safeOptional(designSchemeHashSchema, source.contentHash),
      license: source.license || undefined,
    })),
  });
}

/** Pure shape conversion; hosts separately assign new identities and import authority. */
export function canonicalDesignSchemeDocumentToLegacy(document: CanonicalDocument): LegacyDocument {
  return legacyDesignSchemeRevisionDocumentSchema.parse({
    ...document,
    sources: document.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      role: source.role,
      uri: source.repositoryUrl ?? source.uri,
      packageId: source.packageId,
      snapshotId: source.snapshotId,
      ref: source.resolvedRef ?? source.ref,
      commit: source.commitHash ?? source.commit ?? undefined,
      filePath: source.relativePath ?? source.evidencePath,
      contentHash: source.contentHash ?? source.hash ?? undefined,
      license: source.license ?? undefined,
    })),
    compilation: {
      ...document.compilation,
      compiledAt:
        typeof document.compilation.compiledAt === 'string'
          ? Date.parse(document.compilation.compiledAt)
          : document.compilation.compiledAt,
    },
  });
}
