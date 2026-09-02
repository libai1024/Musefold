import {
  accountSummarySchema,
  type CreateGenerationInput,
  type LoginRequest,
  type CreateWorkbenchSession,
  type GenerationHistoryQuery,
  generationHistoryPageSchema,
  generationJobSchema,
  generationReferenceImageSchema,
  type NewPromptDocument,
  type NewPromptFolder,
  type NewPromptTag,
  type PromptListQuery,
  promptDocumentSchema,
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
  type WorkbenchSessionListQuery,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { z } from 'zod';
import { createCloudDesignSchemesGateway } from './design-schemes';
import { type ApiClientConfig, ApiHttp } from './http';

/**
 * MusefoldGateway 的云端数据域实现(Web 宿主用)。
 * settings 域是宿主本地关切(localStorage / 主进程),不在此实现,由宿主组装完整 gateway。
 */
export type CloudDataGateway = Omit<MusefoldGateway, 'settings'>;

// Better Auth 登录/注册响应:只关心会话建立成功,token 由 cookie 承载(Web)。
const authSessionResponseSchema = z.looseObject({ token: z.string().min(1) });

export function createCloudDataGateway(config: ApiClientConfig): CloudDataGateway {
  const http = new ApiHttp(config);
  // 资产下载直取绝对 URL(预签名/同源),沿用注入 fetch 便于测试与 SSR。
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  const getStatus = () =>
    http.request({ method: 'GET', path: '/account/status', response: accountSummarySchema });

  return {
    account: {
      getStatus,
      login: async (input: LoginRequest) => {
        await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/sign-in/new-api',
          body: { email: input.username, password: input.password },
          response: authSessionResponseSchema,
        });
        return getStatus();
      },
      register: async (input: RegisterRequest) => {
        await http.request({
          method: 'POST',
          prefix: '/api/auth',
          path: '/sign-up/new-api',
          body: { email: input.username, password: input.password },
          response: authSessionResponseSchema,
        });
        return getStatus();
      },
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
      retry: (id, idempotencyKey) =>
        http.request({
          method: 'POST',
          path: `/generations/${id}/retry`,
          headers: { 'idempotency-key': idempotencyKey },
          response: generationJobSchema,
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
