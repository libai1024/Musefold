import { z } from 'zod';
import { apiErrorCodeSchema, entityIdSchema, isoDateTimeSchema } from './common';

export const generationSizeSchema = z.enum([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
]);

export const generationQualitySchema = z.enum(['low', 'medium', 'high', 'auto']);
export const generationStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
]);

export const generationAssetUrlSchema = z.string().min(1).max(4_096).refine((value) => {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}, 'Asset URL must be HTTPS or an origin-relative path');

export const cloudGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  negative: z.string().trim().max(4_000).optional(),
  promptId: entityIdSchema.optional(),
  size: generationSizeSchema.default('auto'),
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
  quality: generationQualitySchema.default('auto'),
  count: z.literal(1).default(1),
});

export const generationAssetSchema = z.object({
  id: entityIdSchema,
  url: generationAssetUrlSchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  expiresAt: isoDateTimeSchema,
});

export const generationJobSchema = z.object({
  id: entityIdSchema,
  status: generationStatusSchema,
  progress: z.number().int().min(0).max(100),
  request: cloudGenerationRequestSchema,
  assets: z.array(generationAssetSchema),
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(500),
  }).nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});

export type GenerationSize = z.infer<typeof generationSizeSchema>;
export type GenerationQuality = z.infer<typeof generationQualitySchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type CloudGenerationRequest = z.input<typeof cloudGenerationRequestSchema>;
export type ParsedCloudGenerationRequest = z.output<typeof cloudGenerationRequestSchema>;
export type GenerationAsset = z.infer<typeof generationAssetSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
