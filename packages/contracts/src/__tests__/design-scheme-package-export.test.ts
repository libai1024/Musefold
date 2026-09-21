import { describe, expect, it } from 'vitest';
import {
  beginDesignSchemePackageExportSchema,
  designSchemePackageExportSchema,
  designSchemePackageDeliverySchema,
} from '../design-scheme-package-export';
const input = {
  requestId: 'request',
  schemeId: 'scheme',
  revisionId: 'revision',
  expectedVersion: 1,
  formatVersion: 2,
};
const dto = {
  exportId: 'export',
  requestId: 'request',
  schemeId: 'scheme',
  revisionId: 'revision',
  formatVersion: 2,
  status: 'ready',
  packageHash: 'a'.repeat(64),
  sizeBytes: 32,
  expiresAt: '2026-09-09T10:00:00.000Z',
};
describe('cloud export freezes the selected formal version without claiming host delivery', () => {
  it('keeps host handoff distinct from saved bytes and from server staging', () => {
    for (const status of ['delivered', 'download-started', 'cancelled'])
      expect(designSchemePackageDeliverySchema.parse({ exportId: 'export', status }).status).toBe(
        status,
      );
    for (const bad of [
      { exportId: 'export', status: 'ready' },
      { status: 'delivered' },
      { exportId: 'export', status: 'delivered', path: '/private/file' },
    ])
      expect(designSchemePackageDeliverySchema.safeParse(bad).success).toBe(false);
  });
  it('requires precise revision/version and excludes owner/storage fields', () => {
    expect(beginDesignSchemePackageExportSchema.parse(input)).toEqual(input);
    for (const bad of [
      { ...input, revisionId: undefined },
      { ...input, expectedVersion: 0 },
      { ...input, formatVersion: 1 },
      { ...input, userId: 'someone' },
      { ...input, objectKey: 'x' },
    ])
      expect(beginDesignSchemePackageExportSchema.safeParse(bad).success).toBe(false);
  });
  it('requires actual hash and size for ready and never accepts delivered from the server', () => {
    expect(designSchemePackageExportSchema.parse(dto)).toEqual(dto);
    for (const bad of [
      { ...dto, packageHash: null },
      { ...dto, sizeBytes: null },
      { ...dto, sizeBytes: 268435457 },
      { ...dto, status: 'delivered' },
      { ...dto, objectKey: 'private' },
    ])
      expect(designSchemePackageExportSchema.safeParse(bad).success).toBe(false);
  });
  it.each(['preparing', 'failed', 'cancelled', 'expired'])(
    'can observe %s without pretending bytes exist',
    (status) => {
      expect(
        designSchemePackageExportSchema.parse({
          ...dto,
          status,
          packageHash: null,
          sizeBytes: null,
        }).status,
      ).toBe(status);
    },
  );
});
