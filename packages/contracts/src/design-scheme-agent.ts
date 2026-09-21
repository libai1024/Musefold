import { z } from 'zod';
import {
  designSchemeTextAuthorizationSchema,
  designSchemeTextProgressSchema,
} from './design-scheme-text';
import {
  opaqueIdSchema,
  modifyDesignSchemeInputSchema,
  designSchemeVersionSchema,
  designSchemeRevisionDocumentSchema,
  createDesignSchemeInputSchema,
  createDesignSchemeResultSchema,
  sourceSnapshotSchema,
  sourceCommitSchema,
  httpsRepositoryUriSchema,
} from './design-scheme';
import { schemeSourcePreparationSchema } from './design-scheme-source-preparation';

/** Additive cloud execution protocol. The existing create result still means a completed draft. */
export const cloudModifyDesignSchemeInputSchema = modifyDesignSchemeInputSchema.safeExtend({
  expectedVersion: designSchemeVersionSchema,
});
export const cloudCheckDesignSchemeUpdateInputSchema = z
  .object({
    executionId: cloudModifyDesignSchemeInputSchema.shape.executionId,
    schemeId: cloudModifyDesignSchemeInputSchema.shape.schemeId,
    baseRevisionId: cloudModifyDesignSchemeInputSchema.shape.baseRevisionId,
    expectedVersion: cloudModifyDesignSchemeInputSchema.shape.expectedVersion,
  })
  .strict();
export const startDesignSchemeAgentInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('check-update'),
      input: cloudCheckDesignSchemeUpdateInputSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('create'),
      input: createDesignSchemeInputSchema,
      text: designSchemeTextAuthorizationSchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('modify'),
      input: cloudModifyDesignSchemeInputSchema,
      text: designSchemeTextAuthorizationSchema,
    })
    .strict(),
]);
/** Server-authored immutable base, separate from the caller's optional comparison document. */
export const designSchemeAgentRevisionBaseSchema = z
  .object({
    expectedVersion: designSchemeVersionSchema,
    document: designSchemeRevisionDocumentSchema,
  })
  .strict();
