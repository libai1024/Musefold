import { describe, expect, it } from 'vitest';

import { isInstallInRollout } from './rollout.ts';

describe('isInstallInRollout', () => {
  it('is stable for the same installId and bundleVersion', () => {
    const first = isInstallInRollout('install-a', '1.2.1-dev.412', 20);
    const second = isInstallInRollout('install-a', '1.2.1-dev.412', 20);
    expect(first).toBe(false);
    expect(second).toBe(first);
  });

  it('re-buckets when bundleVersion changes (fixed fixtures)', () => {
    // sha256("install-a\n1.2.1-dev.412") 前 4 字节大端 % 100 = 46
    expect(isInstallInRollout('install-a', '1.2.1-dev.412', 40)).toBe(false);
    expect(isInstallInRollout('install-a', '1.2.1-dev.412', 47)).toBe(true);
    // sha256("install-a\n1.2.1-dev.413") 前 4 字节大端 % 100 = 31
    expect(isInstallInRollout('install-a', '1.2.1-dev.413', 40)).toBe(true);
    expect(isInstallInRollout('install-a', '1.2.1-dev.413', 31)).toBe(false);
  });

  it('short-circuits 0 to false and 100 to true', () => {
    expect(isInstallInRollout('install-a', '1.2.1-dev.412', 0)).toBe(false);
    expect(isInstallInRollout('install-a', '1.2.1-dev.412', 100)).toBe(true);
    // bucket 99：若走哈希，percentage 100 仍为 true，但 0 必须与哈希无关。
    expect(isInstallInRollout('deadbeef-uuid', '1.0.0', 0)).toBe(false);
    expect(isInstallInRollout('deadbeef-uuid', '1.0.0', 100)).toBe(true);
    expect(isInstallInRollout('deadbeef-uuid', '1.0.0', 99)).toBe(false);
  });

  it('uses a newline separator so concatenated pairs do not collide', () => {
    // sha256("ab\nc") % 100 = 46；sha256("a\nbc") % 100 = 14
    expect(isInstallInRollout('ab', 'c', 20)).toBe(false);
    expect(isInstallInRollout('a', 'bc', 20)).toBe(true);
  });

  it('rejects a percentage outside 0–100 or a non-integer', () => {
    expect(() => isInstallInRollout('id', '1.0.0', -1)).toThrow(/integer between 0 and 100/);
    expect(() => isInstallInRollout('id', '1.0.0', 101)).toThrow(/integer between 0 and 100/);
    expect(() => isInstallInRollout('id', '1.0.0', 1.5)).toThrow(/integer between 0 and 100/);
    expect(() => isInstallInRollout('id', '1.0.0', Number.NaN)).toThrow(
      /integer between 0 and 100/,
    );
  });
});
