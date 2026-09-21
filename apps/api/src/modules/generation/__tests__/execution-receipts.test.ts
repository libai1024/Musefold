import type { ExecutionBinding } from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import { GenerationReceiptService, type ExecutionReceiptRow } from '../execution-receipts.js';

const binding: ExecutionBinding = {
  apiIssuer: 'https://api.example.test',
  principalId: 'principal',
  payer: { issuer: 'https://provider.example.test', ownerId: '42' },
  credential: { ref: 'credential', version: 1 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
};
const service = new GenerationReceiptService({
  apiIssuer: binding.apiIssuer,
  upstreamIssuer: binding.payer.issuer,
});
function receipt(): ExecutionReceiptRow {
  return {
    id: 'receipt',
    principalId: 'principal',
    idempotencyKey: 'accepted-key',
    operation: 'ordinary_create',
    originalRunId: 'original-run',
    sourceRunId: null,
    binding,
    bindingState: 'bound',
    logicalInputDigest: 'a'.repeat(64),
    finalRequestDigest: 'b'.repeat(64),
    authorizingSessionId: 'private-ba-session',
    authRevision: 4,
    status: 'queued',
    dispatch: 'not_started',
    costProvenance: 'not_sent',
    costPoints: null,
    revision: 1,
    createdAt: new Date('2026-09-08T00:00:00Z'),
    updatedAt: new Date('2026-09-08T00:00:00Z'),
    claimedAt: null,
    terminalAt: null,
    purgedAt: null,
  };
}
const intent = {
  operation: 'ordinary_create' as const,
  sourceRunId: null,
  logicalInputDigest: 'a'.repeat(64),
};

describe('durable receipt interpretation', () => {
  it('compares an explicit expectation to the accepted binding and leaves omitted expectations replayable', () => {
    const row = receipt();
    expect(() => service.assertIntent(row, intent)).not.toThrow();
    expect(() =>
      service.assertIntent(row, {
        ...intent,
        expectedBinding: { ...binding, credential: { ref: 'new-ref', version: 2 } },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'GENERATION_BINDING_CHANGED',
        details: { receiptId: row.id },
      }),
    );
    expect(() => service.assertIntent(row, { ...intent, expectedBinding: binding })).not.toThrow();
  });

  it.each([
    { operation: 'explicit_retry' as const },
    { sourceRunId: 'different-source' },
    { logicalInputDigest: 'c'.repeat(64) },
  ])('rejects intent collisions with a recoverable receipt ID: %j', (change) => {
    expect(() => service.assertIntent(receipt(), { ...intent, ...change })).toThrow(
      expect.objectContaining({
        code: 'GENERATION_IDEMPOTENCY_CONFLICT',
        details: { receiptId: 'receipt' },
      }),
    );
  });

  it('does not invent a binding for legacy_unknown metadata', () => {
    const row = {
      ...receipt(),
      operation: 'legacy_unknown' as const,
      bindingState: 'legacy_unbound' as const,
      binding: null,
      authorizingSessionId: null,
      authRevision: null,
      logicalInputDigest: null,
      finalRequestDigest: null,
    };
    expect(() => service.assertIntent(row, intent)).toThrow(
      expect.objectContaining({ code: 'GENERATION_IDEMPOTENCY_CONFLICT' }),
    );
    expect(service.toPublic(row)).toMatchObject({
      operation: 'legacy_unknown',
      bindingState: 'legacy_unbound',
      binding: null,
    });
    expect(() => service.requireResult({ ...row, purgedAt: new Date() })).toThrow(
      expect.objectContaining({
        code: 'GENERATION_RESULT_CLEANED',
        details: { receiptId: 'receipt', bindingState: 'legacy_unbound' },
      }),
    );
  });

  it('projects only canonical public metadata, excluding BA authority and internal digests', () => {
    const visible = service.toPublic(receipt());
    expect(visible).toMatchObject({ id: 'receipt', binding, status: 'queued', costPoints: null });
    expect(JSON.stringify(visible)).not.toContain('private-ba-session');
    for (const key of [
      'authorizingSessionId',
      'authRevision',
      'logicalInputDigest',
      'finalRequestDigest',
      'claimedAt',
    ])
      expect(visible).not.toHaveProperty(key);
  });
});
