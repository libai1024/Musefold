import { describe, expect, it } from 'vitest';
import { migrationEnvironment } from '../migrate.js';

const release = 'a'.repeat(40);
describe('deployment migration configuration', () => {
  it('requires a dedicated migration credential and full release identity', () => {
    expect(
      migrationEnvironment({
        MIGRATION_DATABASE_URL: 'postgresql://migration:private@db/app',
        MIGRATION_RELEASE: release,
      }),
    ).toEqual({
      MIGRATION_DATABASE_URL: 'postgresql://migration:private@db/app',
      MIGRATION_RELEASE: release,
    });
    expect(() =>
      migrationEnvironment({
        DATABASE_URL: 'postgres://runtime:private@db/app',
        MIGRATION_RELEASE: release,
      }),
    ).toThrow('MIGRATION_CONFIGURATION_INVALID');
  });

  it.each(['', 'main', 'abc1234', 'A'.repeat(40), 'a'.repeat(41)])(
    'rejects release %s',
    (value) => {
      expect(() =>
        migrationEnvironment({
          MIGRATION_DATABASE_URL: 'postgres://migration:private@db/app',
          MIGRATION_RELEASE: value,
        }),
      ).toThrow('MIGRATION_CONFIGURATION_INVALID');
    },
  );

  it('does not expose invalid input or accept a non-Postgres connection', () => {
    expect(() =>
      migrationEnvironment({
        MIGRATION_DATABASE_URL: 'https://private-secret@db/app',
        MIGRATION_RELEASE: release,
      }),
    ).toThrow(/^MIGRATION_CONFIGURATION_INVALID$/);
  });
});
