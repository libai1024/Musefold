import { expect, it } from 'vitest';
import {
  designSchemePackageRecoveryQuerySchema,
  designSchemePackageRecoverySchema,
  designSchemePackageRecoveryPageSchema,
} from '../design-scheme-package-recovery';

const item = {
  stage: {
    stagedPackageId: 'stage_1',
    requestId: 'request_1',
    packageHash: 'a'.repeat(64),
    sizeBytes: 3,
    formatVersion: 2,
    parserVersion: 1,
    status: 'awaiting_upload',
    preview: null,
    confirmationHash: null,
    expiresAt: '2026-10-01T00:00:00.000Z',
  },
  createdAt: '2026-09-09T00:00:00.000Z',
  execution: 'not_started',
  receipt: null,
  canContinue: true,
  blockedReason: null,
};
it('bounds owner-scoped keyset pagination and rejects authority supplied by the client', () => {
  expect(designSchemePackageRecoveryQuerySchema.parse({})).toEqual({ limit: 20 });
  expect(designSchemePackageRecoveryQuerySchema.parse({ limit: '2', cursor: 'stage_1' })).toEqual({
    limit: 2,
    cursor: 'stage_1',
  });
  for (const query of [
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { userId: 'other' },
    { cursor: '../other' },
  ])
    expect(designSchemePackageRecoveryQuerySchema.safeParse(query).success).toBe(false);
});
it('allows only bounded public metadata and consistent continuation/execution state', () => {
  expect(designSchemePackageRecoverySchema.parse(item)).toEqual(item);
  for (const patch of [
    { authorityHash: 'secret' },
    { objectKey: 'private/key' },
    { execution: 'completed' },
    { execution: 'running' },
    { canContinue: false },
    { blockedReason: 'session_changed' },
  ])
    expect(designSchemePackageRecoverySchema.safeParse({ ...item, ...patch }).success).toBe(false);
  expect(
    designSchemePackageRecoverySchema.parse({
      ...item,
      execution: 'running',
      canContinue: false,
      blockedReason: 'import_in_progress',
    }).execution,
  ).toBe('running');
  expect(
    designSchemePackageRecoveryPageSchema.safeParse({
      items: Array(51).fill(item),
      nextCursor: null,
    }).success,
  ).toBe(false);
});
