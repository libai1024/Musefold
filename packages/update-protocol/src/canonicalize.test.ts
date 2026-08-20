import { describe, expect, it } from 'vitest';

import { CanonicalizeError, canonicalize } from './canonicalize.ts';

function utf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

describe('canonicalize', () => {
  it('sorts object keys by UTF-16 code units regardless of insertion order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { m: 3, a: 2, z: 1 };
    expect(utf8(canonicalize(a))).toBe('{"a":2,"m":3,"z":1}');
    expect(Buffer.from(canonicalize(a)).equals(Buffer.from(canonicalize(b)))).toBe(true);
  });

  it('preserves null and does not treat it as omitted', () => {
    expect(utf8(canonicalize({ maxShellVersion: null, keep: 1 }))).toBe(
      '{"keep":1,"maxShellVersion":null}',
    );
  });

  it('keeps array order and recurses into nested objects', () => {
    const value = {
      surfaces: {
        'electron-renderer': { bytes: 2, url: 'https://a.test/' },
        extra: [{ b: 1, a: 0 }, { a: 9 }],
      },
    };
    expect(utf8(canonicalize(value))).toBe(
      '{"surfaces":{"electron-renderer":{"bytes":2,"url":"https://a.test/"},"extra":[{"a":0,"b":1},{"a":9}]}}',
    );
  });

  it('emits no extra whitespace', () => {
    expect(utf8(canonicalize({ a: true, b: false, c: 'x' }))).toBe('{"a":true,"b":false,"c":"x"}');
  });

  it('rejects undefined, non-finite numbers, and non-JSON values', () => {
    expect(() => canonicalize(undefined)).toThrow(CanonicalizeError);
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizeError);
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizeError);
    expect(() => canonicalize(1n)).toThrow(CanonicalizeError);
    expect(() => canonicalize(() => 1)).toThrow(CanonicalizeError);
    expect(() => canonicalize(Symbol('x'))).toThrow(CanonicalizeError);
    expect(() => canonicalize(new Date())).toThrow(CanonicalizeError);
    expect(() => canonicalize({ when: new Date() })).toThrow(CanonicalizeError);
  });

  it('rejects cyclic objects', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(CanonicalizeError);
  });
});
