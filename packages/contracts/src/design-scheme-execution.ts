import { z } from 'zod';
import { designSchemeRunEventSchema, opaqueIdSchema } from './design-scheme';

export const designSchemeRunQuerySchema = z.object({ runId: opaqueIdSchema }).strict();
export const designSchemeRunEventQuerySchema = z
  .object({ afterSeq: z.coerce.number().int().nonnegative().default(0) })
  .strict();
export const designSchemeRunEventPageSchema = z
  .object({
    events: z
      .array(
        z.object({ seq: z.number().int().positive(), event: designSchemeRunEventSchema }).strict(),
      )
      .max(100),
    nextSeq: z.number().int().nonnegative(),
  })
  .strict();
export type DesignSchemeRunEventPage = z.infer<typeof designSchemeRunEventPageSchema>;
