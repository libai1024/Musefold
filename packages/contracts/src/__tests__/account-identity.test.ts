import { describe, expect, it } from 'vitest';
import {
  accountExecutionBindingSchema,
  accountIssuerSchema,
  accountRecoveryRequestSchema,
  accountRecoveryReviewSchema,
  accountSummarySchema,
} from '../index';

const summary = {
  id: 'upstream-42',
  username: 'creator',
  displayName: null,
  quota: 100,
  quotaUnit: 'points',
  canGenerate: true,
};
const identity = {
  apiIssuer: 'https://api.musefold.app',
  principalId: 'principal-7',
  status: 'active',
  identityVersion: 1,
};
const recovery = {
  requestId: 'request-1',
  reason: 'legacy_evidence_missing',
  expiresAt: '2026-09-08T02:00:00Z',
  actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
};
const binding = {
  status: 'available',
  apiIssuer: identity.apiIssuer,
  principalId: identity.principalId,
  payer: { issuer: 'https://billing.example.com', ownerId: summary.id },
  credential: { ref: 'credential-1', version: 2 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
  verifiedAt: '2026-09-08T01:00:00Z',
};

describe('account identity trust boundary', () => {
  it('represents a frozen model choice without widening provider or text capabilities', () => {
    expect(accountExecutionBindingSchema.parse({ ...binding, model: 'gpt-image-2' })).toMatchObject(
      { model: 'gpt-image-2' },
    );
    for (const model of ['', 'two models', 'secret\nvalue'])
      expect(accountExecutionBindingSchema.safeParse({ ...binding, model }).success).toBe(false);
    expect(
      accountExecutionBindingSchema.safeParse({ ...binding, providerId: 'client-provider' })
        .success,
    ).toBe(false);
    expect(
      accountExecutionBindingSchema.safeParse({
        ...binding,
        capabilities: { image: true, text: true },
      }).success,
    ).toBe(false);
  });
  it('keeps old summaries readable and distinct principal/payer identities explicit', () => {
    expect(accountSummarySchema.parse(summary)).toEqual(summary);
    expect(accountSummarySchema.parse({ ...summary, identity, recovery: null }).id).toBe(
      'upstream-42',
    );
    expect(accountExecutionBindingSchema.parse(binding)).toEqual(binding);
  });

  it.each(['unverified', 'verification_pending', 'identity_conflict', 'recovery_required'])(
    'never authorizes generation for %s despite available quota',
    (status) => {
      const value = { ...summary, identity: { ...identity, status }, recovery };
      expect(accountSummarySchema.safeParse(value).success).toBe(false);
      expect(accountSummarySchema.safeParse({ ...value, canGenerate: false }).success).toBe(true);
    },
  );

  it('rejects incoherent recovery, duplicate actions and credentials in recovery requests', () => {
    expect(
      accountSummarySchema.safeParse({ ...summary, canGenerate: false, recovery }).success,
    ).toBe(false);
    expect(
      accountSummarySchema.safeParse({ ...summary, canGenerate: false, identity, recovery })
        .success,
    ).toBe(false);
    expect(
      accountSummarySchema.safeParse({
        ...summary,
        canGenerate: false,
        identity: { ...identity, status: 'recovery_required' },
        recovery: { ...recovery, actions: ['retry', 'retry'] },
      }).success,
    ).toBe(false);
    expect(
      accountRecoveryRequestSchema.safeParse({ requestId: 'request-1', token: 'secret' }).success,
    ).toBe(false);
  });

  it.each([
    'not a URL',
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://example.com?token=x',
    'https://example.com#secret',
  ])('rejects unsafe issuer representation %s without throwing from safeParse', (issuer) => {
    expect(accountIssuerSchema.safeParse(issuer).success).toBe(false);
  });

  it('does not turn unverified or zero-version credentials into available bindings', () => {
    expect(
      accountExecutionBindingSchema.safeParse({
        ...binding,
        credential: { ref: 'key', version: 0 },
      }).success,
    ).toBe(false);
    expect(accountExecutionBindingSchema.safeParse({ ...binding, token: 'secret' }).success).toBe(
      false,
    );
    expect(
      accountExecutionBindingSchema.safeParse({ ...binding, status: 'unavailable' }).success,
    ).toBe(false);
    expect(
      accountExecutionBindingSchema.safeParse({
        status: 'unavailable',
        apiIssuer: identity.apiIssuer,
        principalId: identity.principalId,
        reason: 'IDENTITY_UNVERIFIED',
      }).success,
    ).toBe(true);
  });

  it('keeps original-device review limited to the matched candidate, without session secrets', () => {
    const value = {
      requestId: recovery.requestId,
      expiresAt: recovery.expiresAt,
      candidate: { ...binding.payer, username: summary.username, displayName: null },
    };
    expect(accountRecoveryReviewSchema.parse(value)).toEqual(value);
    expect(
      accountRecoveryReviewSchema.safeParse({ ...value, sessionToken: 'secret' }).success,
    ).toBe(false);
  });
});
