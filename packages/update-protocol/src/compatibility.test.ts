import { describe, expect, it } from 'vitest';

import { isShellVersionCompatible, isStrictlyNewerBundleVersion } from './compatibility.ts';

describe('semver compatibility helpers', () => {
  it('treats 0.5.0-dev as less than 0.5.0 for minShellVersion', () => {
    expect(isShellVersionCompatible('0.5.0-dev', '0.5.0', null)).toBe(false);
    expect(isShellVersionCompatible('0.5.0', '0.5.0-dev', null)).toBe(true);
    expect(isShellVersionCompatible('0.5.0-dev', '0.5.0-dev', null)).toBe(true);
  });

  it('caps old bundles with maxShellVersion, including prerelease', () => {
    expect(isShellVersionCompatible('0.5.0', '0.4.0', '0.5.0-dev')).toBe(false);
    expect(isShellVersionCompatible('0.5.0-dev', '0.4.0', '0.5.0-dev')).toBe(true);
    expect(isShellVersionCompatible('9.0.0', '0.4.0', null)).toBe(true);
  });

  it('requires a strictly newer bundleVersion', () => {
    expect(isStrictlyNewerBundleVersion('1.2.1-dev.412', '1.2.1-dev.411')).toBe(true);
    expect(isStrictlyNewerBundleVersion('1.2.1-dev.412', '1.2.1-dev.412')).toBe(false);
    expect(isStrictlyNewerBundleVersion('1.2.1-dev.412', null)).toBe(true);
    expect(isStrictlyNewerBundleVersion('1.2.1', '1.2.1-dev.412')).toBe(true);
  });
});
