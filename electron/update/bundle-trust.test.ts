import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  generateBundleSigningKeyPair,
  signCanonicalBytes,
  signManifest,
} from '@musefold/update-protocol';

import {
  BUNDLE_TRUST_PUBLIC_KEYS,
  ContentManifestFailureReason,
  PRIMARY_BUNDLE_PUBLIC_KEY,
  BACKUP_BUNDLE_PUBLIC_KEY,
  verifyContentManifest,
} from './bundle-trust';

const shaA = 'ab'.repeat(32);

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'dev',
    bundleVersion: '1.2.1-dev.412',
    gitSha: '0ce9aac',
    createdAt: '2026-08-20T00:00:00Z',
    minShellVersion: '0.5.0-dev',
    maxShellVersion: null,
    surfaces: {
      'electron-renderer': {
        url: 'https://cdn.example.test/renderer.tar.zst',
        sha256: shaA,
        bytes: 2431044,
      },
    },
    rollout: { percentage: 20 },
    ...overrides,
  };
}

function signedJson(privateKey: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(signManifest(validBody(overrides), privateKey));
}

function defaultOptions(publicKeys: readonly string[]) {
  return {
    currentShellVersion: '0.5.0-dev',
    appliedBundleVersion: '1.2.1-dev.411',
    rejectedVersions: [] as string[],
    expectedChannel: 'dev' as const,
    publicKeys,
  };
}

describe('bundle-trust constants', () => {
  it('ships empty public-key slots (fail-closed, no placeholder trust anchors)', () => {
    expect(PRIMARY_BUNDLE_PUBLIC_KEY).toBe('');
    expect(BACKUP_BUNDLE_PUBLIC_KEY).toBe('');
    expect(BUNDLE_TRUST_PUBLIC_KEYS).toEqual([]);
  });
});

describe('verifyContentManifest', () => {
  it('fails closed when no public keys are configured', () => {
    const { privateKey } = generateBundleSigningKeyPair();
    const result = verifyContentManifest(signedJson(privateKey), {
      ...defaultOptions([]),
      publicKeys: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(ContentManifestFailureReason.trust_anchor_missing);
    expect(result.message).not.toMatch(/\/|\\/);
    expect(result.message.toLowerCase()).not.toContain('key');
  });

  it('accepts a manifest signed by the backup key after the primary fails', () => {
    const primary = generateBundleSigningKeyPair();
    const backup = generateBundleSigningKeyPair();
    const json = signedJson(backup.privateKey);
    const rejected = verifyContentManifest(json, defaultOptions([primary.publicKey]));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe(ContentManifestFailureReason.invalid_signature);

    const accepted = verifyContentManifest(
      json,
      defaultOptions([primary.publicKey, backup.publicKey]),
    );
    expect(accepted.ok).toBe(true);
  });

  it('rejects unknown schemaVersion only after the signature succeeds', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const body = { ...validBody(), schemaVersion: 2 };
    const signature = signCanonicalBytes(canonicalize(body), privateKey);
    const signedUnknown = JSON.stringify({ ...body, signature });

    const afterVerify = verifyContentManifest(signedUnknown, defaultOptions([publicKey]));
    expect(afterVerify.ok).toBe(false);
    if (!afterVerify.ok) {
      expect(afterVerify.reason).toBe(ContentManifestFailureReason.unsupported_schema_version);
    }

    const tampered = JSON.stringify({ ...body, signature: 'a'.repeat(88) });
    const beforeSchema = verifyContentManifest(tampered, defaultOptions([publicKey]));
    expect(beforeSchema.ok).toBe(false);
    if (!beforeSchema.ok) {
      expect(beforeSchema.reason).toBe(ContentManifestFailureReason.invalid_signature);
    }
  });

  it('rejects a validly signed manifest from another channel', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { channel: 'dev' });
    const mismatched = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      expectedChannel: 'stable',
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.reason).toBe(ContentManifestFailureReason.channel_mismatch);
      expect(mismatched.message.toLowerCase()).not.toContain('dev');
      expect(mismatched.message.toLowerCase()).not.toContain('stable');
    }

    const matched = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      expectedChannel: 'dev',
    });
    expect(matched.ok).toBe(true);
  });

  it('accepts a signed manifest that carries unknown top-level fields', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { ttlSeconds: 3600 });
    const result = verifyContentManifest(json, defaultOptions([publicKey]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).not.toHaveProperty('ttlSeconds');
    expect(result.manifest.bundleVersion).toBe('1.2.1-dev.412');
  });

  it('rejects a shell below minShellVersion, including prerelease boundaries', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { minShellVersion: '0.5.0' });
    const result = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      currentShellVersion: '0.5.0-dev',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('incompatible_shell_version');
  });

  it('rejects a shell above maxShellVersion (prerelease cap)', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { maxShellVersion: '0.5.0-dev' });
    const result = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      currentShellVersion: '0.5.0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('incompatible_shell_version');
  });

  it('allows the current shell when it equals min and max, and when max is null', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const capped = signedJson(privateKey, {
      minShellVersion: '0.5.0-dev',
      maxShellVersion: '0.5.0-dev',
    });
    expect(
      verifyContentManifest(capped, {
        ...defaultOptions([publicKey]),
        currentShellVersion: '0.5.0-dev',
      }).ok,
    ).toBe(true);

    const uncapped = signedJson(privateKey, { maxShellVersion: null });
    expect(
      verifyContentManifest(uncapped, {
        ...defaultOptions([publicKey]),
        currentShellVersion: '9.0.0',
      }).ok,
    ).toBe(true);
  });

  it('rejects a bundleVersion that is not strictly newer', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { bundleVersion: '1.2.1-dev.412' });
    const same = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      appliedBundleVersion: '1.2.1-dev.412',
    });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.reason).toBe('bundle_version_not_increasing');

    const older = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      appliedBundleVersion: '1.2.1-dev.413',
    });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.reason).toBe('bundle_version_not_increasing');
  });

  it('rejects a bundleVersion on the reject list', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, { bundleVersion: '1.2.1-dev.412' });
    const result = verifyContentManifest(json, {
      ...defaultOptions([publicKey]),
      appliedBundleVersion: '1.2.1-dev.400',
      rejectedVersions: ['1.2.1-dev.412'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bundle_version_rejected');
  });

  it('ignores unknown surfaces and the web surface after a valid signature', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey, {
      surfaces: {
        web: { url: 'http://ignored.example/', sha256: 'nope', bytes: 0 },
        'future-tv': 'garbage',
        'electron-renderer': {
          url: 'https://cdn.example.test/renderer.tar.zst',
          sha256: shaA,
          bytes: 99,
        },
      },
    });
    const result = verifyContentManifest(json, defaultOptions([publicKey]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.surfaces['electron-renderer']?.bytes).toBe(99);
    expect(result.manifest.surfaces).not.toHaveProperty('web');
    expect(result.manifest.surfaces).not.toHaveProperty('future-tv');
  });

  it('keeps failure messages free of paths, keys, and signature bytes', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const json = signedJson(privateKey);
    const result = verifyContentManifest(json.replace('1.2.1-dev.412', '9.9.9'), {
      ...defaultOptions([publicKey]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toMatch(/[A-Za-z0-9+/]{40,}/);
    expect(result.message).not.toContain(publicKey);
    expect(result.message).not.toContain('/');
  });

  it('rejects invalid JSON before looking at trust anchors', () => {
    const result = verifyContentManifest('{not json', {
      currentShellVersion: '0.5.0-dev',
      appliedBundleVersion: null,
      rejectedVersions: [],
      expectedChannel: 'stable',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_json');
  });
});
