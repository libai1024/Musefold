/**
 * Content-bundle trust anchors and combined verification for the Electron main process.
 *
 * Key ceremony:
 * 1. Run `npm run bundle:manifest -- keygen`.
 * 2. Paste the public key (SPKI DER, base64) into `PRIMARY_BUNDLE_PUBLIC_KEY` or
 *    `BACKUP_BUNDLE_PUBLIC_KEY` below. Do not invent placeholder keys.
 * 3. Store the private key immediately as GitHub Actions secret
 *    `MUSEFOLD_BUNDLE_SIGNING_KEY`. Do not write it to disk or commit it.
 * 4. Rotating a public key requires a shell release — these constants are compiled
 *    into the main process. Keep a backup slot filled before retiring the primary.
 *
 * Fail-closed: when both slots are empty, verification always fails.
 */

import {
  isShellVersionCompatible,
  isStrictlyNewerBundleVersion,
  isSupportedSchemaVersion,
  signedManifestSchema,
  usablePublicKeys,
  verifyManifestSignature,
  type Channel,
  type SignedContentManifest,
} from '@musefold/update-protocol';

/** Primary Ed25519 public key (SPKI DER, base64). Empty until the signing ceremony. */
export const PRIMARY_BUNDLE_PUBLIC_KEY = '';

/** Backup Ed25519 public key (SPKI DER, base64). Empty until a rotation key is enrolled. */
export const BACKUP_BUNDLE_PUBLIC_KEY = '';

/** Compiled-in trust anchors. Empty strings are stripped; an empty list is fail-closed. */
export const BUNDLE_TRUST_PUBLIC_KEYS: readonly string[] = usablePublicKeys([
  PRIMARY_BUNDLE_PUBLIC_KEY,
  BACKUP_BUNDLE_PUBLIC_KEY,
]);

export const ContentManifestFailureReason = {
  invalid_json: 'invalid_json',
  trust_anchor_missing: 'trust_anchor_missing',
  invalid_signature: 'invalid_signature',
  unsupported_schema_version: 'unsupported_schema_version',
  channel_mismatch: 'channel_mismatch',
  invalid_manifest: 'invalid_manifest',
  incompatible_shell_version: 'incompatible_shell_version',
  bundle_version_not_increasing: 'bundle_version_not_increasing',
  bundle_version_rejected: 'bundle_version_rejected',
} as const;

export type ContentManifestFailureReason =
  (typeof ContentManifestFailureReason)[keyof typeof ContentManifestFailureReason];

const FAILURE_MESSAGES: Record<ContentManifestFailureReason, string> = {
  invalid_json: 'Manifest is not valid JSON.',
  trust_anchor_missing: 'Content-bundle trust anchors are not configured.',
  invalid_signature: 'Manifest signature is invalid.',
  unsupported_schema_version: 'Manifest schema version is not supported.',
  channel_mismatch: 'Manifest channel does not match this installation.',
  invalid_manifest: 'Manifest fields are invalid.',
  incompatible_shell_version: 'Manifest is not compatible with this shell version.',
  bundle_version_not_increasing: 'Manifest bundle version is not an upgrade.',
  bundle_version_rejected: 'Manifest bundle version was previously rejected.',
};

export type VerifyContentManifestOptions = {
  currentShellVersion: string;
  appliedBundleVersion: string | null;
  rejectedVersions: readonly string[];
  /** Channel this client is consuming. Required so M5 callers cannot skip binding. */
  expectedChannel: Channel;
  /** Test injection. Production callers omit this and use compiled-in slots. */
  publicKeys?: readonly string[];
};

export type ContentManifestVerifyResult =
  | { ok: true; manifest: SignedContentManifest; reason?: undefined; message?: undefined }
  | {
      ok: false;
      manifest?: undefined;
      reason: ContentManifestFailureReason;
      message: string;
    };

/**
 * Combined content-manifest check. Order is protocol §3.2 (security-sensitive, do not reorder):
 * 1. JSON syntax parse
 * 2. Strip `signature`, canonicalize the remainder
 * 3. Verify Ed25519 against compiled-in public keys (all failures abort; empty keys fail closed)
 * 4. `schemaVersion` must be supported
 * 5. `channel` must equal `expectedChannel` — 三通道共用签名密钥，通道绑定是防跨通道投递的唯一防线
 * 6. `minShellVersion` / `maxShellVersion` vs the running shell
 * 7. `bundleVersion` strictly newer than the applied bundle and not in the reject list
 *
 * Business fields are not interpreted before the signature succeeds.
 * Channel binding is an identity check (whether this client should consume the
 * document) and runs after schemaVersion, before compatibility checks.
 */
export function verifyContentManifest(
  rawJson: string,
  options: VerifyContentManifestOptions,
): ContentManifestVerifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return fail('invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('invalid_json');
  }

  const publicKeys = usablePublicKeys(options.publicKeys ?? BUNDLE_TRUST_PUBLIC_KEYS);
  if (publicKeys.length === 0) {
    return fail('trust_anchor_missing');
  }

  if (!verifyManifestSignature(parsed, publicKeys)) {
    return fail('invalid_signature');
  }

  const record = parsed as Record<string, unknown>;
  if (!isSupportedSchemaVersion(record.schemaVersion)) {
    return fail('unsupported_schema_version');
  }

  if (record.channel !== options.expectedChannel) {
    return fail('channel_mismatch');
  }

  const manifestResult = signedManifestSchema.safeParse(record);
  if (!manifestResult.success) {
    return fail('invalid_manifest');
  }
  const manifest = manifestResult.data;

  if (
    !isShellVersionCompatible(
      options.currentShellVersion,
      manifest.minShellVersion,
      manifest.maxShellVersion,
    )
  ) {
    return fail('incompatible_shell_version');
  }

  if (options.rejectedVersions.includes(manifest.bundleVersion)) {
    return fail('bundle_version_rejected');
  }

  if (!isStrictlyNewerBundleVersion(manifest.bundleVersion, options.appliedBundleVersion)) {
    return fail('bundle_version_not_increasing');
  }

  return { ok: true, manifest };
}

function fail(reason: ContentManifestFailureReason): ContentManifestVerifyResult {
  return {
    ok: false,
    reason,
    message: FAILURE_MESSAGES[reason],
  };
}
