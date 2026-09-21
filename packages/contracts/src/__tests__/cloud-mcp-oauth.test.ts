import { describe, expect, it } from 'vitest';
import { cloudMcpOAuthDecisionSchema, cloudMcpOAuthReviewSchema } from '../cloud-mcp';

describe('Cloud MCP browser contracts', () => {
  it('accepts a namespaced continuation but rejects external and traversing destinations', () => {
    const schema = cloudMcpOAuthReviewSchema.shape.continueUrl;
    expect(schema.safeParse('/Musefold/v25/api/auth/oauth2/authorize?code=test').success).toBe(
      true,
    );
    for (const url of [
      '//evil.test/api/auth/oauth2/authorize?x',
      '/Musefold/../api/auth/oauth2/authorize?x',
      'https://evil.test/api/auth/oauth2/authorize?x',
    ]) {
      expect(schema.safeParse(url).success).toBe(false);
    }
  });
  it('requires a fixed signed request and bounded confirmation for either decision', () => {
    expect(
      cloudMcpOAuthDecisionSchema.safeParse({ oauth_query: '', accept: true, reviewRef: 'ref' })
        .success,
    ).toBe(false);
    expect(
      cloudMcpOAuthDecisionSchema.safeParse({ oauth_query: 'signed', accept: false }).success,
    ).toBe(false);
    expect(
      cloudMcpOAuthDecisionSchema.safeParse({
        oauth_query: 'signed',
        accept: false,
        reviewRef: 'ref',
        returnTo: 'https://untrusted.example',
      }).success,
    ).toBe(false);
  });
  it('never broadens the browser display into paid/write scopes', () => {
    expect(
      cloudMcpOAuthReviewSchema.shape.scopes.safeParse(['prompts:read', 'generation:write'])
        .success,
    ).toBe(false);
    expect(
      cloudMcpOAuthReviewSchema.shape.scopes.safeParse([
        'account:read',
        'prompts:read',
        'skills:read',
        'offline_access',
      ]).success,
    ).toBe(true);
  });
});
