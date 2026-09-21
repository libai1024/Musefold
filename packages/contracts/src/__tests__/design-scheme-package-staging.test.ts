import { expect, it } from 'vitest';
import {
  beginDesignSchemePackageUploadSchema,
  decideDesignSchemePackageStageSchema,
  designSchemePackageStageSchema,
} from '../design-scheme-package-staging';
const input = {
  requestId: 'request_1',
  packageHash: 'a'.repeat(64),
  sizeBytes: 4,
  formatVersion: 2,
};
it('accepts bounded immutable intent and normalizes exact SHA256 spelling', () => {
  expect(
    beginDesignSchemePackageUploadSchema.parse({
      ...input,
      packageHash: `sha256:${'A'.repeat(64)}`,
    }),
  ).toEqual(input);
});
it.each([
  { userId: 'other' },
  { objectKey: 'users/other/key' },
  { path: '/tmp/file' },
  { sizeBytes: 268435457 },
  { formatVersion: 3 },
])('rejects non-authoritative or out-of-budget input %j', (extra) => {
  expect(beginDesignSchemePackageUploadSchema.safeParse({ ...input, ...extra }).success).toBe(
    false,
  );
});
it.each(['ready', 'imported'])(
  'requires exact parser/hash identity and content facts for %s',
  (status) => {
    expect(
      decideDesignSchemePackageStageSchema.safeParse({ ...input, decision: 'confirm' }).success,
    ).toBe(false);
    expect(
      designSchemePackageStageSchema.safeParse({
        ...input,
        stagedPackageId: 'stage_1',
        status,
        parserVersion: 1,
        confirmationHash: null,
        preview: null,
        expiresAt: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  },
);
