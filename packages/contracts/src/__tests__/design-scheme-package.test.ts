import { expect, it } from 'vitest';
import { DESIGN_SCHEME_PACKAGE_LIMITS, legacyDesignSchemePackageManifestSchema } from '../index';
it('retains the v1 envelope as a shared strict contract and one host-independent limit set', () => {
  const value = {
    format: 'musefold.design',
    formatVersion: 1,
    exportedAt: 0,
    scheme: {
      name: '旧方案',
      summary: '',
      fidelity: 'faithful',
      sourceLabel: '',
      sourcePresentation: 'skill',
    },
    revisionId: 'rev_old',
    snapshots: [],
    files: { 'scheme.json': 'a'.repeat(64) },
  };
  expect(legacyDesignSchemePackageManifestSchema.parse(value)).toEqual(value);
  expect(
    legacyDesignSchemePackageManifestSchema.safeParse({ ...value, formatVersion: 3 }).success,
  ).toBe(false);
  expect(
    legacyDesignSchemePackageManifestSchema.safeParse({ ...value, ownerId: 'forged' }).success,
  ).toBe(false);
  expect(DESIGN_SCHEME_PACKAGE_LIMITS).toMatchObject({
    archiveBytes: 268435456,
    expandedBytes: 268435456,
    entryBytes: 67108864,
    entries: 1024,
    manifestBytes: 4194304,
    compressionRatio: 200,
  });
});
