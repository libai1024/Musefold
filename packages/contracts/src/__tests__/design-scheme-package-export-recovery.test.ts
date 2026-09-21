import { expect, it } from 'vitest';
import {
  designSchemePackageExportHistoryQuerySchema,
  designSchemePackageExportHistorySchema,
  designSchemePackageExportRecoverySchema,
} from '../design-scheme-package-export-recovery';

const record = {
  export: {
    exportId: 'export',
    requestId: 'request',
    schemeId: 'scheme',
    revisionId: 'revision',
    status: 'ready',
    formatVersion: 2,
    packageHash: 'a'.repeat(64),
    sizeBytes: 64,
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  expectedVersion: 3,
  createdAt: '2026-09-09T00:00:00.000Z',
  schemeName: '方案',
};
it('bounds owner-scoped discovery without allowing authority or delivery claims', () => {
  expect(designSchemePackageExportHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
  for (const input of [{ limit: 0 }, { limit: 51 }, { userId: 'other' }, { cursor: '../other' }])
    expect(designSchemePackageExportHistoryQuerySchema.safeParse(input).success).toBe(false);
  expect(
    designSchemePackageExportHistorySchema.parse({ items: [record], nextCursor: null }).items,
  ).toHaveLength(1);
  for (const patch of [{ objectKey: 'private' }, { authorityHash: 'private' }, { delivered: true }])
    expect(
      designSchemePackageExportHistorySchema.safeParse({
        items: [{ ...record, ...patch }],
        nextCursor: null,
      }).success,
    ).toBe(false);
});
it('only current ready exports with no blocked reason can offer download', () => {
  const ready = { ...record, canDownload: true, blockedReason: null };
  expect(designSchemePackageExportRecoverySchema.parse(ready).canDownload).toBe(true);
  for (const patch of [
    { canDownload: false },
    { blockedReason: 'session_changed' },
    { export: { ...record.export, status: 'expired' } },
  ])
    expect(designSchemePackageExportRecoverySchema.safeParse({ ...ready, ...patch }).success).toBe(
      false,
    );
  expect(
    designSchemePackageExportRecoverySchema.parse({
      ...ready,
      canDownload: false,
      blockedReason: 'basis_changed',
    }).canDownload,
  ).toBe(false);
});
