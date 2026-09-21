import { z } from 'zod';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Local backup lineage, not a user identity or a credential. Never reset on login/month change. */
export const managedExecutionCheckpointSchema = z
  .object({
    lineageId: z.string().uuid(),
    namespace: z.string().uuid(),
    revision,
    headHash: hash,
    lastOperationId: z.string().uuid(),
  })
  .strict();

export const managedExecutionOperationSchema = z
  .object({
    operationId: z.string().uuid(),
    kind: z.enum([
      'enable',
      'connection',
      'submit',
      'cancel',
      'receipt',
      'confirmation',
      'budget',
      'restore',
      // Resume is committed by SQLite only after its prepared anchor write succeeds.
      'resume',
    ]),
    intentHash: hash,
    from: managedExecutionCheckpointSchema.nullable(),
    to: managedExecutionCheckpointSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const { from, to } = value;
    if (
      to.lastOperationId !== value.operationId ||
      (from
        ? to.lineageId !== from.lineageId ||
          to.namespace !== from.namespace ||
          to.revision !== from.revision + 1 ||
          value.kind === 'enable'
        : to.revision !== 0 || value.kind !== 'enable')
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid managed checkpoint transition' });
    }
  });

/** Stored through the host's encryption; contains no token or request payload. */
export const managedExecutionAnchorSchema = z
  .object({
    version: z.literal(1),
    committed: managedExecutionCheckpointSchema.nullable(),
    pending: managedExecutionOperationSchema.nullable(),
    mode: z.enum(['active', 'query_only']),
    reason: z.enum(['restore_pending', 'state_mismatch', 'write_failed']).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (!value.committed && !value.pending) ||
      (value.mode === 'active' && value.reason !== null) ||
      (value.mode === 'query_only' && value.reason === null) ||
      (value.pending && JSON.stringify(value.pending.from) !== JSON.stringify(value.committed))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid managed execution anchor' });
    }
  });

export type ManagedExecutionCheckpoint = z.infer<typeof managedExecutionCheckpointSchema>;
export type ManagedExecutionOperation = z.infer<typeof managedExecutionOperationSchema>;
export type ManagedExecutionAnchor = z.infer<typeof managedExecutionAnchorSchema>;
