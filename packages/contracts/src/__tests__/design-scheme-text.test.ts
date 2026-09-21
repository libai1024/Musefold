import { describe, expect, it } from 'vitest';
import {
  designSchemeTextAuthorizationSchema,
  designSchemeTextProgressSchema,
  designSchemeTextBindingSchema,
  executionBindingSchema,
  accountExecutionIdentitySchema,
} from '../index';
const identity = {
  apiIssuer: 'https://api.example.test',
  principalId: 'owner',
  payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
  credential: { ref: 'credential', version: 1 },
};
const binding = {
  ...identity,
  providerId: 'cloud-agent',
  model: 'text-model',
  capabilities: { image: false, text: true },
  policyVersion: 'agent-text-v1',
};
const authorization = { binding, maxModelCalls: 1, maxOutputTokens: 8192, acceptUnknownCost: true };
describe('explicit text execution scope', () => {
  it('separates identity from capability, and keeps the image policy unchanged', () => {
    expect(accountExecutionIdentitySchema.parse(identity)).toEqual(identity);
    expect(designSchemeTextBindingSchema.parse(binding)).toEqual(binding);
    expect(executionBindingSchema.safeParse(binding).success).toBe(false);
    expect(
      designSchemeTextBindingSchema.safeParse({
        ...binding,
        capabilities: { image: true, text: true },
      }).success,
    ).toBe(false);
  });
  it('requires a bounded explicit unknown-cost authorization without caller keys or URLs', () => {
    expect(designSchemeTextAuthorizationSchema.parse(authorization)).toEqual(authorization);
    for (const patch of [
      { maxModelCalls: 0 },
      { maxModelCalls: 18 },
      { maxOutputTokens: 16384 },
      { acceptUnknownCost: false },
      { apiKey: 'not-allowed' },
      { endpoint: 'https://other.example' },
    ])
      expect(
        designSchemeTextAuthorizationSchema.safeParse({ ...authorization, ...patch }).success,
      ).toBe(false);
  });
  it('keeps accepted send claims, completed calls, budget and cost state coherent', () => {
    const progress = {
      model: 'text-model',
      maxModelCalls: 2,
      callsSent: 1,
      callsCompleted: 0,
      cost: 'unknown',
    };
    expect(designSchemeTextProgressSchema.parse(progress)).toEqual(progress);
    for (const patch of [
      { callsCompleted: 2 },
      { callsSent: 3 },
      { cost: 'not-incurred' },
      { callsSent: 0 },
    ])
      expect(designSchemeTextProgressSchema.safeParse({ ...progress, ...patch }).success).toBe(
        false,
      );
    expect(
      designSchemeTextProgressSchema.parse({ ...progress, callsSent: 0, cost: 'not-incurred' })
        .cost,
    ).toBe('not-incurred');
  });
});
