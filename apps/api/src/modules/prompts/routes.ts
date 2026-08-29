import {
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptDocumentSchema,
  promptFolderSchema,
  promptListQuerySchema,
  promptPageSchema,
  promptTagSchema,
  promptUseInputSchema,
  promptUseResultSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { PromptService } from './service.js';

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
/**
 * 删除/恢复的乐观锁版本:api-client 的 remove(id)/restore(id) 不携带 body,
 * 缺省视为无条件执行(按服务端当前版本);显式提供时严格校验。
 */
const expectedVersionBody = z
  .object({ expectedVersion: z.number().int().positive().optional() })
  .optional()
  .default({});
const includeDeletedQuery = z.object({ includeDeleted: z.coerce.boolean().default(false) });

/** HTTP 查询串里 tagIds 是逗号分隔字符串,进契约前先拆分。 */
const promptListHttpQuery = promptListQuerySchema.extend({
  tagIds: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    promptListQuerySchema.shape.tagIds,
  ),
});

export function promptRoutes(prompts: PromptService) {
  const app = createAuthedRouter();
  const tags = ['prompts'];

  route(
    app,
    {
      method: 'get',
      path: '/prompts',
      tags,
      query: promptListHttpQuery,
      response: promptPageSchema,
    },
    async (c, input) => c.json(await prompts.listPrompts(c.get('userId'), input.query)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/prompts',
      tags,
      body: newPromptDocumentSchema,
      status: 201,
      response: promptDocumentSchema,
    },
    async (c, input) => c.json(await prompts.createPrompt(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'get',
      path: '/prompts/{id}',
      tags,
      params: idParams,
      response: promptDocumentSchema,
    },
    async (c, input) => c.json(await prompts.getPrompt(c.get('userId'), input.params.id)),
  );

  route(
    app,
    {
      method: 'patch',
      path: '/prompts/{id}',
      tags,
      params: idParams,
      body: updatePromptDocumentSchema,
      response: promptDocumentSchema,
    },
    async (c, input) =>
      c.json(await prompts.updatePrompt(c.get('userId'), input.params.id, input.body)),
  );

  route(
    app,
    {
      method: 'delete',
      path: '/prompts/{id}',
      tags,
      params: idParams,
      body: expectedVersionBody,
      response: promptDocumentSchema,
    },
    async (c, input) =>
      c.json(
        await prompts.deletePrompt(c.get('userId'), input.params.id, input.body.expectedVersion),
      ),
  );

  route(
    app,
    {
      method: 'post',
      path: '/prompts/{id}/restore',
      tags,
      params: idParams,
      body: expectedVersionBody,
      response: promptDocumentSchema,
    },
    async (c, input) =>
      c.json(
        await prompts.restorePrompt(c.get('userId'), input.params.id, input.body.expectedVersion),
      ),
  );

  route(
    app,
    {
      method: 'post',
      path: '/prompts/{id}/purge',
      tags,
      params: idParams,
      response: z.object({ ok: z.literal(true) }),
    },
    async (c, input) => {
      await prompts.purgePrompt(c.get('userId'), input.params.id);
      return c.json({ ok: true as const });
    },
  );

  route(
    app,
    {
      method: 'post',
      path: '/prompts/{id}/use',
      tags,
      params: idParams,
      body: promptUseInputSchema,
      response: promptUseResultSchema,
    },
    async (c, input) =>
      c.json(await prompts.usePrompt(c.get('userId'), input.params.id, input.body)),
  );

  route(
    app,
    {
      method: 'get',
      path: '/folders',
      tags,
      query: includeDeletedQuery,
      response: z.array(promptFolderSchema),
    },
    async (c, input) =>
      c.json(await prompts.listFolders(c.get('userId'), input.query.includeDeleted)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/folders',
      tags,
      body: newPromptFolderSchema,
      status: 201,
      response: promptFolderSchema,
    },
    async (c, input) => c.json(await prompts.createFolder(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'patch',
      path: '/folders/{id}',
      tags,
      params: idParams,
      body: updatePromptFolderSchema,
      response: promptFolderSchema,
    },
    async (c, input) =>
      c.json(await prompts.updateFolder(c.get('userId'), input.params.id, input.body)),
  );

  route(
    app,
    {
      method: 'delete',
      path: '/folders/{id}',
      tags,
      params: idParams,
      body: expectedVersionBody,
      response: promptFolderSchema,
    },
    async (c, input) =>
      c.json(
        await prompts.deleteFolder(c.get('userId'), input.params.id, input.body.expectedVersion),
      ),
  );

  route(
    app,
    {
      method: 'get',
      path: '/tags',
      tags,
      query: includeDeletedQuery,
      response: z.array(promptTagSchema),
    },
    async (c, input) => c.json(await prompts.listTags(c.get('userId'), input.query.includeDeleted)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/tags',
      tags,
      body: newPromptTagSchema,
      status: 201,
      response: promptTagSchema,
    },
    async (c, input) => c.json(await prompts.createTag(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'patch',
      path: '/tags/{id}',
      tags,
      params: idParams,
      body: updatePromptTagSchema,
      response: promptTagSchema,
    },
    async (c, input) =>
      c.json(await prompts.updateTag(c.get('userId'), input.params.id, input.body)),
  );

  route(
    app,
    {
      method: 'delete',
      path: '/tags/{id}',
      tags,
      params: idParams,
      body: expectedVersionBody,
      response: promptTagSchema,
    },
    async (c, input) =>
      c.json(await prompts.deleteTag(c.get('userId'), input.params.id, input.body.expectedVersion)),
  );

  return app;
}
