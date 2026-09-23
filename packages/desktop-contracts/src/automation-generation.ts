import { z } from 'zod';
import { createGenerationInputSchema } from '@musefold/contracts';

/** Local automation wire intent. No caller-supplied account identity or credentials. */
export const cloudAutomationGenerationSchema = z
  .object({
    prompt: createGenerationInputSchema.shape.prompt,
    negative: createGenerationInputSchema.shape.negative,
    model: createGenerationInputSchema.shape.model,
    providerId: createGenerationInputSchema.shape.providerId,
    aspectRatio: createGenerationInputSchema.shape.aspectRatio,
    quality: createGenerationInputSchema.shape.quality.optional(),
    n: createGenerationInputSchema.shape.count.optional(),
    background: z.enum(['auto', 'opaque', 'transparent']).optional(),
    referenceImagePaths: z.array(z.string().min(1)).max(16).optional(),
    referenceHistoryIds: z.array(z.string().min(1)).max(16).optional(),
    declaredBudgetPoints: z.number().finite().nonnegative().optional(),
    consent: z.literal('interactive').optional(),
  })
  .strict();
export type CloudAutomationGeneration = z.infer<typeof cloudAutomationGenerationSchema>;
