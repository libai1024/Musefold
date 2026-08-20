import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

import { canonicalize, CanonicalizeError } from './canonicalize.ts';
import { manifestBodySchema } from './schema.ts';

export class BundleSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleSigningError';
  }
}

export type BundleKeyPair = {
  publicKey: string;
  privateKey: string;
};

const ED25519_SIGNATURE_BYTES = 64;

export function generateBundleSigningKeyPair(): BundleKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export function signCanonicalBytes(bytes: Uint8Array, privateKeyPkcs8DerBase64: string): string {
  const key = loadPrivateKey(privateKeyPkcs8DerBase64);
  return cryptoSign(null, bytes, key).toString('base64');
}

/**
 * Validate a v1 body (unknown surfaces ignored for validity), then sign the
 * canonical bytes of the input object with `signature` removed. Unknown
 * surfaces that were present in the input remain in the signed document.
 */
export function signManifest(
  manifestWithoutSignature: unknown,
  privateKeyPkcs8DerBase64: string,
): Record<string, unknown> {
  const body = asPlainObject(manifestWithoutSignature);
  if (!body) {
    throw new BundleSigningError('manifest is invalid');
  }
  const unsigned = omitSignature(body);
  const parsed = manifestBodySchema.safeParse(unsigned);
  if (!parsed.success) {
    throw new BundleSigningError('manifest is invalid');
  }
  let bytes: Uint8Array;
  try {
    bytes = canonicalize(unsigned);
  } catch (error) {
    if (error instanceof CanonicalizeError) {
      throw new BundleSigningError('manifest is invalid');
    }
    throw error;
  }
  const signature = signCanonicalBytes(bytes, privateKeyPkcs8DerBase64);
  return { ...unsigned, signature };
}

/**
 * Verify Ed25519 over canonical(body without signature).
 * Empty `publicKeys` is fail-closed (returns false). Does not parse business fields.
 */
export function verifyManifestSignature(
  json: string | unknown,
  publicKeys: readonly string[],
): boolean {
  const keys = usablePublicKeys(publicKeys);
  if (keys.length === 0) return false;

  const object = parseJsonObject(json);
  if (!object) return false;

  const signature = object.signature;
  if (typeof signature !== 'string') return false;
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes) return false;

  let bytes: Uint8Array;
  try {
    bytes = canonicalize(omitSignature(object));
  } catch {
    return false;
  }

  for (const key of keys) {
    if (verifyWithPublicKey(bytes, signatureBytes, key)) return true;
  }
  return false;
}

export function usablePublicKeys(publicKeys: readonly string[]): string[] {
  return publicKeys.map((key) => key.trim()).filter((key) => key.length > 0);
}

export function runSignatureSelfTest(): boolean {
  const { publicKey, privateKey } = generateBundleSigningKeyPair();
  const body = selfTestManifestBody();
  let signed: Record<string, unknown>;
  try {
    signed = signManifest(body, privateKey);
  } catch {
    return false;
  }
  if (!verifyManifestSignature(signed, [publicKey])) return false;

  const json = JSON.stringify(signed);
  const tampered = Buffer.from(json, 'utf8');
  const flipAt = Math.max(0, json.indexOf('1.2.1-dev.412'));
  tampered[flipAt] = tampered[flipAt]! ^ 0x01;
  if (verifyManifestSignature(tampered.toString('utf8'), [publicKey])) return false;
  return true;
}

export function loadPrivateKeyFromEnv(env: NodeJS.Dict<string | undefined>): string {
  const value = env.MUSEFOLD_BUNDLE_SIGNING_KEY;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BundleSigningError('signing key is not configured');
  }
  return value;
}

function selfTestManifestBody(): Record<string, unknown> {
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
        sha256: 'ab'.repeat(32),
        bytes: 2431044,
      },
    },
    rollout: { percentage: 100 },
  };
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  return value as Record<string, unknown>;
}

function parseJsonObject(json: string | unknown): Record<string, unknown> | null {
  if (typeof json === 'string') {
    try {
      return asPlainObject(JSON.parse(json) as unknown);
    } catch {
      return null;
    }
  }
  return asPlainObject(json);
}

function omitSignature(value: Record<string, unknown>): Record<string, unknown> {
  const { signature: _signature, ...rest } = value;
  return rest;
}

function loadPrivateKey(privateKeyPkcs8DerBase64: string): KeyObject {
  if (
    typeof privateKeyPkcs8DerBase64 !== 'string' ||
    privateKeyPkcs8DerBase64.trim().length === 0
  ) {
    throw new BundleSigningError('signing key is not configured');
  }
  try {
    const der = Buffer.from(privateKeyPkcs8DerBase64.trim(), 'base64');
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    throw new BundleSigningError('signing key is invalid');
  }
}

function decodeSignature(signature: string): Buffer | null {
  try {
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.length !== ED25519_SIGNATURE_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

function verifyWithPublicKey(
  message: Uint8Array,
  signature: Buffer,
  publicKeySpkiDerBase64: string,
): boolean {
  try {
    const der = Buffer.from(publicKeySpkiDerBase64, 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return cryptoVerify(null, message, key, signature);
  } catch {
    return false;
  }
}
