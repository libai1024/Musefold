export { CanonicalizeError, canonicalize } from './canonicalize.ts';
export { isShellVersionCompatible, isStrictlyNewerBundleVersion } from './compatibility.ts';
export {
  CHANNELS,
  DEFAULT_CHANNEL,
  KNOWN_SURFACE_IDS,
  SUPPORTED_SCHEMA_VERSIONS,
  channelSchema,
  isKnownSurfaceId,
  isSupportedSchemaVersion,
  manifestBodySchema,
  parseManifestBody,
  parseSignedManifest,
  schemaVersionSchema,
  signedManifestSchema,
  surfaceArtifactSchema,
  surfacesSchema,
} from './schema.ts';
export type {
  Channel,
  ContentManifestBody,
  ContentSurfaces,
  KnownSurfaceId,
  SignedContentManifest,
  SupportedSchemaVersion,
  SurfaceArtifact,
} from './schema.ts';
export {
  BundleSigningError,
  generateBundleSigningKeyPair,
  loadPrivateKeyFromEnv,
  runSignatureSelfTest,
  signCanonicalBytes,
  signManifest,
  usablePublicKeys,
  verifyManifestSignature,
} from './sign.ts';
export type { BundleKeyPair } from './sign.ts';
