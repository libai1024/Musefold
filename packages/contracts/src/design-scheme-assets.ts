import { z } from 'zod';
import { isoDateTimeSchema } from './common';
import { designSchemeHashSchema, opaqueIdSchema } from './design-scheme';

/** Raw uploads remain temporary for 24 hours, unless consumed into a scheme revision. */
export const DESIGN_SCHEME_UPLOAD_TTL_MS = 24 * 60 * 60_000;
export const MAX_DESIGN_SCHEME_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_DESIGN_SCHEME_IMAGE_DIMENSION = 16_384;
export const MAX_DESIGN_SCHEME_IMAGE_PIXELS = 16_777_216;

export const uploadDesignSchemeAssetInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          [...value].every(
            (character) =>
              character.charCodeAt(0) >= 32 &&
              character.charCodeAt(0) !== 127 &&
              character !== '/' &&
              character !== '\\',
          ),
        'Filename cannot contain paths or control characters',
      ),
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (value) => value.byteLength > 0 && value.byteLength <= MAX_DESIGN_SCHEME_UPLOAD_BYTES,
        'Image must be between 1 byte and 20 MiB',
      ),
  })
  .strict();

/** Metadata is computed from stored bytes by the server; it contains no storage key. */
export const stagedDesignSchemeAssetSchema = z
  .object({
    id: opaqueIdSchema,
    name: uploadDesignSchemeAssetInputSchema.shape.name,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive().max(MAX_DESIGN_SCHEME_IMAGE_DIMENSION),
    height: z.number().int().positive().max(MAX_DESIGN_SCHEME_IMAGE_DIMENSION),
    byteSize: z.number().int().positive().max(MAX_DESIGN_SCHEME_UPLOAD_BYTES),
    contentHash: designSchemeHashSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .refine((value) => value.width * value.height <= MAX_DESIGN_SCHEME_IMAGE_PIXELS, {
    message: 'Image dimensions exceed the supported pixel count',
  });

export type UploadDesignSchemeAssetInput = z.infer<typeof uploadDesignSchemeAssetInputSchema>;
export type StagedDesignSchemeAsset = z.infer<typeof stagedDesignSchemeAssetSchema>;
