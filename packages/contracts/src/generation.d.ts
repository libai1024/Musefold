import { z } from 'zod';
export declare const generationSizeSchema: z.ZodEnum<{
  '1024x1024': '1024x1024';
  '1536x1024': '1536x1024';
  '1024x1536': '1024x1536';
  auto: 'auto';
}>;
export declare const generationQualitySchema: z.ZodEnum<{
  auto: 'auto';
  low: 'low';
  medium: 'medium';
  high: 'high';
}>;
export declare const generationStatusSchema: z.ZodEnum<{
  failed: 'failed';
  cancelled: 'cancelled';
  running: 'running';
  pending_approval: 'pending_approval';
  queued: 'queued';
  succeeded: 'succeeded';
  cancelling: 'cancelling';
  rejected: 'rejected';
  expired: 'expired';
}>;
export declare const generationActorTypeSchema: z.ZodEnum<{
  web: 'web';
  cloud_mcp: 'cloud_mcp';
  desktop_local: 'desktop_local';
}>;
export declare const generationApprovalStatusSchema: z.ZodEnum<{
  pending_approval: 'pending_approval';
  rejected: 'rejected';
  expired: 'expired';
  not_required: 'not_required';
  approved: 'approved';
}>;
export declare const generationAssetUrlSchema: z.ZodString;
export declare const cloudGenerationRequestSchema: z.ZodObject<
  {
    prompt: z.ZodString;
    negative: z.ZodOptional<z.ZodString>;
    promptId: z.ZodOptional<z.ZodString>;
    size: z.ZodDefault<
      z.ZodEnum<{
        '1024x1024': '1024x1024';
        '1536x1024': '1536x1024';
        '1024x1536': '1024x1536';
        auto: 'auto';
      }>
    >;
    aspectRatio: z.ZodOptional<z.ZodString>;
    quality: z.ZodDefault<
      z.ZodEnum<{
        auto: 'auto';
        low: 'low';
        medium: 'medium';
        high: 'high';
      }>
    >;
    count: z.ZodDefault<z.ZodLiteral<1>>;
    providerId: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
/** 生图 Provider 选项:云端由服务端给固定项,桌面来自本地 AI 连接。 */
export declare const providerOptionSchema: z.ZodObject<
  {
    id: z.ZodString;
    label: z.ZodString;
    model: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
      local: 'local';
      cloud: 'cloud';
    }>;
    available: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const createGenerationInputSchema: z.ZodObject<
  {
    prompt: z.ZodString;
    negative: z.ZodOptional<z.ZodString>;
    promptId: z.ZodOptional<z.ZodString>;
    size: z.ZodDefault<
      z.ZodEnum<{
        '1024x1024': '1024x1024';
        '1536x1024': '1536x1024';
        '1024x1536': '1024x1536';
        auto: 'auto';
      }>
    >;
    aspectRatio: z.ZodOptional<z.ZodString>;
    quality: z.ZodDefault<
      z.ZodEnum<{
        auto: 'auto';
        low: 'low';
        medium: 'medium';
        high: 'high';
      }>
    >;
    count: z.ZodDefault<z.ZodLiteral<1>>;
    providerId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    parentRunId: z.ZodOptional<z.ZodString>;
    runKind: z.ZodDefault<
      z.ZodEnum<{
        free_generation: 'free_generation';
        refinement: 'refinement';
        retry: 'retry';
      }>
    >;
  },
  z.core.$strip
>;
export declare const generationAssetSchema: z.ZodObject<
  {
    id: z.ZodString;
    url: z.ZodString;
    mimeType: z.ZodEnum<{
      'image/png': 'image/png';
      'image/jpeg': 'image/jpeg';
      'image/webp': 'image/webp';
    }>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    byteSize: z.ZodNumber;
    expiresAt: z.ZodString;
  },
  z.core.$strip
>;
export declare const generationJobSchema: z.ZodObject<
  {
    id: z.ZodString;
    sessionId: z.ZodNullable<z.ZodString>;
    parentRunId: z.ZodNullable<z.ZodString>;
    promptId: z.ZodNullable<z.ZodString>;
    actorType: z.ZodEnum<{
      web: 'web';
      cloud_mcp: 'cloud_mcp';
      desktop_local: 'desktop_local';
    }>;
    approvalStatus: z.ZodEnum<{
      pending_approval: 'pending_approval';
      rejected: 'rejected';
      expired: 'expired';
      not_required: 'not_required';
      approved: 'approved';
    }>;
    status: z.ZodEnum<{
      failed: 'failed';
      cancelled: 'cancelled';
      running: 'running';
      pending_approval: 'pending_approval';
      queued: 'queued';
      succeeded: 'succeeded';
      cancelling: 'cancelling';
      rejected: 'rejected';
      expired: 'expired';
    }>;
    progress: z.ZodNumber;
    request: z.ZodObject<
      {
        prompt: z.ZodString;
        negative: z.ZodOptional<z.ZodString>;
        promptId: z.ZodOptional<z.ZodString>;
        size: z.ZodDefault<
          z.ZodEnum<{
            '1024x1024': '1024x1024';
            '1536x1024': '1536x1024';
            '1024x1536': '1024x1536';
            auto: 'auto';
          }>
        >;
        aspectRatio: z.ZodOptional<z.ZodString>;
        quality: z.ZodDefault<
          z.ZodEnum<{
            auto: 'auto';
            low: 'low';
            medium: 'medium';
            high: 'high';
          }>
        >;
        count: z.ZodDefault<z.ZodLiteral<1>>;
        providerId: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >;
    providerModel: z.ZodNullable<z.ZodString>;
    costPoints: z.ZodNullable<z.ZodNumber>;
    assets: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          url: z.ZodString;
          mimeType: z.ZodEnum<{
            'image/png': 'image/png';
            'image/jpeg': 'image/jpeg';
            'image/webp': 'image/webp';
          }>;
          width: z.ZodNumber;
          height: z.ZodNumber;
          byteSize: z.ZodNumber;
          expiresAt: z.ZodString;
        },
        z.core.$strip
      >
    >;
    error: z.ZodNullable<
      z.ZodObject<
        {
          code: z.ZodEnum<{
            AUTH_REQUIRED: 'AUTH_REQUIRED';
            AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED';
            AUTH_CREDENTIALS_INVALID: 'AUTH_CREDENTIALS_INVALID';
            AUTH_REGISTRATION_DISABLED: 'AUTH_REGISTRATION_DISABLED';
            OAUTH_INVALID_GRANT: 'OAUTH_INVALID_GRANT';
            OAUTH_SCOPE_INSUFFICIENT: 'OAUTH_SCOPE_INSUFFICIENT';
            ACCOUNT_QUOTA_INSUFFICIENT: 'ACCOUNT_QUOTA_INSUFFICIENT';
            ACCOUNT_REDEEM_INVALID: 'ACCOUNT_REDEEM_INVALID';
            PROMPT_NOT_FOUND: 'PROMPT_NOT_FOUND';
            PROMPT_VERSION_CONFLICT: 'PROMPT_VERSION_CONFLICT';
            SYNC_CURSOR_EXPIRED: 'SYNC_CURSOR_EXPIRED';
            SYNC_MUTATION_CONFLICT: 'SYNC_MUTATION_CONFLICT';
            WORKBENCH_SESSION_NOT_FOUND: 'WORKBENCH_SESSION_NOT_FOUND';
            WORKBENCH_VERSION_CONFLICT: 'WORKBENCH_VERSION_CONFLICT';
            GENERATION_NOT_FOUND: 'GENERATION_NOT_FOUND';
            GENERATION_ALREADY_TERMINAL: 'GENERATION_ALREADY_TERMINAL';
            GENERATION_UPSTREAM_REJECTED: 'GENERATION_UPSTREAM_REJECTED';
            GENERATION_UPSTREAM_UNKNOWN: 'GENERATION_UPSTREAM_UNKNOWN';
            GENERATION_STORAGE_FAILED: 'GENERATION_STORAGE_FAILED';
            GENERATION_APPROVAL_REQUIRED: 'GENERATION_APPROVAL_REQUIRED';
            GENERATION_APPROVAL_EXPIRED: 'GENERATION_APPROVAL_EXPIRED';
            MCP_BUDGET_EXCEEDED: 'MCP_BUDGET_EXCEEDED';
            RATE_LIMITED: 'RATE_LIMITED';
            VALIDATION_FAILED: 'VALIDATION_FAILED';
            INTERNAL_ERROR: 'INTERNAL_ERROR';
          }>;
          message: z.ZodString;
        },
        z.core.$strip
      >
    >;
    createdAt: z.ZodString;
    startedAt: z.ZodNullable<z.ZodString>;
    finishedAt: z.ZodNullable<z.ZodString>;
    deletedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export type GenerationSize = z.infer<typeof generationSizeSchema>;
export type GenerationQuality = z.infer<typeof generationQualitySchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type GenerationActorType = z.infer<typeof generationActorTypeSchema>;
export type GenerationApprovalStatus = z.infer<typeof generationApprovalStatusSchema>;
export type CloudGenerationRequest = z.input<typeof cloudGenerationRequestSchema>;
export type ParsedCloudGenerationRequest = z.output<typeof cloudGenerationRequestSchema>;
export type CreateGenerationInput = z.input<typeof createGenerationInputSchema>;
export type ParsedCreateGenerationInput = z.output<typeof createGenerationInputSchema>;
export type GenerationAsset = z.infer<typeof generationAssetSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type ProviderOption = z.infer<typeof providerOptionSchema>;
//# sourceMappingURL=generation.d.ts.map
