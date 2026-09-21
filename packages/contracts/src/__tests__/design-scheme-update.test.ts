import { expect, it } from 'vitest';
import {
  startDesignSchemeAgentInputSchema,
  designSchemeAgentSessionSchema,
  authorizeDesignSchemeUpdateInputSchema,
  cancelDesignSchemeAgentInputSchema,
} from '../design-scheme-agent';
const input = {
  operation: 'check-update',
  input: { executionId: 'update', schemeId: 'scheme', baseRevisionId: 'base', expectedVersion: 1 },
};
const session = {
  executionId: 'update',
  operation: 'check-update',
  status: 'no-source',
  version: 1,
  sourceCount: 0,
  confirmedSources: 0,
  pendingSource: null,
  blocker: null,
  result: null,
  update: { checkedSources: 0, changes: [] },
  createdAt: '2026-09-09T00:00:00Z',
  expiresAt: '2026-09-09T01:00:00Z',
};
const change = {
  sourceExecutionId: 'source',
  previousSnapshotId: 'old',
  snapshotId: 'new',
  previousCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  contentHash: 'c'.repeat(64),
};
it('keeps inspection independent from text authorization and server-owned base documents', () => {
  expect(startDesignSchemeAgentInputSchema.parse(input)).toEqual(input);
  for (const invalid of [
    { ...input, text: {} },
    { ...input, input: { ...input.input, expectedVersion: undefined } },
    { ...input, input: { ...input.input, baseDocument: {} } },
  ])
    expect(startDesignSchemeAgentInputSchema.safeParse(invalid).success).toBe(false);
  expect(
    cancelDesignSchemeAgentInputSchema.parse({ executionId: 'update', operation: 'check-update' })
      .operation,
  ).toBe('check-update');
  expect(
    authorizeDesignSchemeUpdateInputSchema.safeParse({
      executionId: 'update',
      expectedSessionVersion: 1,
    }).success,
  ).toBe(false);
});
it('distinguishes no-source and fully checked unchanged terminal sessions from an unfinished inspection', () => {
  expect(designSchemeAgentSessionSchema.parse(session)).toEqual(session);
  expect(
    designSchemeAgentSessionSchema.parse({
      ...session,
      status: 'up-to-date',
      sourceCount: 2,
      update: { checkedSources: 2, changes: [] },
    }).status,
  ).toBe('up-to-date');
  for (const patch of [
    { status: 'up-to-date' },
    { sourceCount: 1 },
    { operation: 'create' },
    { update: undefined },
    { status: 'completed' },
  ])
    expect(designSchemeAgentSessionSchema.safeParse({ ...session, ...patch }).success).toBe(false);
});
it('requires all changed sources confirmed before authorization and bounds update counters', () => {
  const ready = {
    ...session,
    status: 'authorization-required',
    sourceCount: 2,
    confirmedSources: 1,
    update: { checkedSources: 2, changes: [change] },
  };
  expect(designSchemeAgentSessionSchema.parse(ready).status).toBe('authorization-required');
  for (const patch of [
    { confirmedSources: 0 },
    { update: { checkedSources: 1, changes: [change] } },
    { confirmedSources: 2 },
    { update: { checkedSources: 3, changes: [change] } },
  ])
    expect(designSchemeAgentSessionSchema.safeParse({ ...ready, ...patch }).success).toBe(false);
});
