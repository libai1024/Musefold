import { releaseReferenceImageInputSchema } from '@musefold/contracts';
import {
  cloudMcpOAuthRequestSchema,
  cloudMcpOAuthReviewSchema,
  cloudMcpOAuthDecisionSchema,
  cloudMcpOAuthRedirectSchema,
  accountExecutionBindingSchema,
  accountModelCatalogSchema,
  accountRecoveryRequestSchema,
  accountRecoveryReviewSchema,
  accountSummarySchema,
  accountNoticesSchema,
  type CreateGenerationInput,
  type LoginRequest,
  type CreateWorkbenchSession,
  type GenerationCleanupInput,
  generationCleanupResultSchema,
  type GenerationHistoryQuery,
  generationHistoryPageSchema,
  generationJobSchema,
  generationExecutionReceiptSchema,
  generationReceiptQuerySchema,
  retryGenerationInputSchema,
  generationReferenceImageSchema,
  type NewPromptDocument,
  type NewPromptFolder,
  type NewPromptTag,
  type PromptListQuery,
  promptDocumentSchema,
  promptEmptyTrashResultSchema,
  promptFolderSchema,
  promptPageSchema,
  promptTagSchema,
  type PromptUseInput,
  promptUseResultSchema,
  providerOptionSchema,
  redeemResultSchema,
  type RegisterRequest,
  type UpdatePromptDocument,
  type SaveAssetInput,
  type UpdatePromptFolder,
  type UpdatePromptTag,
  type UpdateWorkbenchSession,
  type UploadReferenceImageInput,
  type UsageSummaryQuery,
  usageSummarySchema,
  type CloudMcpRevokeInput,
  cloudMcpAuthorizationListSchema,
  cloudMcpRevokeResultSchema,
  type WorkbenchSessionListQuery,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
  workbenchSessionCleanupResultSchema,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { z } from 'zod';
import { createCloudDesignSchemesGateway } from './design-schemes';
import { type ApiClientConfig, ApiHttp } from './http';
import { ApiRequestError } from './http';
import {
  loginCapacityReviewSchema,
  loginSessionPageSchema,
  revokeLoginSessionsResultSchema,
  type LoginCapacityReview,
} from '@musefold/contracts';

/**
 * MusefoldGateway 的云端数据域实现(Web 宿主用)。
 * settings 域是宿主本地关切(localStorage / 主进程),不在此实现,由宿主组装完整 gateway。
 */
export type CloudDataGateway = Omit<MusefoldGateway, 'settings'>;

// Better Auth 登录/注册响应:只关心会话建立成功,token 由 cookie 承载(Web)。
const authSessionResponseSchema = z
  .looseObject({
    token: z.string().min(1).optional(),
    managed: z.boolean().optional(),
  })
  .refine((value) => value.managed === true || !!value.token, 'Missing login result');

export function createCloudDataGateway(config: ApiClientConfig): CloudDataGateway {
  const http = new ApiHttp(config);
  // 资产下载直取绝对 URL(预签名/同源),沿用注入 fetch 便于测试与 SSR。
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  const getStatus = () =>
    http.request({ method: 'GET', path: '/account/status', response: accountSummarySchema });
  let pendingCapacity: LoginCapacityReview | null = null;
  const acknowledge = () =>
    http.request({
      method: 'POST',
      path: '/account/login-sessions/touch',
      body: { acknowledge: true },
      response: z.unknown(),
    });
  const authenticate = async (
    path: '/sign-in/new-api' | '/sign-up/new-api',
    input: LoginRequest,
  ) => {
    pendingCapacity = null;
    try {
      const result = await http.request({
        method: 'POST',
        prefix: '/api/auth',
        path,
        body: {
          email: input.username,
          password: input.password,
          twoFactorCode: input.twoFactorCode,
        },
        response: authSessionResponseSchema,
      });
      if (result.managed) await acknowledge();
      return getStatus();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'AUTH_SESSION_LIMIT') {
        const review = loginCapacityReviewSchema.safeParse(error.details.review);
        if (review.success) pendingCapacity = review.data;
      }
      throw error;
    }
  };

  return {
    account: {
      getStatus,
      listLoginSessions: () =>
        http.request({
          method: 'GET',
          path: '/account/login-sessions',
          response: loginSessionPageSchema,
        }),
      getLoginCapacityReview: async (input) => {
        const flowRef = input?.flowRef ?? pendingCapacity?.flowRef;
        if (!flowRef)
          throw new ApiRequestError(
            'AUTH_LOGIN_CHALLENGE_EXPIRED',
            '验证已过期，请重新登录',
            401,
            false,
          );
        const review = await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/login-capacity/review',
          body: { flowRef },
          response: loginCapacityReviewSchema,
        });
        pendingCapacity = review;
        return review;
      },
      completeLoginCapacity: async (input) => {
        await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/login-capacity/complete',
          body: input,
          response: authSessionResponseSchema,
        });
        pendingCapacity = null;
        await acknowledge();
        return getStatus();
      },
      cancelLoginCapacity: async (input) => {
        await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/login-capacity/cancel',
          body: input,
          response: z.unknown(),
        });
        pendingCapacity = null;
      },
      revokeLoginSessions: (input) =>
        http.request({
          method: 'POST',
          path: '/account/login-sessions/revoke',
          body: input,
          response: revokeLoginSessionsResultSchema,
        }),
      touchLoginSession: async () => {
        await http.request({
          method: 'POST',
          path: '/account/login-sessions/touch',
          body: { acknowledge: false },
          response: z.unknown(),
        });
      },
      login: (input: LoginRequest) => authenticate('/sign-in/new-api', input),
      register: (input: RegisterRequest) => authenticate('/sign-up/new-api', input),
      logout: async () => {
        await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/sign-out',
          body: {},
          response: z.unknown(),
        });
      },
      redeem: (code: string) =>
        http.request({
          method: 'POST',
          path: '/account/redeem',
          body: { code },
          response: redeemResultSchema,
        }),
      retryRecovery: (input) =>
        http.request({
          method: 'POST',
          path: '/account/recovery/retry',
          body: accountRecoveryRequestSchema.parse(input),
          response: accountSummarySchema,
        }),
      inspectRecovery: (input) =>
        http.request({
          method: 'POST',
          path: '/account/recovery/inspect',
          body: accountRecoveryRequestSchema.parse(input),
          response: accountRecoveryReviewSchema,
        }),
      verifyOriginalSession: (input) =>
        http.request({
          method: 'POST',
          path: '/account/recovery/verify-original-session',
          body: accountRecoveryRequestSchema.parse(input),
          response: accountSummarySchema,
        }),
      createIndependentWorkspace: (input) =>
        http.request({
          method: 'POST',
          path: '/account/recovery/independent-workspace',
          body: accountRecoveryRequestSchema.parse(input),
          response: accountSummarySchema,
        }),
      getExecutionBinding: () =>
        http.request({
          method: 'GET',
          path: '/account/execution-binding',
          response: accountExecutionBindingSchema,
        }),
      getModelCatalog: () =>
        http.request({
          method: 'GET',
          path: '/account/models',
          response: accountModelCatalogSchema,
        }),
      getNotices: () =>
        http.request({ method: 'GET', path: '/account/notices', response: accountNoticesSchema }),
    },
    prompts: {
      list: (query: PromptListQuery) =>
        http.request({
          method: 'GET',
          path: '/prompts',
          query: { ...query, folderId: query.folderId === null ? 'null' : query.folderId },
          response: promptPageSchema,
        }),
      get: (id) =>
        http.request({ method: 'GET', path: `/prompts/${id}`, response: promptDocumentSchema }),
      create: (input: NewPromptDocument) =>
        http.request({
          method: 'POST',
          path: '/prompts',
          body: input,
          response: promptDocumentSchema,
        }),
      update: (id, patch: UpdatePromptDocument) =>
        http.request({
          method: 'PATCH',
          path: `/prompts/${id}`,
          body: patch,
          response: promptDocumentSchema,
        }),
      remove: (id) =>
        http.request({ method: 'DELETE', path: `/prompts/${id}`, response: promptDocumentSchema }),
      restore: (id) =>
        http.request({
          method: 'POST',
          path: `/prompts/${id}/restore`,
          response: promptDocumentSchema,
        }),
      purge: async (id) => {
        await http.request({
          method: 'POST',
          path: `/prompts/${id}/purge`,
          response: z.object({ ok: z.literal(true) }),
        });
      },
      emptyTrash: () =>
        http.request({
          method: 'POST',
          path: '/prompts/empty-trash',
          response: promptEmptyTrashResultSchema,
        }),
      use: (id, input: PromptUseInput) =>
        http.request({
          method: 'POST',
          path: `/prompts/${id}/use`,
          body: input,
          response: promptUseResultSchema,
        }),
      listFolders: () =>
        http.request({ method: 'GET', path: '/folders', response: z.array(promptFolderSchema) }),
      createFolder: (input: NewPromptFolder) =>
        http.request({
          method: 'POST',
          path: '/folders',
          body: input,
          response: promptFolderSchema,
        }),
      updateFolder: (id, patch: UpdatePromptFolder) =>
        http.request({
          method: 'PATCH',
          path: `/folders/${id}`,
          body: patch,
          response: promptFolderSchema,
        }),
      removeFolder: (id) =>
        http.request({ method: 'DELETE', path: `/folders/${id}`, response: promptFolderSchema }),
      listTags: () =>
        http.request({ method: 'GET', path: '/tags', response: z.array(promptTagSchema) }),
      createTag: (input: NewPromptTag) =>
        http.request({ method: 'POST', path: '/tags', body: input, response: promptTagSchema }),
      updateTag: (id, patch: UpdatePromptTag) =>
        http.request({
          method: 'PATCH',
          path: `/tags/${id}`,
          body: patch,
          response: promptTagSchema,
        }),
      removeTag: (id) =>
        http.request({ method: 'DELETE', path: `/tags/${id}`, response: promptTagSchema }),
    },
    workbench: {
      listSessions: (query: WorkbenchSessionListQuery) =>
        http.request({
          method: 'GET',
          path: '/workbench/sessions',
          query: { ...query },
          response: workbenchSessionPageSchema,
        }),
      createSession: (input: CreateWorkbenchSession) =>
        http.request({
          method: 'POST',
          path: '/workbench/sessions',
          body: input,
          response: workbenchSessionSchema,
        }),
      getSession: (id) =>
        http.request({
          method: 'GET',
          path: `/workbench/sessions/${id}`,
          response: workbenchSessionSchema,
        }),
      updateSession: (id, patch: UpdateWorkbenchSession) =>
        http.request({
          method: 'PATCH',
          path: `/workbench/sessions/${id}`,
          body: patch,
          response: workbenchSessionSchema,
        }),
      removeSession: (id) =>
        http.request({
          method: 'DELETE',
          path: `/workbench/sessions/${id}`,
          response: workbenchSessionSchema,
        }),
      restoreSession: (id) =>
        http.request({
          method: 'POST',
          path: `/workbench/sessions/${id}/restore`,
          response: workbenchSessionSchema,
        }),
      purgeSession: (id) =>
        http.request({
          method: 'POST',
          path: `/workbench/sessions/${id}/purge`,
          response: workbenchSessionCleanupResultSchema,
        }),
      emptyTrash: () =>
        http.request({
          method: 'POST',
          path: '/workbench/sessions/empty-trash',
          response: workbenchSessionCleanupResultSchema,
        }),
    },
    generation: {
      create: (input: CreateGenerationInput, idempotencyKey) =>
        http.request({
          method: 'POST',
          path: '/generations',
          body: input,
          headers: { 'idempotency-key': idempotencyKey },
          response: generationJobSchema,
        }),
      list: (query: GenerationHistoryQuery) =>
        http.request({
          method: 'GET',
          path: '/generations',
          query: { ...query },
          response: generationHistoryPageSchema,
        }),
      get: (id) =>
        http.request({ method: 'GET', path: `/generations/${id}`, response: generationJobSchema }),
      cancel: (id) =>
        http.request({
          method: 'POST',
          path: `/generations/${id}/cancel`,
          response: generationJobSchema,
        }),
      retry: (id, idempotencyKey, input) =>
        http.request({
          method: 'POST',
          path: `/generations/${id}/retry`,
          body: input === undefined ? undefined : retryGenerationInputSchema.parse(input),
          headers: { 'idempotency-key': idempotencyKey },
          response: generationJobSchema,
        }),
      getExecutionReceipt: (key) =>
        http.request({
          method: 'GET',
          path: '/generations/receipts/by-key',
          query: generationReceiptQuerySchema.parse({ key }),
          response: generationExecutionReceiptSchema,
        }),
      remove: (id) =>
        http.request({
          method: 'DELETE',
          path: `/generations/${id}`,
          response: generationJobSchema,
        }),
      restore: (id) =>
        http.request({
          method: 'POST',
          path: `/generations/${id}/restore`,
          response: generationJobSchema,
        }),
      purge: async (id) => {
        await http.request({
          method: 'POST',
          path: `/generations/${id}/purge`,
          response: z.object({ ok: z.literal(true) }),
        });
      },
      listProviders: () =>
        http.request({
          method: 'GET',
          path: '/generations/providers',
          response: z.array(providerOptionSchema),
        }),
      cleanup: (input: GenerationCleanupInput) =>
        http.request({
          method: 'POST',
          path: '/generations/cleanup',
          body: input,
          response: generationCleanupResultSchema,
        }),
      uploadReferenceImage: (input: UploadReferenceImageInput) => {
        const form = new FormData();
        // BlobPart 直接收 Uint8Array;文件名随表单字段带给服务端做展示名。
        form.append('file', new Blob([input.bytes as Uint8Array<ArrayBuffer>]), input.name);
        return http.request({
          method: 'POST',
          path: '/reference-images',
          body: form,
          response: generationReferenceImageSchema,
        });
      },
      releaseReferenceImage: async (input) => {
        const parsed = releaseReferenceImageInputSchema.parse(input);
        await http.request({
          method: 'DELETE',
          path: `/reference-images/${encodeURIComponent(parsed.id)}`,
          response: z.void(),
        });
      },
      saveAsset: async (input: SaveAssetInput) => {
        // 浏览器下载:同源/CORS 允许时 fetch → blob → a[download];
        // 预签名跨域未开 CORS 时降级新窗口打开(浏览器按响应头处置)。
        try {
          const response = await fetchImpl(input.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          try {
            triggerDownload(objectUrl, input.name);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        } catch {
          window.open(input.url, '_blank', 'noopener');
        }
        return 'saved' as const;
      },
    },
    usage: {
      summary: (query: UsageSummaryQuery) =>
        http.request({
          method: 'GET',
          path: '/usage/summary',
          query: { range: query.range },
          response: usageSummarySchema,
        }),
    },
    cloudMcp: {
      authorization: {
        review: (input) =>
          http.request({
            method: 'POST',
            prefix: '/api/auth',
            path: '/musefold/oauth-review',
            body: cloudMcpOAuthRequestSchema.parse(input),
            response: cloudMcpOAuthReviewSchema,
          }),
        decide: (input) => {
          const { reviewRef, ...body } = cloudMcpOAuthDecisionSchema.parse(input);
          return http.request({
            method: 'POST',
            prefix: '/api/auth',
            path: '/oauth2/consent',
            body,
            headers: { 'x-musefold-oauth-review': reviewRef },
            response: cloudMcpOAuthRedirectSchema,
          });
        },
      },
      listAuthorizations: () =>
        http.request({
          method: 'GET',
          path: '/mcp/authorizations',
          response: cloudMcpAuthorizationListSchema,
        }),
      revokeAuthorization: (input: CloudMcpRevokeInput) =>
        http.request({
          method: 'DELETE',
          path: `/mcp/authorizations/${encodeURIComponent(input.clientId)}`,
          response: cloudMcpRevokeResultSchema,
        }),
    },
    designSchemes: createCloudDesignSchemesGateway(http),
  };
}

function triggerDownload(href: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
