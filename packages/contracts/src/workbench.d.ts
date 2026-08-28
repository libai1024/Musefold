import { z } from 'zod';
export declare const workbenchDraftSchema: z.ZodObject<
  {
    prompt: z.ZodString;
    negative: z.ZodString;
    params: z.ZodObject<
      {
        size: z.ZodOptional<
          z.ZodDefault<
            z.ZodEnum<{
              '1024x1024': '1024x1024';
              '1536x1024': '1536x1024';
              '1024x1536': '1024x1536';
              auto: 'auto';
            }>
          >
        >;
        quality: z.ZodOptional<
          z.ZodDefault<
            z.ZodEnum<{
              auto: 'auto';
              low: 'low';
              medium: 'medium';
              high: 'high';
            }>
          >
        >;
        aspectRatio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
      },
      z.core.$strip
    >;
    promptReferenceIds: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export declare const workbenchSessionSchema: z.ZodObject<
  {
    id: z.ZodString;
    title: z.ZodString;
    draft: z.ZodObject<
      {
        prompt: z.ZodString;
        negative: z.ZodString;
        params: z.ZodObject<
          {
            size: z.ZodOptional<
              z.ZodDefault<
                z.ZodEnum<{
                  '1024x1024': '1024x1024';
                  '1536x1024': '1536x1024';
                  '1024x1536': '1024x1536';
                  auto: 'auto';
                }>
              >
            >;
            quality: z.ZodOptional<
              z.ZodDefault<
                z.ZodEnum<{
                  auto: 'auto';
                  low: 'low';
                  medium: 'medium';
                  high: 'high';
                }>
              >
            >;
            aspectRatio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
          },
          z.core.$strip
        >;
        promptReferenceIds: z.ZodArray<z.ZodString>;
      },
      z.core.$strip
    >;
    version: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    archivedAt: z.ZodNullable<z.ZodString>;
    deletedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const createWorkbenchSessionSchema: z.ZodObject<
  {
    title: z.ZodDefault<z.ZodString>;
    draft: z.ZodDefault<
      z.ZodObject<
        {
          prompt: z.ZodOptional<z.ZodString>;
          negative: z.ZodOptional<z.ZodString>;
          params: z.ZodOptional<
            z.ZodObject<
              {
                size: z.ZodOptional<
                  z.ZodDefault<
                    z.ZodEnum<{
                      '1024x1024': '1024x1024';
                      '1536x1024': '1536x1024';
                      '1024x1536': '1024x1536';
                      auto: 'auto';
                    }>
                  >
                >;
                quality: z.ZodOptional<
                  z.ZodDefault<
                    z.ZodEnum<{
                      auto: 'auto';
                      low: 'low';
                      medium: 'medium';
                      high: 'high';
                    }>
                  >
                >;
                aspectRatio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
              },
              z.core.$strip
            >
          >;
          promptReferenceIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const updateWorkbenchSessionSchema: z.ZodObject<
  {
    expectedVersion: z.ZodNumber;
    title: z.ZodOptional<z.ZodString>;
    draft: z.ZodOptional<
      z.ZodObject<
        {
          prompt: z.ZodString;
          negative: z.ZodString;
          params: z.ZodObject<
            {
              size: z.ZodOptional<
                z.ZodDefault<
                  z.ZodEnum<{
                    '1024x1024': '1024x1024';
                    '1536x1024': '1536x1024';
                    '1024x1536': '1024x1536';
                    auto: 'auto';
                  }>
                >
              >;
              quality: z.ZodOptional<
                z.ZodDefault<
                  z.ZodEnum<{
                    auto: 'auto';
                    low: 'low';
                    medium: 'medium';
                    high: 'high';
                  }>
                >
              >;
              aspectRatio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            },
            z.core.$strip
          >;
          promptReferenceIds: z.ZodArray<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    archived: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const workbenchSessionPageSchema: z.ZodObject<
  {
    items: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          title: z.ZodString;
          draft: z.ZodObject<
            {
              prompt: z.ZodString;
              negative: z.ZodString;
              params: z.ZodObject<
                {
                  size: z.ZodOptional<
                    z.ZodDefault<
                      z.ZodEnum<{
                        '1024x1024': '1024x1024';
                        '1536x1024': '1536x1024';
                        '1024x1536': '1024x1536';
                        auto: 'auto';
                      }>
                    >
                  >;
                  quality: z.ZodOptional<
                    z.ZodDefault<
                      z.ZodEnum<{
                        auto: 'auto';
                        low: 'low';
                        medium: 'medium';
                        high: 'high';
                      }>
                    >
                  >;
                  aspectRatio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                },
                z.core.$strip
              >;
              promptReferenceIds: z.ZodArray<z.ZodString>;
            },
            z.core.$strip
          >;
          version: z.ZodNumber;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          archivedAt: z.ZodNullable<z.ZodString>;
          deletedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const workbenchSessionListQuerySchema: z.ZodObject<
  {
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<
      z.ZodPipe<
        z.ZodUnion<readonly [z.ZodNumber, z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>]>,
        z.ZodNumber
      >
    >;
    includeArchived: z.ZodDefault<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
    includeDeleted: z.ZodDefault<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
  },
  z.core.$strip
>;
export declare const generationHistoryQuerySchema: z.ZodObject<
  {
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<
      z.ZodPipe<
        z.ZodUnion<readonly [z.ZodNumber, z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>]>,
        z.ZodNumber
      >
    >;
    sessionId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<
      z.ZodEnum<{
        failed: 'failed';
        cancelled: 'cancelled';
        running: 'running';
        pending_approval: 'pending_approval';
        queued: 'queued';
        succeeded: 'succeeded';
        cancelling: 'cancelling';
        rejected: 'rejected';
        expired: 'expired';
      }>
    >;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    providerModel: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    includeDeleted: z.ZodDefault<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
    deletedOnly: z.ZodDefault<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
  },
  z.core.$strip
>;
export declare const generationHistoryPageSchema: z.ZodObject<
  {
    items: z.ZodArray<
      z.ZodObject<
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
      >
    >;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export type WorkbenchDraft = z.infer<typeof workbenchDraftSchema>;
export type WorkbenchSession = z.infer<typeof workbenchSessionSchema>;
export type CreateWorkbenchSession = z.input<typeof createWorkbenchSessionSchema>;
export type UpdateWorkbenchSession = z.infer<typeof updateWorkbenchSessionSchema>;
export type WorkbenchSessionPage = z.infer<typeof workbenchSessionPageSchema>;
export type GenerationHistoryPage = z.infer<typeof generationHistoryPageSchema>;
export type WorkbenchSessionListQuery = z.input<typeof workbenchSessionListQuerySchema>;
export type ParsedWorkbenchSessionListQuery = z.output<typeof workbenchSessionListQuerySchema>;
export type GenerationHistoryQuery = z.input<typeof generationHistoryQuerySchema>;
export type ParsedGenerationHistoryQuery = z.output<typeof generationHistoryQuerySchema>;
//# sourceMappingURL=workbench.d.ts.map
