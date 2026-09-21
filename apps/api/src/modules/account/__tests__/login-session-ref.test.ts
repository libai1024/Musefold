import { describe, expect, it } from 'vitest';
import { loginSessionRefs } from '../login-session-ref.js';

describe('opaque device handles', () => {
  const sid = '77230c99-8788-4798-94ad-4992a1fcaa35';
  const codec = loginSessionRefs('synthetic-key', 'https://issuer.example', 'flow:a');
  it('round trips without exposing the upstream SID and stays within the public bound', () => {
    const ref = codec.encode(sid);
    expect(ref.length).toBeLessThanOrEqual(64);
    expect(ref).not.toContain(sid);
    expect(codec.decode(ref)).toBe(sid);
    expect(codec.encode(sid)).not.toBe(ref);
  });
  it('rejects transfer to another flow, authenticated session, issuer or key', () => {
    const ref = codec.encode(sid);
    for (const other of [
      loginSessionRefs('synthetic-key', 'https://issuer.example', 'flow:b'),
      loginSessionRefs('synthetic-key', 'https://issuer.example', 'session:a'),
      loginSessionRefs('synthetic-key', 'https://other.example', 'flow:a'),
      loginSessionRefs('another-key', 'https://issuer.example', 'flow:a'),
    ]) {
      expect(() => other.decode(ref)).toThrow('设备选择已失效');
    }
  });
  it('rejects raw SIDs, malformed handles and authentication-tag modification', () => {
    const ref = codec.encode(sid);
    for (const invalid of [
      sid,
      '',
      'x'.repeat(65),
      `_${ref}`,
      `${ref.slice(0, 20)}${ref[20] === 'a' ? 'b' : 'a'}${ref.slice(21)}`,
    ])
      expect(() => codec.decode(invalid)).toThrow();
  });
});
