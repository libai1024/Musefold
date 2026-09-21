import { describe, expect, it } from 'vitest';
import {
  designSchemeAgentSessionSchema,
  confirmDesignSchemeAgentSourceInputSchema,
  designSchemeAgentEventQuerySchema,
} from '../design-scheme-agent';
const queued = {
  executionId: 'agent-1',
  operation: 'create',
  status: 'queued',
  version: 1,
  sourceCount: 1,
  confirmedSources: 0,
  pendingSource: null,
  blocker: null,
  result: null,
  createdAt: '2026-09-09T00:00:00Z',
  expiresAt: '2026-09-09T01:00:00Z',
};
describe('cloud Agent session protocol', () => {
  it('never claims a completed draft or pending confirmation without evidence', () => {
    expect(designSchemeAgentSessionSchema.safeParse(queued).success).toBe(true);
    for (const patch of [
      { status: 'completed' },
      { status: 'confirmation-required' },
      { status: 'blocked' },
      { confirmedSources: 2 },
      { objectKey: 'private' },
    ])
      expect(designSchemeAgentSessionSchema.safeParse({ ...queued, ...patch }).success).toBe(false);
    expect(
      designSchemeAgentSessionSchema.safeParse({
        ...queued,
        status: 'blocked',
        blocker: 'AGENT_COMPILER_UNAVAILABLE',
      }).success,
    ).toBe(true);
  });
  it('requires a per-source confirmation identity, rejects legacy ambiguous decisions', () => {
    expect(
      confirmDesignSchemeAgentSourceInputSchema.safeParse({
        executionId: 'agent-1',
        decision: 'install',
      }).success,
    ).toBe(false);
    expect(
      confirmDesignSchemeAgentSourceInputSchema.safeParse({
        executionId: 'agent-1',
        confirmationId: 'source-1',
        decision: 'install',
      }).success,
    ).toBe(true);
  });
  it('rejects invalid event cursors instead of silently rewinding', () => {
    expect(designSchemeAgentEventQuerySchema.parse({ afterSeq: '4' })).toEqual({ afterSeq: 4 });
    for (const afterSeq of ['-1', '1.1', 'Infinity', '9007199254740992'])
      expect(designSchemeAgentEventQuerySchema.safeParse({ afterSeq }).success).toBe(false);
  });
});

it('adds an explicitly text-authorized versioned modify without broadening legacy create', async () => {
  const { startDesignSchemeAgentInputSchema, cancelDesignSchemeAgentInputSchema } = await import(
    '../design-scheme-agent'
  );
  const text = {
    binding: {
      apiIssuer: 'https://api.example.test',
      principalId: 'owner',
      payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
      credential: { ref: 'credential', version: 1 },
      providerId: 'cloud-agent',
      model: 'text',
      policyVersion: 'agent-text-v1',
      capabilities: { image: false, text: true },
    },
    maxModelCalls: 1,
    maxOutputTokens: 8192,
    acceptUnknownCost: true,
  };
  const modify = {
    operation: 'modify',
    input: {
      executionId: 'modify',
      schemeId: 'scheme',
      baseRevisionId: 'base',
      instruction: 'red',
      expectedVersion: 2,
    },
    text,
  };
  expect(startDesignSchemeAgentInputSchema.parse(modify)).toEqual(modify);
  expect(startDesignSchemeAgentInputSchema.safeParse({ ...modify, text: undefined }).success).toBe(
    false,
  );
  expect(
    startDesignSchemeAgentInputSchema.safeParse({
      ...modify,
      input: { ...modify.input, expectedVersion: undefined },
    }).success,
  ).toBe(false);
  expect(
    startDesignSchemeAgentInputSchema.safeParse({
      ...modify,
      input: { ...modify.input, endpoint: 'https://other.test' },
    }).success,
  ).toBe(false);
  expect(
    cancelDesignSchemeAgentInputSchema.parse({ executionId: 'modify', operation: 'modify' }),
  ).toEqual({ executionId: 'modify', operation: 'modify' });
});
