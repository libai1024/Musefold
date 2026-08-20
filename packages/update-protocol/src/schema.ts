import { valid as semverValid } from 'semver';
import { z } from 'zod';

/** Currently supported manifest schema versions. Unknown versions must be rejected. */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/** Update channels. Matches V121-CICD-ARCHITECTURE §4.1. */
export const CHANNELS = ['dev', 'beta', 'stable'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Default feed / settings channel. Historical electron-updater default is stable. */
export const DEFAULT_CHANNEL: Channel = 'stable';

/**
 * Surfaces that a client may negotiate from a content-bundle manifest.
 *
 * `web` is intentionally absent: protocol §2 says the web surface does not appear
 * in the manifest (the server switches it via symlink). The parser treats `web`
 * the same as any other unknown surface id — ignore it, do not fail the whole
 * document. That matches "未知 surface 忽略" and avoids blocking desktop/iOS
 * updates because of a producer-side extra key no client consults.
 */
export const KNOWN_SURFACE_IDS = ['electron-renderer', 'capacitor-web'] as const;
export type KnownSurfaceId = (typeof KNOWN_SURFACE_IDS)[number];

const KNOWN_SURFACE_ID_SET: ReadonlySet<string> = new Set(KNOWN_SURFACE_IDS);

export const schemaVersionSchema = z.literal(1);
export const channelSchema = z.enum(CHANNELS);

const semverStringSchema = z.string().refine((value) => semverValid(value) === value, {
  error: 'Expected a SemVer string',
});

const iso8601UtcSchema = z.iso.datetime({ offset: false });

/** Input is case-insensitive hex; output is always lowercase. Does not affect canonicalize. */
const gitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/i, 'Expected a git object name')
  .transform((value) => value.toLowerCase());

/** Input is case-insensitive hex; output is always lowercase. Does not affect canonicalize. */
const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'Expected a 64-char hex SHA-256')
  .transform((value) => value.toLowerCase());

const httpsUrlSchema = z.url({ protocol: /^https$/ });

export const surfaceArtifactSchema = z.object({
  url: httpsUrlSchema,
  sha256: sha256HexSchema,
  bytes: z.int().positive(),
});

export type SurfaceArtifact = z.infer<typeof surfaceArtifactSchema>;

export type ContentSurfaces = {
  [K in KnownSurfaceId]?: SurfaceArtifact;
};

/**
 * Record of surface id → payload. Unknown ids (including `web`) are dropped.
 * A malformed *known* surface (missing/invalid required fields) fails the
 * whole document. Extra keys on a known artifact are stripped, not rejected.
 */
export const surfacesSchema = z.record(z.string(), z.unknown()).transform((raw, ctx) => {
  const out: ContentSurfaces = {};
  for (const [id, payload] of Object.entries(raw)) {
    if (!KNOWN_SURFACE_ID_SET.has(id)) continue;
    const parsed = surfaceArtifactSchema.safeParse(payload);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid surface artifact',
        path: [id],
      });
      return z.NEVER;
    }
    out[id as KnownSurfaceId] = parsed.data;
  }
  return out;
});

export const rolloutSchema = z.object({
  percentage: z.int().min(0).max(100),
});

const manifestBodyShape = {
  schemaVersion: schemaVersionSchema,
  channel: channelSchema,
  bundleVersion: semverStringSchema,
  gitSha: gitShaSchema,
  createdAt: iso8601UtcSchema,
  minShellVersion: semverStringSchema,
  /** `null` is a real cap-absent value and is not the same as omitting the field. */
  maxShellVersion: semverStringSchema.nullable(),
  surfaces: surfacesSchema,
  rollout: rolloutSchema,
};

/**
 * schemaVersion 1 演进规则（must-understand）：
 * - 新增可选字段保持 schemaVersion 1。顶层、`rollout`、surface artifact 使用
 *   `z.object`（未知键剥离而非报错）。未知字段已被签名覆盖，攻击者无法增删
 *   任何字段而不破坏验签，因此容忍未知键不损失安全性，只增加演进空间。
 * - 任何老客户端必须理解才能安全应用的字段，必须 bump schemaVersion。
 * 已知字段的校验强度不变：非法 `channel` / 非 https `url` / 非法已知 surface
 * payload 仍使整份文档失败。规范化签名字节使用原始 JSON 对象，与 zod 输出无关。
 */
export const manifestBodySchema = z.object(manifestBodyShape);

export const signedManifestSchema = z.object({
  ...manifestBodyShape,
  signature: z.string().base64(),
});

export type ContentManifestBody = z.infer<typeof manifestBodySchema>;
export type SignedContentManifest = z.infer<typeof signedManifestSchema>;

export function isSupportedSchemaVersion(value: unknown): value is SupportedSchemaVersion {
  return (SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(value);
}

export function isKnownSurfaceId(value: string): value is KnownSurfaceId {
  return KNOWN_SURFACE_ID_SET.has(value);
}

export function parseManifestBody(input: unknown): ContentManifestBody {
  return manifestBodySchema.parse(input);
}

export function parseSignedManifest(input: unknown): SignedContentManifest {
  return signedManifestSchema.parse(input);
}
