import { describe, expect, it } from 'vitest';

import {
  CHANNELS,
  DEFAULT_CHANNEL,
  KNOWN_SURFACE_IDS,
  SUPPORTED_SCHEMA_VERSIONS,
  manifestBodySchema,
  signedManifestSchema,
} from './schema.ts';

const shaA = 'ab'.repeat(32);
const shaB = 'cd'.repeat(32);

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'dev',
    bundleVersion: '1.2.1-dev.412',
    gitSha: '0ce9aac',
    createdAt: '2026-08-20T00:00:00Z',
    minShellVersion: '1.2.1',
    maxShellVersion: null,
    surfaces: {
      'electron-renderer': {
        url: 'https://cdn.example.test/Musefold/bundles/dev/1.2.1-dev.412/renderer.tar.zst',
        sha256: shaA,
        bytes: 2431044,
      },
      'capacitor-web': {
        url: 'https://cdn.example.test/Musefold/bundles/dev/1.2.1-dev.412/capacitor.tar.zst',
        sha256: shaB,
        bytes: 2380112,
      },
    },
    rollout: { percentage: 20 },
    ...overrides,
  };
}

describe('manifest schema', () => {
  it('exports channel constants and schema version 1', () => {
    expect(CHANNELS).toEqual(['dev', 'beta', 'stable']);
    expect(DEFAULT_CHANNEL).toBe('stable');
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1]);
    expect(KNOWN_SURFACE_IDS).toEqual(['electron-renderer', 'capacitor-web']);
  });

  it('accepts the protocol §2 example shape, including maxShellVersion null', () => {
    const parsed = manifestBodySchema.parse(validBody());
    expect(parsed.maxShellVersion).toBeNull();
    expect(parsed.channel).toBe('dev');
    expect(parsed.rollout.percentage).toBe(20);
  });

  it('rejects omitted maxShellVersion (null is required, not default)', () => {
    const body = validBody();
    delete body.maxShellVersion;
    expect(manifestBodySchema.safeParse(body).success).toBe(false);
  });

  it('ignores unknown surfaces instead of failing the document', () => {
    const parsed = manifestBodySchema.parse(
      validBody({
        surfaces: {
          'electron-renderer': {
            url: 'https://cdn.example.test/renderer.tar.zst',
            sha256: shaA,
            bytes: 10,
          },
          'future-tv': 'not-even-an-object',
          experimental: { url: 'ftp://bad.example/', sha256: 'nope', bytes: -1 },
        },
      }),
    );
    expect(parsed.surfaces['electron-renderer']?.bytes).toBe(10);
    expect(parsed.surfaces).not.toHaveProperty('future-tv');
    expect(parsed.surfaces).not.toHaveProperty('experimental');
  });

  it('ignores web (not a negotiated surface) rather than rejecting the manifest', () => {
    const parsed = manifestBodySchema.parse(
      validBody({
        surfaces: {
          web: {
            url: 'http://not-https.example/app',
            sha256: 'zzzz',
            bytes: 0,
          },
          'capacitor-web': {
            url: 'https://cdn.example.test/capacitor.tar.zst',
            sha256: shaB,
            bytes: 12,
          },
        },
      }),
    );
    expect(parsed.surfaces.web).toBeUndefined();
    expect(parsed.surfaces['capacitor-web']?.bytes).toBe(12);
  });

  it('keeps capacitor-web and electron-renderer while stripping web and unknown surface ids', () => {
    const parsed = manifestBodySchema.parse(
      validBody({
        surfaces: {
          'electron-renderer': {
            url: 'https://cdn.example.test/renderer.tar.zst',
            sha256: shaA,
            bytes: 10,
          },
          'capacitor-web': {
            url: 'https://cdn.example.test/capacitor.tar.zst',
            sha256: shaB,
            bytes: 12,
          },
          web: {
            url: 'http://not-https.example/app',
            sha256: 'zzzz',
            bytes: 0,
          },
          'android-web': {
            url: 'ftp://ignored.example/android',
            sha256: 'not-a-digest',
            bytes: -1,
          },
        },
      }),
    );
    expect(parsed.surfaces['electron-renderer']?.bytes).toBe(10);
    expect(parsed.surfaces['capacitor-web']?.bytes).toBe(12);
    expect(parsed.surfaces).not.toHaveProperty('web');
    expect(parsed.surfaces).not.toHaveProperty('android-web');
  });

  it('still rejects a malformed known surface', () => {
    const result = manifestBodySchema.safeParse(
      validBody({
        surfaces: {
          'electron-renderer': { url: 'http://insecure.example/', sha256: shaA, bytes: 1 },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('strips unknown keys on the top-level body, rollout, and known surface artifacts', () => {
    const parsed = manifestBodySchema.parse(
      validBody({
        ttlSeconds: 3600,
        rollout: { percentage: 20, wave: 'canary' },
        surfaces: {
          'electron-renderer': {
            url: 'https://cdn.example.test/renderer.tar.zst',
            sha256: shaA,
            bytes: 10,
            codec: 'zstd',
          },
        },
      }),
    );
    expect(parsed).not.toHaveProperty('ttlSeconds');
    expect(parsed.rollout).toEqual({ percentage: 20 });
    expect(parsed.surfaces['electron-renderer']).toEqual({
      url: 'https://cdn.example.test/renderer.tar.zst',
      sha256: shaA,
      bytes: 10,
    });
  });

  it('normalizes gitSha and sha256 to lowercase without rejecting uppercase input', () => {
    const parsed = manifestBodySchema.parse(
      validBody({
        gitSha: '0CE9AAC',
        surfaces: {
          'electron-renderer': {
            url: 'https://cdn.example.test/renderer.tar.zst',
            sha256: shaA.toUpperCase(),
            bytes: 10,
          },
        },
      }),
    );
    expect(parsed.gitSha).toBe('0ce9aac');
    expect(parsed.surfaces['electron-renderer']?.sha256).toBe(shaA);
  });

  it('rejects unknown schemaVersion, channel, and non-https URLs at the v1 schema', () => {
    expect(manifestBodySchema.safeParse(validBody({ schemaVersion: 2 })).success).toBe(false);
    expect(manifestBodySchema.safeParse(validBody({ channel: 'nightly' })).success).toBe(false);
    expect(signedManifestSchema.safeParse({ ...validBody(), signature: '@@@' }).success).toBe(
      false,
    );
  });

  it('requires rollout.percentage to be an integer 0-100', () => {
    expect(manifestBodySchema.safeParse(validBody({ rollout: { percentage: 20.5 } })).success).toBe(
      false,
    );
    expect(manifestBodySchema.safeParse(validBody({ rollout: { percentage: -1 } })).success).toBe(
      false,
    );
    expect(manifestBodySchema.safeParse(validBody({ rollout: { percentage: 101 } })).success).toBe(
      false,
    );
    expect(manifestBodySchema.safeParse(validBody({ rollout: { percentage: 0 } })).success).toBe(
      true,
    );
    expect(manifestBodySchema.safeParse(validBody({ rollout: { percentage: 100 } })).success).toBe(
      true,
    );
  });

  it('requires createdAt to be ISO-8601 UTC (Z), not a numeric offset', () => {
    expect(
      manifestBodySchema.safeParse(validBody({ createdAt: '2026-08-20T00:00:00+08:00' })).success,
    ).toBe(false);
    expect(
      manifestBodySchema.safeParse(validBody({ createdAt: '2026-08-20T00:00:00Z' })).success,
    ).toBe(true);
  });
});
