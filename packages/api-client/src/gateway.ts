import {
  accountSummarySchema,
  type CloudGenerationRequest,
  type CreateWorkbenchSession,
  type GenerationHistoryQuery,
  generationHistoryPageSchema,
  generationJobSchema,
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
  redeemResultSchema,
  type UpdatePromptDocument,
  type UpdatePromptFolder,
  type UpdatePromptTag,
  type UpdateWorkbenchSession,
  type WorkbenchSessionListQuery,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { z } from 'zod';
import { type ApiClientConfig, ApiHttp } from './http';

/**
 * MusefoldGateway 的云端数据域实现(Web 宿主用)。
 * settings 域是宿主本地关切(localStorage / 主进程),不在此实现,由宿主组装完整 gateway。
 */
export type CloudDataGateway = Omit<MusefoldGateway, 'settings'>;

export function createCloudDataGateway(config: ApiClientConfig): CloudDataGateway {
  const http = new ApiHttp(config);

  return {
    account: {
      getStatus: () =>
        http.request({ method: 'GET', path: '/account/status', response: accountSummarySchema }),
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
      create: (input: CloudGenerationRequest) =>
        http.request({
          method: 'POST',
          path: '/generations',
          body: input,
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
      retry: (id) =>
        http.request({
          method: 'POST',
          path: `/generations/${id}/retry`,
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
    },
  };
}
