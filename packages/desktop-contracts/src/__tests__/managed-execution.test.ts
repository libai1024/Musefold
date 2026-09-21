import { describe, expect, it } from 'vitest';
import {
  managedExecutionAnchorSchema,
  managedExecutionCheckpointSchema,
  managedExecutionOperationSchema,
} from '../managed-execution';

const id = '00000000-0000-4000-8000-000000000001';
const checkpoint = {
  lineageId: id,
  namespace: id,
  revision: 0,
  headHash: 'a'.repeat(64),
  lastOperationId: id,
};
const enable = {
  operationId: id,
  kind: 'enable',
  intentHash: 'b'.repeat(64),
  from: null,
  to: checkpoint,
};

describe('managed local checkpoint contract', () => {
  it('requires resume to advance an existing lineage, never initialize or reset it', () => {
    const operation = {
      ...enable,
      kind: 'resume',
      from: checkpoint,
      to: { ...checkpoint, revision: 1 },
    };
    expect(managedExecutionOperationSchema.parse(operation)).toEqual(operation);
    expect(managedExecutionOperationSchema.safeParse({ ...operation, from: null }).success).toBe(
      false,
    );
    expect(
      managedExecutionOperationSchema.safeParse({ ...operation, to: checkpoint }).success,
    ).toBe(false);
    expect(
      managedExecutionAnchorSchema.safeParse({
        version: 1,
        committed: checkpoint,
        pending: operation,
        mode: 'active',
        reason: null,
      }).success,
    ).toBe(true);
  });
  it('accepts explicit initialization and a monotone same-lineage transition', () => {
    expect(managedExecutionOperationSchema.parse(enable)).toEqual(enable);
    const next = {
      ...enable,
      kind: 'budget',
      from: checkpoint,
      to: { ...checkpoint, revision: 1 },
    };
    expect(managedExecutionOperationSchema.parse(next)).toEqual(next);
    expect(
      managedExecutionAnchorSchema.safeParse({
        version: 1,
        committed: null,
        pending: enable,
        mode: 'active',
        reason: null,
      }).success,
    ).toBe(true);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'rejects invalid revision %s',
    (revision) => {
      expect(managedExecutionCheckpointSchema.safeParse({ ...checkpoint, revision }).success).toBe(
        false,
      );
    },
  );

  it('rejects reset, namespace changes, skipped revisions and mismatched operation ids', () => {
    const next = {
      ...enable,
      kind: 'budget',
      from: checkpoint,
      to: { ...checkpoint, revision: 1 },
    };
    for (const invalid of [
      { ...enable, kind: 'submit' },
      { ...next, kind: 'enable' },
      { ...next, to: checkpoint },
      { ...next, to: { ...checkpoint, revision: 2 } },
      { ...next, to: { ...next.to, namespace: '00000000-0000-4000-8000-000000000002' } },
      { ...next, to: { ...next.to, lineageId: '00000000-0000-4000-8000-000000000002' } },
      { ...next, operationId: '00000000-0000-4000-8000-000000000002' },
    ])
      expect(managedExecutionOperationSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects unknown fields, invalid hashes, empty anchors and inconsistent pending/mode', () => {
    expect(
      managedExecutionCheckpointSchema.safeParse({ ...checkpoint, token: 'fixture' }).success,
    ).toBe(false);
    expect(
      managedExecutionCheckpointSchema.safeParse({ ...checkpoint, headHash: 'X'.repeat(64) })
        .success,
    ).toBe(false);
    const anchor = {
      version: 1,
      committed: checkpoint,
      pending: null,
      mode: 'active',
      reason: null,
    };
    for (const invalid of [
      { ...anchor, committed: null },
      { ...anchor, reason: 'restore_pending' },
      { ...anchor, mode: 'query_only' },
      { ...anchor, pending: enable },
    ])
      expect(managedExecutionAnchorSchema.safeParse(invalid).success).toBe(false);
    expect(
      managedExecutionAnchorSchema.safeParse({
        ...anchor,
        mode: 'query_only',
        reason: 'restore_pending',
      }).success,
    ).toBe(true);
  });
});
