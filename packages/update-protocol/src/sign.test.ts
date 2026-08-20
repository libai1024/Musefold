import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonicalize.ts';
import { parseSignedManifest } from './schema.ts';
import {
  generateBundleSigningKeyPair,
  runSignatureSelfTest,
  signCanonicalBytes,
  signManifest,
  verifyManifestSignature,
} from './sign.ts';

const shaA = 'ab'.repeat(32);

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
        url: 'https://cdn.example.test/renderer.tar.zst',
        sha256: shaA,
        bytes: 2431044,
      },
    },
    rollout: { percentage: 20 },
    ...overrides,
  };
}

describe('Ed25519 manifest signatures', () => {
  it('round-trips sign then verify', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    expect(typeof signed.signature).toBe('string');
    expect(verifyManifestSignature(signed, [publicKey])).toBe(true);
    expect(verifyManifestSignature(JSON.stringify(signed), [publicKey])).toBe(true);
  });

  it('fails closed when no public keys are configured', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    expect(verifyManifestSignature(signed, [])).toBe(false);
    expect(verifyManifestSignature(signed, ['', '   '])).toBe(false);
    expect(verifyManifestSignature(signed, [publicKey])).toBe(true);
  });

  it('accepts the backup public key when the primary key fails', () => {
    const primary = generateBundleSigningKeyPair();
    const backup = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), backup.privateKey);
    expect(verifyManifestSignature(signed, [primary.publicKey])).toBe(false);
    expect(verifyManifestSignature(signed, [primary.publicKey, backup.publicKey])).toBe(true);
  });

  it('rejects a changed field value', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    const tampered = { ...signed, bundleVersion: '1.2.1-dev.413' };
    expect(verifyManifestSignature(tampered, [publicKey])).toBe(false);
  });

  it('still verifies after shuffling key order', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    const reordered = {
      signature: signed.signature,
      rollout: signed.rollout,
      surfaces: signed.surfaces,
      maxShellVersion: signed.maxShellVersion,
      minShellVersion: signed.minShellVersion,
      createdAt: signed.createdAt,
      gitSha: signed.gitSha,
      bundleVersion: signed.bundleVersion,
      channel: signed.channel,
      schemaVersion: signed.schemaVersion,
    };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(signed));
    expect(verifyManifestSignature(reordered, [publicKey])).toBe(true);
  });

  it('rejects added or removed fields', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const signed = signManifest(validBody(), privateKey);
    expect(verifyManifestSignature({ ...signed, extra: true }, [publicKey])).toBe(false);
    const { gitSha: _removed, ...removed } = signed;
    expect(verifyManifestSignature(removed, [publicKey])).toBe(false);
    expect(_removed).toBe('0ce9aac');
  });

  it('signs unknown surfaces that remain in the document', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const body = validBody({
      surfaces: {
        'electron-renderer': {
          url: 'https://cdn.example.test/renderer.tar.zst',
          sha256: shaA,
          bytes: 1,
        },
        'future-tv': { ignored: true },
      },
    });
    const signed = signManifest(body, privateKey);
    expect(signed.surfaces).toMatchObject({ 'future-tv': { ignored: true } });
    expect(verifyManifestSignature(signed, [publicKey])).toBe(true);
  });

  it('verifies a signed manifest that includes unknown top-level fields', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const body = validBody({ ttlSeconds: 3600 });
    const signed = signManifest(body, privateKey);
    expect(signed).toMatchObject({ ttlSeconds: 3600 });
    expect(verifyManifestSignature(signed, [publicKey])).toBe(true);
  });

  it('canonicalizes original hex case; zod output is lowercase', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const upperSha = shaA.toUpperCase();
    const body = validBody({
      gitSha: '0CE9AAC',
      surfaces: {
        'electron-renderer': {
          url: 'https://cdn.example.test/renderer.tar.zst',
          sha256: upperSha,
          bytes: 1,
        },
      },
    });
    const signed = signManifest(body, privateKey);
    expect(signed.gitSha).toBe('0CE9AAC');
    expect(
      (signed.surfaces as { 'electron-renderer': { sha256: string } })['electron-renderer'].sha256,
    ).toBe(upperSha);
    expect(verifyManifestSignature(signed, [publicKey])).toBe(true);
    const parsed = parseSignedManifest(signed);
    expect(parsed.gitSha).toBe('0ce9aac');
    expect(parsed.surfaces['electron-renderer']?.sha256).toBe(shaA);
  });

  it('runSignatureSelfTest covers sign → verify → tamper', () => {
    expect(runSignatureSelfTest()).toBe(true);
  });

  it('can sign raw canonical bytes for unsupported schema versions', () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const body = { schemaVersion: 2, note: 'future' };
    const signature = signCanonicalBytes(canonicalize(body), privateKey);
    expect(verifyManifestSignature({ ...body, signature }, [publicKey])).toBe(true);
  });
});
