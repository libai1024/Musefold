import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';

const source = {
  DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/test',
  NEW_API_BASE_URL: 'https://provider.example.test',
  CREDENTIAL_ENCRYPTION_KEY: 'synthetic-environment-test-key',
};

describe('worker maintenance configuration', () => {
  it('runs cleanup by default and parses explicit false without truthiness coercion', () => {
    expect(loadEnv(source).MAINTENANCE_CLEANUP_PAUSED).toBe(false);
    expect(
      loadEnv({ ...source, MAINTENANCE_CLEANUP_PAUSED: 'false' }).MAINTENANCE_CLEANUP_PAUSED,
    ).toBe(false);
    expect(
      loadEnv({ ...source, MAINTENANCE_CLEANUP_PAUSED: 'true' }).MAINTENANCE_CLEANUP_PAUSED,
    ).toBe(true);
  });

  it.each(['', '0', '1', 'False', 'yes'])(
    'rejects ambiguous pause value %j at startup',
    (value) => {
      expect(() => loadEnv({ ...source, MAINTENANCE_CLEANUP_PAUSED: value })).toThrow();
    },
  );
});

describe('worker bucket bootstrap configuration', () => {
  it('preserves explicit false and defaults to the legacy enabled policy', () => {
    expect(loadEnv(source)).toHaveProperty('S3_AUTO_CREATE_BUCKET', true);
    expect(loadEnv({ ...source, S3_AUTO_CREATE_BUCKET: 'true' })).toHaveProperty(
      'S3_AUTO_CREATE_BUCKET',
      true,
    );
    expect(loadEnv({ ...source, S3_AUTO_CREATE_BUCKET: 'false' })).toHaveProperty(
      'S3_AUTO_CREATE_BUCKET',
      false,
    );
  });
  it.each(['', '0', '1', 'False', 'yes'])('rejects ambiguous auto-create value %j', (value) => {
    expect(() => loadEnv({ ...source, S3_AUTO_CREATE_BUCKET: value })).toThrow();
  });
});