export type DesignSchemeAgentRevisionBase = z.infer<typeof designSchemeAgentRevisionBaseSchema>;
/** Server-authored immutable update context. Never accepted from the API caller. */
export const designSchemeUpdateChangeSchema = z
  .object({
    sourceExecutionId: opaqueIdSchema,
    previousSnapshotId: opaqueIdSchema,
    snapshotId: opaqueIdSchema,
    previousCommit: sourceCommitSchema,
    commit: sourceCommitSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const designSchemeUpdateContextSchema = z
  .object({
    base: designSchemeAgentRevisionBaseSchema,
    snapshots: z.array(sourceSnapshotSchema).max(32),
    sources: z
      .array(
        z
          .object({
            snapshotId: opaqueIdSchema,
            executionId: opaqueIdSchema,
            repositoryUrl: httpsRepositoryUriSchema,
            requestedRef: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(16),
    checkedSources: z.number().int().min(0).max(16),
    changes: z.array(designSchemeUpdateChangeSchema).max(16),
    authorizationVersion: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type DesignSchemeUpdateContext = z.infer<typeof designSchemeUpdateContextSchema>;
export const authorizeDesignSchemeUpdateInputSchema = z
  .object({
    executionId: opaqueIdSchema,
    expectedSessionVersion: z.number().int().nonnegative(),
    text: designSchemeTextAuthorizationSchema,
  })
  .strict();
export const designSchemeAgentIdentitySchema = z.object({ executionId: opaqueIdSchema }).strict();
export const cancelDesignSchemeAgentInputSchema = designSchemeAgentIdentitySchema
  .extend({ operation: z.enum(['create', 'modify', 'check-update']).optional() })
  .strict();
export const confirmDesignSchemeAgentSourceInputSchema = designSchemeAgentIdentitySchema
  .extend({ confirmationId: opaqueIdSchema, decision: z.enum(['install', 'cancel']) })
  .strict();
export const designSchemeAgentStatusSchema = z.enum([
  'queued',
  'authorization-required',
  'no-source',
  'up-to-date',
  'preparing',
  'compiling',
  'confirmation-required',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);
export const designSchemeAgentBlockerSchema = z.enum([
  'AGENT_COMPILER_UNAVAILABLE',
  'AGENT_ASSETS_UNAVAILABLE',
  'AGENT_MATERIALS_INVALID',
  'SOURCE_PREPARATION_FAILED',
  'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE',
  'AGENT_TEXT_RESULT_UNKNOWN',
  'AGENT_TEXT_OUTPUT_INVALID',
  'AGENT_TEXT_SOURCE_INVALID',
  'AGENT_BASE_REVISION_CHANGED',
]);
export const designSchemeAgentSessionSchema = z
  .object({
    executionId: opaqueIdSchema,
    operation: z.enum(['create', 'modify', 'check-update']),
    status: designSchemeAgentStatusSchema,
    version: z.number().int().nonnegative(),
    sourceCount: z.number().int().min(0).max(16),
    confirmedSources: z.number().int().min(0).max(16),
    pendingSource: schemeSourcePreparationSchema.nullable(),
    blocker: designSchemeAgentBlockerSchema.nullable(),
    result: createDesignSchemeResultSchema.nullable(),
    text: designSchemeTextProgressSchema.optional(),
    update: z
      .object({
        checkedSources: z.number().int().min(0).max(16),
        changes: z.array(designSchemeUpdateChangeSchema).max(16),
      })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.update &&
      (value.operation !== 'check-update' ||
        value.update.checkedSources > value.sourceCount ||
        value.update.changes.length > value.update.checkedSources ||
        value.confirmedSources > value.update.changes.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid update progress' });
    if (
      ['no-source', 'up-to-date', 'authorization-required'].includes(value.status) &&
      (value.operation !== 'check-update' || !value.update || value.text)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Update inspection is separate from paid execution',
      });
    if (value.status === 'no-source' && value.sourceCount !== 0)
      ctx.addIssue({ code: 'custom', message: 'No-source requires no tracked source' });
    if (
      value.status === 'up-to-date' &&
      (!value.sourceCount ||
        value.update?.checkedSources !== value.sourceCount ||
        value.update.changes.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Up-to-date requires all sources checked and unchanged',
      });
    if (
      value.status === 'authorization-required' &&
      (!value.update?.changes.length ||
        value.confirmedSources !== value.update.changes.length ||
        value.update.checkedSources !== value.sourceCount)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Authorization follows all changed-source confirmations',
      });
    if (value.confirmedSources > value.sourceCount)
      ctx.addIssue({ code: 'custom', message: 'Confirmed source count exceeds source count' });
    if ((value.status === 'confirmation-required') !== (value.pendingSource !== null))
      ctx.addIssue({ code: 'custom', message: 'Only a waiting session contains a pending source' });
    if (value.pendingSource && value.pendingSource.status !== 'ready')
      ctx.addIssue({ code: 'custom', message: 'Confirmation requires a ready frozen source' });
    if ((value.status === 'completed') !== (value.result !== null))
      ctx.addIssue({ code: 'custom', message: 'Only a completed session contains a draft result' });
    if ((value.status === 'blocked' || value.status === 'failed') !== (value.blocker !== null))
      ctx.addIssue({ code: 'custom', message: 'Blocked and failed sessions require a reason' });
  });
export const designSchemeAgentEventQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();
export const designSchemeAgentEventPageSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            seq: z.number().int().positive(),
            session: designSchemeAgentSessionSchema,
          })
          .strict(),
      )
      .max(100),
    nextSeq: z.number().int().nonnegative(),
  })
  .strict();

export type StartDesignSchemeAgentInput = z.infer<typeof startDesignSchemeAgentInputSchema>;
export type AuthorizeDesignSchemeUpdateInput = z.infer<
  typeof authorizeDesignSchemeUpdateInputSchema
>;
export type ConfirmDesignSchemeAgentSourceInput = z.infer<
  typeof confirmDesignSchemeAgentSourceInputSchema
>;
export type CancelDesignSchemeAgentInput = z.infer<typeof cancelDesignSchemeAgentInputSchema>;
export type DesignSchemeAgentSession = z.infer<typeof designSchemeAgentSessionSchema>;
export type DesignSchemeAgentEventPage = z.infer<typeof designSchemeAgentEventPageSchema>;
