import { z } from 'zod';
import { accountExecutionIdentitySchema } from './account-identity';
import { cloudModelIdSchema, isoDateTimeSchema } from './common';
export { cloudModelIdSchema } from './common';

/** Opaque upstream model/group names. Never coerce objects or invent missing identifiers. */
const groupSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\p{Cc}]+$/u);
const priceNumberSchema = z.number().finite().nonnegative();
const namesSchema = z.array(cloudModelIdSchema).max(4096);
export const cloudModelNamesSchema = namesSchema.refine(
  (names) => new Set(names).size === names.length,
  'Duplicate cloud model',
);

/** Upstream pricing wire format; absent prices are not zero/free. Unknown metadata is ignored. */
export const newApiModelPricingSchema = z
  .object({
    model_name: cloudModelIdSchema,
    quota_type: z.union([z.literal(0), z.literal(1)]),
    model_ratio: priceNumberSchema.nullable().optional(),
    completion_ratio: priceNumberSchema.nullable().optional(),
    model_price: priceNumberSchema.nullable().optional(),
    enable_groups: z.array(groupSchema).max(256),
    supported_endpoint_types: z.array(z.string().min(1).max(128)).max(64).optional(),
    billing_mode: z.string().max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.quota_type === 1 && value.model_price == null)
      ctx.addIssue({ code: 'custom', path: ['model_price'], message: 'Missing cloud price' });
    if (value.quota_type === 0 && value.model_ratio == null)
      ctx.addIssue({ code: 'custom', path: ['model_ratio'], message: 'Missing cloud ratio' });
  });

export const newApiPricingResponseSchema = z.object({
  data: z
    .array(newApiModelPricingSchema)
    .max(4096)
    .refine(
      (models) => new Set(models.map((model) => model.model_name)).size === models.length,
      'Duplicate cloud model price',
    ),
  group_ratio: z.record(groupSchema, priceNumberSchema),
  /** Protocol version, not a guarantee that prices have not changed. */
  pricing_version: z.string().max(256).optional(),
});

export const relayModelPricingSchema = z.object({
  modelName: cloudModelIdSchema,
  quotaType: z.union([z.literal(0), z.literal(1)]),
  modelRatio: priceNumberSchema.nullable(),
  completionRatio: priceNumberSchema.nullable(),
  /** USD per upstream billable image/call; displayed estimates must include the account ratio. */
  modelPrice: priceNumberSchema.nullable(),
  enableGroups: z.array(groupSchema),
  /** Metadata only: a generic OpenAI endpoint does not prove image capability. */
  supportedEndpointTypes: z.array(z.string()).optional(),
  /** Unknown/tiered billing must not be presented as a flat per-image price. */
  billingMode: z.string().nullable().optional(),
});
export const relayPricingSchema = z.object({
  version: z.string(),
  groupRatio: z.record(groupSchema, priceNumberSchema),
  models: z.array(relayModelPricingSchema),
});

export type RelayModelPricing = z.infer<typeof relayModelPricingSchema>;
export type RelayPricing = z.infer<typeof relayPricingSchema>;

const quotaEstimateSchema = priceNumberSchema.max(Number.MAX_SAFE_INTEGER);
/** Estimates in raw account quota units, never a settled charge or permission to spend. */
export const cloudModelPriceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('per_call'),
      baseUsd: priceNumberSchema,
      groupRatio: priceNumberSchema,
      quotaPerCall: quotaEstimateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('usage'),
      groupRatio: priceNumberSchema,
      inputQuotaPerToken: quotaEstimateSchema,
      outputQuotaPerToken: quotaEstimateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('unavailable'),
      reason: z.enum([
        'missing_price',
        'group_not_enabled',
        'missing_group_ratio',
        'unsupported_billing',
        'invalid_price',
      ]),
    })
    .strict(),
]);
export const accountModelCatalogSchema = z
  .object({
    identity: accountExecutionIdentitySchema,
    group: groupSchema,
    checkedAt: isoDateTimeSchema,
    /** Account-scoped upstream catalog. Endpoint metadata alone is not a capability grant. */
    models: z
      .array(
        z
          .object({
            model: cloudModelIdSchema,
            supportedEndpointTypes: z.array(z.string().min(1).max(128)),
            /** Host-supported image transport, not an authorization or pricing fallback. */
            imageGeneration: z.boolean().default(false),
            pricing: cloudModelPriceSchema,
          })
          .strict(),
      )
      .max(4096),
  })
  .strict();
export type CloudModelPrice = z.infer<typeof cloudModelPriceSchema>;
export type AccountModelCatalog = z.infer<typeof accountModelCatalogSchema>;
