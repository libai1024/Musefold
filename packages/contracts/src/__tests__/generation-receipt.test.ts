import { describe, expect, it } from 'vitest';
import {
  accountExecutionBindingSchema,
  createGenerationInputSchema,
  executionBindingSchema,
  generationExecutionReceiptSchema,
  generationReceiptQuerySchema,
  retryGenerationInputSchema,
  retryGenerationCommandSchema,
} from '../index';

const binding = {
  apiIssuer: 'https://api.example.test',
  principalId: 'principal-1',
  payer: { issuer: 'https://provider.example.test', ownerId: 'upstream-2' },
  credential: { ref: 'credential-3', version: 2 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
};
const receipt = {
  id: 'receipt-1',
  principalId: 'principal-1',
  idempotencyKey: 'request-1',
  operation: 'ordinary_create',
  originalRunId: 'run-1',
  sourceRunId: null,
  bindingState: 'bound',
  binding,
  status: 'succeeded',
  dispatch: 'claimed',
  costProvenance: 'unknown',
  costPoints: null,
  revision: 3,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:01:00Z',
  terminalAt: '2026-09-08T00:01:00Z',
  purgedAt: null,
};

describe('durable generation execution contracts', () => {
  it('shares stable identity with the read-only account binding without login freshness', () => {
    const stable = executionBindingSchema.parse(binding);
    for (const verifiedAt of ['2026-09-08T00:00:00Z', '2026-09-08T00:30:00Z']) {
      const current = accountExecutionBindingSchema.parse({
        ...binding,
        status: 'available',
        verifiedAt,
      });
      if (current.status !== 'available') throw new Error('Expected available binding');
      const { status: _status, verifiedAt: _verifiedAt, ...identity } = current;
      expect(identity).toEqual(stable);
    }
  });

  it('accepts absent legacy expectations and exact non-secret new expectations', () => {
    expect(createGenerationInputSchema.parse({ prompt: 'test' }).expectedBinding).toBeUndefined();
    expect(
      createGenerationInputSchema.parse({ prompt: 'test', expectedBinding: binding })
        .expectedBinding,
    ).toEqual(binding);
    expect(retryGenerationInputSchema.parse({})).toEqual({});
    expect(retryGenerationInputSchema.parse({ expectedBinding: binding }).expectedBinding).toEqual(
      binding,
    );
    expect(retryGenerationInputSchema.safeParse({ authSessionId: 'spoofed-session' }).success).toBe(
      false,
    );
    expect(
      executionBindingSchema.safeParse({ ...binding, verifiedAt: receipt.createdAt }).success,
    ).toBe(false);
  });

  it('requires a stable retry intent with only an optional public binding', () => {
    const command = { id: 'parent-run', idempotencyKey: 'retry-intent-1' };
    expect(retryGenerationCommandSchema.parse(command)).toEqual(command);
    expect(retryGenerationCommandSchema.parse({ ...command, expectedBinding: binding })).toEqual({
      ...command,
      expectedBinding: binding,
    });
    for (const invalid of [
      { ...command, id: '' },
      { ...command, idempotencyKey: '' },
      { ...command, idempotencyKey: 'retry\nintent' },
      { id: command.id },
      { ...command, token: 'private' },
      { ...command, expectedBinding: { ...binding, apiKey: 'private' } },
    ])
      expect(retryGenerationCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it('preserves unknown cost after successful or cleaned results', () => {
    expect(generationExecutionReceiptSchema.parse(receipt).costPoints).toBeNull();
    expect(
      generationExecutionReceiptSchema.parse({ ...receipt, purgedAt: receipt.updatedAt }).purgedAt,
    ).toBe(receipt.updatedAt);
    expect(generationExecutionReceiptSchema.safeParse({ ...receipt, costPoints: 0 }).success).toBe(
      false,
    );
    expect(
      generationExecutionReceiptSchema.safeParse({
        ...receipt,
        costProvenance: 'provider_reported',
      }).success,
    ).toBe(false);
  });

  it('keeps legacy payer knowledge explicitly missing and rejects mixed principals', () => {
    expect(
      generationExecutionReceiptSchema.safeParse({ ...receipt, operation: 'legacy_unknown' })
        .success,
    ).toBe(false);
    expect(
      generationExecutionReceiptSchema.parse({
        ...receipt,
        operation: 'legacy_unknown',
        bindingState: 'legacy_unbound',
        binding: null,
      }).operation,
    ).toBe('legacy_unknown');
    expect(
      generationExecutionReceiptSchema.parse({
        ...receipt,
        bindingState: 'legacy_unbound',
        binding: null,
      }).binding,
    ).toBeNull();
    expect(generationExecutionReceiptSchema.safeParse({ ...receipt, binding: null }).success).toBe(
      false,
    );
    expect(
      generationExecutionReceiptSchema.safeParse({ ...receipt, bindingState: 'legacy_unbound' })
        .success,
    ).toBe(false);
    expect(
      generationExecutionReceiptSchema.safeParse({ ...receipt, principalId: 'different' }).success,
    ).toBe(false);
  });

  it.each(['ciphertext', 'apiKey', 'authorizingSessionId', 'prompt', 'objectKey', 'signedUrl'])(
    'rejects private receipt field %s',
    (field) =>
      expect(
        generationExecutionReceiptSchema.safeParse({ ...receipt, [field]: 'private' }).success,
      ).toBe(false),
  );

  it('permits reserved keys for read-only lookup and rejects control characters', () => {
    expect(generationReceiptQuerySchema.parse({ key: 'scheme:execution-1' })).toEqual({
      key: 'scheme:execution-1',
    });
    expect(generationReceiptQuerySchema.safeParse({ key: 'request\n1' }).success).toBe(false);
    expect(
      generationReceiptQuerySchema.safeParse({ key: 'request-1', payer: binding.payer }).success,
    ).toBe(false);
  });
});
