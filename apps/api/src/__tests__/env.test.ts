import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://musefold:musefold@127.0.0.1:5432/musefold',
  BETTER_AUTH_SECRET: 'test-secret-at-least-16',
  NEW_API_BASE_URL: 'https://new-api.test',
  CREDENTIAL_ENCRYPTION_KEY: 'test-encryption-key-16',
};

describe('loadEnv', () => {
  it('defaults to no proxy trust and accepts explicitly scoped address rules', () => {
    expect(loadEnv(REQUIRED)).toHaveProperty('TRUST_PROXY', 'false');
    expect(loadEnv({ ...REQUIRED, TRUST_PROXY: 'loopback,10.0.0.0/8' })).toHaveProperty(
      'TRUST_PROXY',
      'loopback,10.0.0.0/8',
    );
  });
  it.each([
    '',
    'true',
    '*',
    '1',
    'false,127.0.0.1',
    'proxy.example.test',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.1/33',
    '2001:db8::/129',
    '127.0.0.1,',
  ])('rejects unsafe or ambiguous proxy trust %j', (trust) => {
    expect(() => loadEnv({ ...REQUIRED, TRUST_PROXY: trust })).toThrow();
  });
  it('requires explicit historical issuer evidence instead of inheriting the current upstream', () => {
    expect(loadEnv(REQUIRED).LEGACY_NEW_API_ISSUER).toBeUndefined();
    expect(
      loadEnv({ ...REQUIRED, LEGACY_NEW_API_ISSUER: 'https://historical.example.test' })
        .LEGACY_NEW_API_ISSUER,
    ).toBe('https://historical.example.test');
    expect(() => loadEnv({ ...REQUIRED, LEGACY_NEW_API_ISSUER: 'not-an-issuer' })).toThrow();
  });
  it('development 默认信任本地 Web 壳 Origin,避免 Next 反代写请求被 CSRF 挡掉', () => {
    const env = loadEnv({ ...REQUIRED, NODE_ENV: 'development' });
    expect(env.trustedOrigins).toEqual(
      expect.arrayContaining(['http://127.0.0.1:3399', 'http://localhost:3399']),
    );
  });

  it('production 不默认放行本地 Web 壳,只收 TRUSTED_ORIGINS', () => {
    const env = loadEnv({
      ...REQUIRED,
      NODE_ENV: 'production',
      TRUSTED_ORIGINS: 'https://app.musefold.app',
    });
    expect(env.trustedOrigins).toEqual(['https://app.musefold.app']);
  });
});
