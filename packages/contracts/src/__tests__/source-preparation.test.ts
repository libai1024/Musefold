import { describe, expect, it } from 'vitest';
import {
  prepareGithubSchemeSourceInputSchema,
  decideSchemeSourcePreparationInputSchema,
  schemeSourcePreparationSchema,
} from '../design-scheme-source-preparation';

describe('server source preparation contracts', () => {
  it('requires execution identity and rejects caller-supplied byte evidence', () => {
    const input = { executionId: 'source-1', repositoryUrl: 'https://github.com/example/design' };
    expect(prepareGithubSchemeSourceInputSchema.safeParse(input).success).toBe(true);
    expect(
      prepareGithubSchemeSourceInputSchema.safeParse({ ...input, contentHash: 'a'.repeat(64) })
        .success,
    ).toBe(false);
  });
  it('binds each decision to a specific confirmation', () => {
    expect(
      decideSchemeSourcePreparationInputSchema.safeParse({
        executionId: 'source-1',
        decision: 'install',
      }).success,
    ).toBe(false);
    expect(
      decideSchemeSourcePreparationInputSchema.safeParse({
        executionId: 'source-1',
        confirmationId: 'confirm-1',
        decision: 'install',
      }).success,
    ).toBe(true);
  });
  it('never exposes storage keys in a preparation view', () => {
    const view = {
      executionId: 'source-1',
      confirmationId: 'confirm-1',
      status: 'reading',
      source: null,
      snapshotId: null,
      contentHash: null,
      expiresAt: '2026-09-09T01:00:00Z',
    };
    expect(schemeSourcePreparationSchema.safeParse(view).success).toBe(true);
    expect(schemeSourcePreparationSchema.safeParse({ ...view, status: 'ready' }).success).toBe(
      false,
    );
    expect(
      schemeSourcePreparationSchema.safeParse({ ...view, objectKey: 'private/file' }).success,
    ).toBe(false);
  });
});
