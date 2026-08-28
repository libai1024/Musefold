import { describe, expect, it } from 'vitest';
import { openJson, openJsonFromString, sealJson, sealJsonToString } from '../index.js';

const KEY = 'unit-test-key-material';

describe('server-crypto', () => {
  it('sealJson/openJson 往返一致', () => {
    const sealed = sealJson({ apiKey: 'sk-demo' }, KEY);
    expect(openJson<{ apiKey: string }>(sealed, KEY)).toEqual({ apiKey: 'sk-demo' });
  });

  it('sealJsonToString/openJsonFromString 往返一致且携带版本前缀', () => {
    const encoded = sealJsonToString({ jwt: 'a.b.c', refreshToken: 'r1' }, KEY);
    expect(encoded.startsWith('v1.')).toBe(true);
    expect(openJsonFromString<{ jwt: string }>(encoded, KEY).jwt).toBe('a.b.c');
  });

  it('密钥不匹配时解密失败', () => {
    const encoded = sealJsonToString({ secret: 1 }, KEY);
    expect(() => openJsonFromString(encoded, 'other-key')).toThrow();
  });

  it('格式损坏时给出明确错误', () => {
    expect(() => openJsonFromString('v2.x.y.z', KEY)).toThrow('密文格式无效');
    expect(() => openJsonFromString('not-encoded', KEY)).toThrow('密文格式无效');
  });
});
